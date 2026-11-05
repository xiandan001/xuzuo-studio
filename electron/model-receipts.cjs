const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { checkedDirectory, checkedFile, atomicJson } = require('./workspace-paths.cjs');
const { exportModelReceiptBackup, mergeModelReceiptImport } = require('./model-receipt-backup.cjs');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fingerprintFor = request => digest({ projectId: request.projectId, runId: request.runId, provider: request.connection?.providerId, endpoint: request.connection?.baseUrl, model: request.model?.modelId, kind: request.kind, prompt: request.prompt, input: request.input, options: request.options, attachments: request.attachments?.map(file => file.id) });
function createModelReceipts({ directory, artifactStore, fileSystem = fs }) {
  const root = path.join(path.resolve(directory), 'model-receipts-v1'), pending = new Map();
  const seal = value => { const content = { ...value }; delete content.recordSha256; return { ...content, recordSha256: digest(content) }; };
  const filename = id => { if (typeof id !== 'string' || !/^[A-Za-z0-9-]{1,160}$/.test(id)) throw Error('模型请求回执编号无效。'); return path.join(root, `${id}.json`); };
  async function read(id) {
    const file = filename(id);
    try {
      await fileSystem.lstat(file); await checkedFile(fileSystem, file); const stat = await fileSystem.stat(file); if (stat.size > 32 * 1024 * 1024) throw Error('size');
      const record = JSON.parse(await fileSystem.readFile(file, 'utf8')), content = { ...record }; delete content.recordSha256;
      if (record.version !== 1 || record.requestId !== id || !['started', 'failed', 'complete'].includes(record.status) || typeof record.requestStarted !== 'boolean' || record.recordSha256 !== digest(content) || !/^[a-f0-9]{64}$/.test(record.fingerprint) || record.status === 'complete' && (!record.result || record.resultSha256 !== digest(record.result))) throw Error('shape'); return record;
    } catch (error) { if (error.code === 'ENOENT') return undefined; throw Error('模型回执无法核验，未自动重发请求；请保留原文件。'); }
  }
  async function recoverReceipt({ requestId, runId, projectId }) {
    const record = await read(requestId); if (!record || record.status !== 'complete') return undefined;
    if (record.runId !== runId || record.projectId !== projectId) throw Error('模型回执不属于当前项目或运行。');
    const result = structuredClone(record.result);
    result.artifacts = [];
    for (const artifact of record.result.artifacts || []) { const file = await artifactStore.read(artifact.id); if (file.projectId !== projectId) throw Error('已收到结果的文件不可用，请先检查原产物。'); const { buffer, ...metadata } = file; result.artifacts.push({ ...artifact, ...metadata, unavailable: false, unavailableReason: undefined, trashedAt: undefined }); }
    return result;
  }
  async function existingRecords(ids) { const records = []; for (const id of ids) { const record = await read(id); if (record) records.push(record); } return records; }
  async function perform(request, execute) {
    const requestId = request.requestId, fingerprint = fingerprintFor(request);
    const existing = await read(requestId);
    if (existing && existing.fingerprint !== fingerprint) throw Object.assign(Error('相同请求编号的输入已经变化，未发送请求。'), { requestStarted: false });
    if (existing?.status === 'complete') return recoverReceipt(request);
    if (existing && existing.requestStarted !== false) throw Object.assign(Error('此请求已有派发记录但结果尚未确认，不能自动重发；请先核对已有任务与费用。'), { requestStarted: true, publicMessage: '此请求状态尚未确认，未自动重发。请检查已保存结果和供应商记录。' });
    await checkedDirectory(fileSystem, root, true);
    const record = { version: 1, requestId, runId: request.runId, projectId: request.projectId, fingerprint, status: 'started', requestStarted: true, createdAt: new Date().toISOString() };
    await atomicJson(fileSystem, filename(requestId), seal(record));
    let result;
    try {
      result = await execute();
      await atomicJson(fileSystem, filename(requestId), seal({ ...record, status: 'complete', result, resultSha256: digest(result), completedAt: new Date().toISOString() }));
      return result;
    } catch (error) {
      if (result) { error.usage ||= result.usage; error.artifacts ||= result.artifacts; error.billingRequestSnapshot ||= result.billingRequestSnapshot; error.providerRequestId ||= result.providerRequestId; error.partialText ||= result.text; error.requestStarted = true; error.publicMessage ||= '已收到模型结果，但回执保存未完成；已有结果与费用记录保留，请检查磁盘。'; }
      else if (error.requestStarted === false) await atomicJson(fileSystem, filename(requestId), seal({ ...record, status: 'failed', requestStarted: false })).catch(() => undefined);
      throw error;
    }
  }
  return {
    execute(request, run) { const fingerprint = fingerprintFor(request), existing = pending.get(request.requestId); if (existing) { if (existing.fingerprint !== fingerprint) return Promise.reject(Object.assign(Error('相同请求编号仍在执行且输入不同，未重复发送。'), { requestStarted: false })); return existing.promise; } const promise = perform(request, run).finally(() => pending.delete(request.requestId)); pending.set(request.requestId, { promise, fingerprint }); return promise; },
    recoverReceipt,
    async backupEntries(scope) {
      if (!Array.isArray(scope?.availableRuns)) throw Error('回执备份缺少运行记录范围，未生成不完整备份。');
      const allowed = new Map(scope.availableRuns.filter(run => !scope.projectIds || scope.projectIds.includes(run.projectId)).flatMap(run => run.attempts.map(attempt => [attempt.id, { runId: run.id, projectId: run.projectId }])));
      const records = await existingRecords(allowed.keys());
      if (records.some(record => { const owner = allowed.get(record.requestId); return owner?.runId !== record.runId || owner.projectId !== record.projectId; })) throw Error('回执与所选运行归属不一致，未生成不完整备份。');
      return exportModelReceiptBackup(records, scope);
    },
    async importEntries(input) {
      const idMap = input.idMap instanceof Map ? Object.fromEntries(input.idMap) : input.idMap;
      const mapped = id => idMap?.[id] || id;
      const ids = [...new Set((input.records?.records || []).flatMap(record => record.result?.artifacts || []).map(artifact => mapped(artifact.id)))];
      const availableArtifacts = [];
      for (const id of ids) { try { availableArtifacts.push(...await artifactStore.list([id])); } catch { /* Unrestored source files remain explicitly unavailable. */ } }
      const existing = await existingRecords((input.records?.records || []).map(record => mapped(record.requestId)));
      const result = mergeModelReceiptImport(existing, { ...input, idMap, availableArtifacts });
      await checkedDirectory(fileSystem, root, true);
      for (const record of result.added) await atomicJson(fileSystem, filename(record.requestId), seal(record));
      return { imported: result.added.map(record => record.requestId), skipped: result.skipped };
    },
  };
}
module.exports = { createModelReceipts };
