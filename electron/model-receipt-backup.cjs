const { createHash } = require('node:crypto');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value);
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const pick = (value, fields) => Object.fromEntries(fields.filter(field => value?.[field] !== undefined).map(field => [field, value[field]]));
const artifactFields = ['id', 'name', 'mimeType', 'bytes', 'kind', 'createdAt', 'runId', 'projectId', 'trashedAt', 'unavailable', 'unavailableReason', 'provenance'];
const provenanceFields = ['builtinId', 'packId', 'origin', 'author', 'licenseId', 'licenseName', 'licenseUrl', 'sourceUrl', 'usageNote', 'licenseNotice'];
const usageFields = ['inputTokens', 'outputTokens', 'totalTokens', 'images', 'seconds', 'providerRequestId', 'inputTextTokens', 'inputImageTokens', 'cachedInputTokens', 'uncachedInputTokens', 'cacheWriteInputTokens', 'cacheWrite5mTokens', 'cacheWrite1hTokens', 'cacheWrite30mTokens', 'cacheWrite12hTokens', 'cachedInputTextTokens', 'cachedInputImageTokens', 'outputImageTokens', 'outputTextTokens', 'reasoningTokens', 'usageSource'];
function validateReceiptRecord(record) {
  if (!object(record) || record.version !== 1 || !validId(record.requestId) || !validId(record.runId) || !validId(record.projectId) || !hex(record.fingerprint) || !['started', 'failed', 'complete'].includes(record.status) || typeof record.requestStarted !== 'boolean') throw Error('模型回执备份身份或状态无效。');
  if (record.status === 'complete' && (!object(record.result) || record.resultSha256 !== hash(record.result) || !Array.isArray(record.result.artifacts) || record.result.artifacts.some(file => !validId(file?.id) || file.projectId && file.projectId !== record.projectId) || new Set(record.result.artifacts.map(file => file.id)).size !== record.result.artifacts.length)) throw Error('模型回执结果哈希或产物归属无法核验，原回执未覆盖。');
}
function safeArtifact(file) {
  const { withoutSecrets } = require('./backup-format.cjs'), safe = pick(file, artifactFields);
  if (safe.provenance) safe.provenance = pick(safe.provenance, provenanceFields);
  return withoutSecrets(safe);
}
function safeRecord(record) {
  validateReceiptRecord(record);
  const safe = pick(record, ['version', 'requestId', 'runId', 'projectId', 'fingerprint', 'status', 'requestStarted', 'createdAt', 'completedAt', 'originFingerprint']);
  if (record.status === 'complete') {
    safe.result = pick(record.result, ['text', 'providerRequestId']); safe.result.artifacts = record.result.artifacts.map(safeArtifact);
    if (record.result.usage) safe.result.usage = pick(record.result.usage, usageFields);
    if (record.result.billingRequestSnapshot) { safe.result.billingRequestSnapshot = pick(record.result.billingRequestSnapshot, ['version', 'adapter', 'source', 'providerId', 'protocol', 'modelId', 'operation']); if (record.result.billingRequestSnapshot.cache) safe.result.billingRequestSnapshot.cache = pick(record.result.billingRequestSnapshot.cache, ['ttl', 'source', 'breakpoints']); }
    safe.resultSha256 = hash(safe.result);
  }
  return safe;
}
function validateModelReceiptBackup(bundle, scope = {}) {
  if (bundle === undefined) return;
  if (!object(bundle) || bundle.kind !== 'xuzuo-model-receipt-backup' || bundle.version !== 1 || !Array.isArray(bundle.records) || bundle.records.length > 20000 || new Set(bundle.records.map(record => record.requestId)).size !== bundle.records.length || Buffer.byteLength(JSON.stringify(bundle)) > 16 * 1024 * 1024) throw Error('模型回执备份格式或容量无效。');
  for (const record of bundle.records) { validateReceiptRecord(record); if (scope.projectIds && !scope.projectIds.includes(record.projectId)) throw Error('模型回执超出所选项目备份范围。'); }
}
function exportModelReceiptBackup(records, { projectIds } = {}) {
  if (!Array.isArray(records) || !Array.isArray(projectIds) || projectIds.some(id => !validId(id))) throw Error('请选择模型回执的项目范围。');
  const selected = records.filter(record => projectIds.includes(record.projectId)); if (!selected.length) return undefined;
  const bundle = { kind: 'xuzuo-model-receipt-backup', version: 1, records: selected.map(safeRecord) }; validateModelReceiptBackup(bundle, { projectIds }); return bundle;
}
function prepareReceipt(record, { idMap, backupId, availableRuns, availableArtifacts }) {
  const requestId = idMap[record.requestId], runId = idMap[record.runId], projectId = idMap[record.projectId];
  if (![requestId, runId, projectId].every(validId)) throw Error('模型回执缺少请求尝试、运行或项目编号映射，不能沿用原机编号。');
  const run = availableRuns.find(run => run.id === runId && run.projectId === projectId);
  if (!run || !run.attempts?.some(attempt => attempt.id === requestId)) throw Error('模型回执没有对应的已恢复运行和请求尝试，未写入旧编号或重新请求模型。');
  const safe = safeRecord(record), next = { ...safe, requestId, runId, projectId, originFingerprint: hex(record.originFingerprint) ? record.originFingerprint : record.fingerprint };
  next.fingerprint = hash(['restored-model-receipt', backupId, next.originFingerprint, requestId, runId, projectId]);
  if (safe.status === 'complete') {
    next.result = structuredClone(safe.result);
    next.result.artifacts = safe.result.artifacts.map(source => {
      const id = validId(idMap[source.id]) ? idMap[source.id] : hash(['unavailable-restored-artifact', backupId, source.id]);
      const actual = availableArtifacts.find(artifact => artifact.id === id);
      if (actual && actual.projectId !== projectId) throw Error('已恢复模型产物不属于此项目，未覆盖原回执。');
      if (actual && !actual.unavailable && !actual.trashedAt && typeof actual.path === 'string' && actual.path) return { ...pick(actual, [...artifactFields, 'path']), id, projectId, runId };
      return { ...source, id, projectId, runId, path: '', unavailable: true, unavailableReason: actual?.trashedAt ? '产物仍在回收站，请恢复后再读取已有结果；未重新请求模型。' : '原产物未随本次备份恢复，请核对原文件；未重新请求模型。', ...(actual?.trashedAt ? { trashedAt: actual.trashedAt } : {}) };
    });
    next.resultSha256 = hash(next.result);
  }
  next.importOrigin = { backupId, sourceRequestId: record.requestId, sourceFingerprint: hash(safe) }; return next;
}
function mergeModelReceiptImport(currentRecords, { records, idMap, backupId, availableRuns, availableArtifacts }) {
  validateModelReceiptBackup(records); if (!records) return { added: [], skipped: 0 };
  if (!Array.isArray(currentRecords) || !object(idMap) || !validId(backupId) || !Array.isArray(availableRuns) || !Array.isArray(availableArtifacts)) throw Error('模型回执恢复缺少受管运行或产物清单。');
  const targets = records.records.map(record => idMap[record.requestId]);
  if (new Set(targets).size !== targets.length) throw Error('模型请求尝试编号映射重复，未覆盖既有回执。');
  const added = []; let skipped = 0;
  for (const source of records.records) {
    const next = prepareReceipt(source, { idMap, backupId, availableRuns, availableArtifacts }), previous = currentRecords.find(record => record.requestId === next.requestId);
    if (!previous) { added.push(next); continue; }
    validateReceiptRecord(previous);
    if (previous.runId !== next.runId || previous.projectId !== next.projectId || previous.importOrigin?.backupId !== backupId || previous.importOrigin?.sourceRequestId !== source.requestId || previous.importOrigin?.sourceFingerprint !== next.importOrigin.sourceFingerprint) throw Error('目标模型回执已存在或来源冲突，未覆盖既有结果与费用。');
    skipped++;
  }
  return { added, skipped };
}
module.exports = { validateModelReceiptBackup, exportModelReceiptBackup, mergeModelReceiptImport };
