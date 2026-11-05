const { createHash, randomUUID } = require('node:crypto');
const { validateQuoteBackups } = require('./quote-backup.cjs');
const { validateAutomationBackup } = require('./automation-backup.cjs');
const { validateModelReceiptBackup } = require('./model-receipt-backup.cjs');
const { validatePurgedProjectAudits } = require('./backup-project-audits.cjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const MAX_FILE = 100 * 1024 * 1024, MAX_TOTAL = 512 * 1024 * 1024, MAX_FILES = 10000;
const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value);
function safePath(name) {
  if (typeof name !== 'string' || !name || name.length > 1000 || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').some(part => !part || ['.', '..'].includes(part) || /[<>:"|?*\x00-\x1f]/.test(part) || /[.\s]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('备份包含不安全或不兼容的文件路径，未解压。');
  return name;
}
// Inspect the central directory before JSZip normalizes paths or expands data.
function inspectZip(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_TOTAL) throw new Error('备份文件超过 512 MB，未导入。');
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (bytes.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) throw new Error('备份 ZIP 格式不受支持。');
  const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12), offset = bytes.readUInt32LE(end + 16);
  if (count > MAX_FILES || count === 65535 || offset + size !== end || end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length) throw new Error('备份目录数量或 ZIP 边界无效。');
  const names = new Set(); let cursor = offset, total = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error('备份 ZIP 目录损坏。');
    const flags = bytes.readUInt16LE(cursor + 8), expanded = bytes.readUInt32LE(cursor + 24), nameLength = bytes.readUInt16LE(cursor + 28), extraLength = bytes.readUInt16LE(cursor + 30), commentLength = bytes.readUInt16LE(cursor + 32);
    if (cursor + 46 + nameLength + extraLength + commentLength > end) throw new Error('备份 ZIP 条目边界无效。');
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8'), canonical = name.endsWith('/') ? name.slice(0, -1) : name;
    safePath(canonical);
    if (names.has(canonical.toLowerCase()) || flags & 1 || expanded > MAX_FILE || (total += expanded) > MAX_TOTAL || (bytes.readUInt32LE(cursor + 38) >>> 16 & 0xf000) === 0xa000) throw new Error('备份包含重复路径、加密条目、链接或超限内容。');
    names.add(canonical.toLowerCase()); cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== end) throw new Error('备份 ZIP 目录边界不一致。');
}
const SECRET = /^(?:api[-_]?key|secret|password|authorization|access[-_]?token|refresh[-_]?token|credentials|vaultStatus|credentialId)$/i;
function withoutSecrets(value) {
  if (Array.isArray(value)) return value.map(withoutSecrets);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([name, item]) => !SECRET.test(name) && typeof item !== 'function').map(([name, item]) => [name, withoutSecrets(item)]));
  return value;
}
function assertUnique(items, label, field = 'id') {
  if (!Array.isArray(items) || items.some(item => !validId(item?.[field])) || new Set(items.map(item => item[field])).size !== items.length) throw new Error(`备份${label}包含无效或重复编号。`);
}
function validateManifest(value) {
  if (!value || value.kind !== 'xuzuo-internal-backup' || ![1, 2, 3].includes(value.version) || value.secretsIncluded !== false || !validId(value.backupId) || !value.meta || !Array.isArray(value.files) || value.files.length > MAX_FILES) throw new Error('这不是受支持的序作内部备份。客户交付 ZIP 不能用于恢复工作区。');
  for (const [name, field] of [['workspaces', 'workspaceId'], ['projects', 'projectId']]) assertUnique(value.locations?.[name], name, field);
  for (const name of ['workspaces', 'projects', 'ledger', 'customPrompts']) assertUnique(value.meta[name], name);
  assertUnique(value.artifacts, '产物');
  if (!Array.isArray(value.records)) throw new Error('备份运行记录无效。');
  assertUnique(value.records.map(record => record.run), '运行记录');
  const projects = new Set(value.locations.projects.map(item => item.projectId)), workspaces = new Set(value.locations.workspaces.map(item => item.workspaceId));
  const audits = value.meta.projects.filter(item => item.purgedAt !== undefined), activeProjects = value.meta.projects.filter(item => item.purgedAt === undefined), auditIds = new Set(audits.map(item => item.id));
  validatePurgedProjectAudits(value.meta.projects);
  if (audits.length && value.version !== 3 || audits.some(item => projects.has(item.id))) throw new Error('永久移除审计不能带有可恢复项目目录。');
  if (!workspaces.size || value.meta.workspaces.length !== workspaces.size || value.meta.workspaces.some(item => !workspaces.has(item.id)) || activeProjects.length !== projects.size || activeProjects.some(item => !projects.has(item.id)) || value.meta.projects.some(item => !workspaces.has(item.workspaceId)) || value.locations.projects.some(item => !workspaces.has(item.workspaceId)) || value.artifacts.some(item => !projects.has(item.projectId)) || value.records.some(item => !projects.has(item.run.projectId)) || value.meta.ledger.some(item => !projects.has(item.projectId) && !auditIds.has(item.projectId))) throw new Error('备份的工作区和项目归属不一致。');
  if (activeProjects.some(item => value.locations.projects.find(project => project.projectId === item.id)?.workspaceId !== item.workspaceId)) throw new Error('备份界面索引与项目目录所属工作区不一致。');
  validateQuoteBackups(value.meta.quoteDrafts, value.meta.projects);
  validateAutomationBackup(value.automations, { projects: activeProjects, workspaces: value.meta.workspaces });
  validateModelReceiptBackup(value.modelReceipts, { projectIds: [...projects] });
  for (const name of ['connections', 'models', 'workflows', 'categories', 'studioActions', 'useTemplates']) assertUnique(value.meta.configuration?.[name] || [], `配置${name}`);
  for (const record of value.records) { assertUnique(record.ledger, '运行账本'); if (!Array.isArray(record.run.snapshot?.steps) || !Array.isArray(record.run.attempts)) throw new Error('备份运行记录无效。'); }
  assertUnique(value.records.flatMap(record => record.ledger), '全部运行账本');
  if (value.batches !== undefined) {
    assertUnique(value.batches, '批量记录');
    for (const batch of value.batches) {
      assertUnique(batch.items, '批量项目');
      if (batch.version !== 1 || !batch.request || batch.items.some(item => !projects.has(item.project?.id) || !Array.isArray(item.attempts))) throw new Error('备份批量记录的版本或项目归属无效。');
    }
  }
  let total = 0; const paths = new Set();
  for (const item of value.files) {
    safePath(item.path);
    if (paths.has(item.path.toLowerCase()) || !Number.isSafeInteger(item.bytes) || item.bytes < 0 || item.bytes > MAX_FILE || !/^[a-f0-9]{64}$/.test(item.sha256) || (total += item.bytes) > MAX_TOTAL) throw new Error('备份清单含重复路径、无效哈希或超限内容。');
    paths.add(item.path.toLowerCase());
  }
  return value;
}
function createIdMap(value) {
  const map = Object.create(null);
  function walk(item, field = '') {
    if (['checks', 'checkedIds', 'preparation', 'variables', 'pricing', 'pricingSnapshot', 'billingRuleSnapshot', 'calculation'].includes(field)) return;
    if (Array.isArray(item)) for (const child of item) walk(child, field);
    else if (item && typeof item === 'object') { for (const [name, child] of Object.entries(item)) { if (['id', 'workspaceId', 'projectId', 'runId', 'workflowRunId', 'workflowAttemptId', 'workflowStepId', 'creationKey'].includes(name) && validId(child)) map[child] ||= randomUUID(); walk(child, name); } }
  }
  walk(value); return { ...map };
}
const ID_FIELDS = new Set(['id', 'workspaceId', 'projectId', 'runId', 'workflowId', 'stepId', 'connectionId', 'modelConfigId', 'credentialId', 'promptTemplateId', 'businessCategoryId', 'parentId', 'imageId', 'assetId', 'sourceAssetId', 'workflowRunId', 'workflowStepId', 'workflowAttemptId', 'originWorkspaceId', 'lastProjectId', 'exportRunId', 'supersededByRunId', 'supersedesRunId', 'lastLiveCompletionId', 'contentSourceStepId', 'imageSourceStepId', 'imageMarkupId', 'creationKey', 'replaceWaitingReviewRunId', 'repairStepId', 'ruleId', 'eventId', 'jobId', 'decisionId', 'sourceWorkflowId', 'sourceId']);
const ID_ARRAYS = new Set(['sourceArtifactIds', 'attachmentIds', 'artifactIds', 'documentImageStepIds', 'contentSourceStepIds', 'pendingCostEntryIds', 'legacyCostEntryIds', 'ruleChain']);
const PATH_FIELDS = new Set(['path', 'directory', 'storageDirectory']);
function relocatedPath(value, paths, fileNames) {
  let mapped = paths[value];
  if (!mapped) {
    const prefix = Object.keys(paths).sort((a, b) => b.length - a.length).find(before => value.startsWith(`${before}/`) || value.startsWith(`${before}\\`));
    mapped = prefix ? `${paths[prefix]}${value.slice(prefix.length)}` : value;
  }
  const split = Math.max(mapped.lastIndexOf('/'), mapped.lastIndexOf('\\')), basename = mapped.slice(split + 1);
  return fileNames[basename] ? `${mapped.slice(0, split + 1)}${fileNames[basename]}` : mapped;
}
function remap(value, ids, paths = {}, fileNames = {}, field = '') {
  if (['checks', 'checkedIds', 'preparation', 'variables', 'pricing', 'pricingSnapshot', 'billingRuleSnapshot'].includes(field)) return structuredClone(value);
  if (typeof value === 'string') {
    if (ID_FIELDS.has(field) || ID_ARRAYS.has(field)) return Object.hasOwn(ids, value) ? ids[value] : value;
    if (PATH_FIELDS.has(field)) return relocatedPath(value, paths, fileNames);
    if (['fileName', 'trashFileName'].includes(field)) return fileNames[value] || value;
    return value;
  }
  if (Array.isArray(value)) return value.map(item => remap(item, ids, paths, fileNames, field));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => {
    const dictionaryKey = field === 'preferencesByWorkspace' || field === 'calculationCells';
    const nextField = field === 'calculation' && name === 'cells' ? 'calculationCells' : name;
    return [dictionaryKey && Object.hasOwn(ids, name) ? ids[name] : name, remap(item, ids, paths, fileNames, nextField)];
  }));
  return value;
}
function mappedName(name, ids) {
  if (ids[name]) return ids[name];
  const before = Object.keys(ids).sort((a, b) => b.length - a.length).find(id => name.startsWith(`${id}-`));
  if (!before) return name;
  const rest = name.slice(before.length + 1), suffix = rest.startsWith(`${before}.`) ? `${ids[before]}${rest.slice(before.length)}` : rest;
  return `${ids[before]}-${suffix}`;
}
module.exports = { hash, MAX_FILE, MAX_TOTAL, MAX_FILES, validId, safePath, inspectZip, withoutSecrets, validateManifest, createIdMap, remap, mappedName };
