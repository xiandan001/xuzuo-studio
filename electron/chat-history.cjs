const LIMIT = 10000;
const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value);
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const normalize = value => value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
function historyFieldsValid(record) {
  return (record.pinned === undefined || typeof record.pinned === 'boolean') && ['archivedAt', 'trashedAt'].every(field => record[field] === undefined || validDate(record[field]));
}
function historyFields(record) { return Object.fromEntries(['pinned', 'archivedAt', 'trashedAt'].filter(field => record[field] !== undefined).map(field => [field, record[field]])); }
function checkedHistory(input) {
  if (!input || !validId(input.workspaceId) || input.query !== undefined && (typeof input.query !== 'string' || input.query.length > 120) || input.scope !== undefined && !['active', 'archived', 'trash'].includes(input.scope) || input.cursor !== undefined && (!Number.isSafeInteger(input.cursor) || input.cursor < 0) || input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50)) throw Error('聊天搜索条件无效。');
  return { ...input, query: normalize(input.query || ''), scope: input.scope || 'active', cursor: input.cursor || 0, limit: input.limit || 30 };
}
function historyCandidates(items, scope) {
  return [...items].filter(item => scope === 'trash' ? !!item.trashedAt : scope === 'archived' ? !!item.archivedAt && !item.trashedAt : !item.archivedAt && !item.trashedAt).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}
function checkedManage(input) {
  if (!input || !validId(input.workspaceId) || !validId(input.conversationId) || !['rename', 'pin', 'unpin', 'archive', 'trash', 'restore'].includes(input.action) || input.action === 'rename' && (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 100 || /[\x00-\x1f]/.test(input.title))) throw Error('请填写有效的聊天名称或操作。');
  return input;
}
function applyHistory(record, input, time) {
  if (input.action === 'rename') record.title = input.title.trim();
  if (input.action === 'pin') record.pinned = true;
  if (input.action === 'unpin') delete record.pinned;
  if (input.action === 'archive') { record.archivedAt = time; delete record.trashedAt; }
  if (input.action === 'trash') record.trashedAt = time;
  if (input.action === 'restore') { delete record.trashedAt; delete record.archivedAt; }
  record.updatedAt = time; return record;
}
function targetValid(target) {
  return target && Object.keys(target).every(key => ['projectId', 'artifactId', 'sha256', 'kind', 'editorRevision'].includes(key)) && validId(target.projectId) && validId(target.artifactId) && /^[a-f0-9]{64}$/.test(target.sha256 || '') && ['image', 'word', 'ppt', 'excel'].includes(target.kind) && (target.editorRevision === undefined || Number.isSafeInteger(target.editorRevision) && target.editorRevision > 0);
}
function productionsValid(value) { return value === undefined || Array.isArray(value) && value.length <= 1000 && new Set(value.map(item => item?.runId)).size === value.length && value.every(item => item && Object.keys(item).every(key => ['runId', 'target', 'instruction', 'createdAt', 'sourceOnly', 'sourceRunId'].includes(key)) && validId(item.runId) && targetValid(item.target) && typeof item.instruction === 'string' && !!item.instruction.trim() && item.instruction.length <= 10000 && validDate(item.createdAt) && (item.sourceOnly === undefined || typeof item.sourceOnly === 'boolean') && (item.sourceRunId === undefined || validId(item.sourceRunId))); }
module.exports = { LIMIT, historyFieldsValid, historyFields, checkedHistory, historyCandidates, checkedManage, applyHistory, normalize, targetValid, productionsValid };
