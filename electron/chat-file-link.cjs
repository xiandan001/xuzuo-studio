const { createHash } = require('node:crypto');
const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const kinds = ['word', 'ppt', 'excel'];
function chatExportsValid(value) {
  return value === undefined || Array.isArray(value) && value.length <= 100 && new Set(value.map(item => item?.runId)).size === value.length && value.every(item => item && Object.keys(item).every(key => ['runId', 'projectId', 'turnId', 'kind', 'sourceSha256', 'createdAt', 'sourceOnly'].includes(key)) && ['runId', 'projectId', 'turnId'].every(key => validId(item[key])) && kinds.includes(item.kind) && hash(item.sourceSha256) && Number.isFinite(Date.parse(item.createdAt)) && (item.sourceOnly === undefined || typeof item.sourceOnly === 'boolean'));
}
function checkedChatExport(record, input, run) {
  const turn = record.turns.find(item => item.id === input.turnId), source = run?.snapshot?.sourceChat;
  if (!validId(input.runId) || !validId(input.turnId) || !kinds.includes(input.kind) || !hash(input.sourceSha256) || !turn || turn.status !== 'complete' || turn.mode === 'plan' || !turn.text.trim() || createHash('sha256').update(turn.text).digest('hex') !== input.sourceSha256) throw Error('原回复尚未完整保存或已变化，请重新选择回复；原文件保留。');
  const steps = run?.snapshot?.steps?.filter(step => step.enabled !== false);
  if (!run || run.id !== input.runId || run.mode !== 'live' || run.workspaceId !== input.workspaceId || run.snapshot.outputKind !== input.kind || source?.conversationId !== input.conversationId || source.turnId !== input.turnId || source.sha256 !== input.sourceSha256 || !steps?.length || steps.some(step => step.kind !== 'export')) throw Error('这项保存任务没有绑定当前回复，尚未关联；不会重复导出。');
  if (record.trashedAt) throw Error('请先恢复聊天，已导出的文件保留。');
  const existing = record.exports?.find(item => item.runId === input.runId);
  if (existing) { if (existing.projectId !== run.projectId || existing.turnId !== input.turnId || existing.kind !== input.kind || existing.sourceSha256 !== input.sourceSha256) throw Error('这项保存已有不同的来源关联。'); return existing; }
  if ((record.exports?.length || 0) >= 100) throw Error('本段聊天已保存100次文件，请从项目查看；原文件保留。');
  return { runId: run.id, projectId: run.projectId, turnId: input.turnId, kind: input.kind, sourceSha256: input.sourceSha256, createdAt: run.createdAt };
}
module.exports = { chatExportsValid, checkedChatExport };
