const fields = ['minutes', 'rate', 'remaining', 'other', 'reserve', 'fee', 'profit', 'price', 'variable'];
const customerFields = ['client', 'scope', 'quantity', 'revisions', 'deliveryDate', 'validUntil', 'notes', 'contact'];
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const inputsValid = value => object(value) && fields.every(name => typeof value[name] === 'string' && value[name].length <= 64);
const customerValid = value => object(value) && customerFields.every(name => typeof value[name] === 'string' && value[name].length <= (name === 'scope' || name === 'notes' ? 4000 : 200));
function savedValid(value, workspaceId, projectId) {
  return object(value) && value.type === 'xuzuo-project-quote' && value.version === 1 && value.workspaceId === workspaceId && value.projectId === projectId && inputsValid(value.inputs) && ['single', 'repeat'].includes(value.mode) && ['live', 'simulation'].includes(value.scope) && typeof value.savedAt === 'string' && value.savedAt.length <= 100;
}
function validateQuoteBackups(records, projects) {
  if (records === undefined) return;
  if (!Array.isArray(records) || records.length > projects.length) throw Error('备份报价清单数量无效。');
  const seen = new Set();
  for (const record of records) {
    if (!object(record) || !projects.some(project => project.id === record.projectId && project.workspaceId === record.workspaceId && !project.purgedAt) || !record.saved && !record.working) throw Error('备份报价的项目归属无效。');
    const identity = `${record.workspaceId}\0${record.projectId}`;
    if (seen.has(identity)) throw Error('备份报价有重复项目。'); seen.add(identity);
    if (record.saved !== undefined && !savedValid(record.saved, record.workspaceId, record.projectId)) throw Error('备份正式报价无效。');
    const value = record.working;
    if (value !== undefined && (!object(value) || value.type !== 'xuzuo-quote-working' || value.version !== 1 || value.workspaceId !== record.workspaceId || value.projectId !== record.projectId || !inputsValid(value.inputs) || !customerValid(value.customer) || !['single', 'repeat'].includes(value.mode) || !['live', 'simulation'].includes(value.scope) || Object.hasOwn(value, 'baseSavedRaw') || typeof value.baseSavedMatchesCurrent !== 'boolean' || value.baseSaved !== null && !savedValid(value.baseSaved, record.workspaceId, record.projectId) || typeof value.updatedAt !== 'string' || value.updatedAt.length > 100)) throw Error('备份临时报价或版本基线无效。');
    if (value && (value.baseSavedMatchesCurrent ? JSON.stringify(value.baseSaved) !== JSON.stringify(record.saved || null) : value.baseSaved === null && !record.saved)) throw Error('备份报价的版本基线状态不一致。');
  }
}
module.exports = { validateQuoteBackups };
