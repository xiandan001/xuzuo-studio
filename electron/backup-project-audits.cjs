const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value);
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const auditFields = new Set(['id', 'workspaceId', 'name', 'kind', 'status', 'description', 'updatedAt', 'costCents', 'version', 'accent', 'trashedAt', 'purgedAt', 'liveLedgerBaselineCents']);

function purgedProjectAudit(project) {
  if (!project || !validId(project.id) || !validId(project.workspaceId) || typeof project.name !== 'string' || !project.name.trim() || !['word', 'ppt', 'excel', 'image'].includes(project.kind) || !validTime(project.purgedAt) || !Number.isSafeInteger(project.costCents) || project.costCents < 0) throw Error('备份永久移除项目的审计归属、时间或金额无效。');
  return { id: project.id, workspaceId: project.workspaceId, name: project.name, kind: project.kind, status: 'draft', description: '',
    updatedAt: validTime(project.updatedAt) ? project.updatedAt : project.purgedAt, costCents: project.costCents,
    version: Number.isSafeInteger(project.version) && project.version >= 0 ? project.version : 0,
    accent: ['purple', 'orange', 'green', 'blue'].includes(project.accent) ? project.accent : 'purple',
    trashedAt: validTime(project.trashedAt) ? project.trashedAt : project.purgedAt, purgedAt: project.purgedAt,
    ...(Number.isSafeInteger(project.liveLedgerBaselineCents) && project.liveLedgerBaselineCents >= 0 ? { liveLedgerBaselineCents: project.liveLedgerBaselineCents } : {}) };
}

function validatePurgedProjectAudits(projects) {
  for (const project of projects.filter(item => item.purgedAt !== undefined)) {
    const audit = purgedProjectAudit(project);
    if (Object.keys(project).some(field => !auditFields.has(field)) || JSON.stringify(project.description) !== '""' || project.status !== 'draft' || !validTime(project.trashedAt) || !validTime(project.updatedAt) || project.version !== audit.version || project.accent !== audit.accent || project.liveLedgerBaselineCents !== audit.liveLedgerBaselineCents) throw Error('永久移除项目的备份只能包含费用审计，不能包含目录、正文、引用或可恢复内容。');
  }
}

module.exports = { purgedProjectAudit, validatePurgedProjectAudits };
