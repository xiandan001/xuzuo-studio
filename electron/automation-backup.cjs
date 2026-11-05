const { createHash } = require('node:crypto');
const { ruleCreationFingerprint } = require('./automation-rule-identity.cjs');
const { normalizePreparation } = require('./automation-rule-preparation.cjs');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value);
const triggers = new Set(['manual', 'schedule', 'reference-imported', 'run-completed']);
const collections = ['rules', 'events', 'jobs', 'decisions', 'memories'];
const contextKeys = ['workspaces', 'projects', 'workflows', 'models', 'connections'];
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function unique(items, label) {
  if (!Array.isArray(items) || items.length > 20000 || items.some(item => !validId(item?.id)) || new Set(items.map(item => item.id)).size !== items.length) throw Error(`自动化备份的${label}编号或数量无效。`);
}
function validateAutomationBackup(records, scope = {}) {
  if (records === undefined) return;
  if (!object(records) || records.kind !== 'xuzuo-automation-backup' || records.version !== 1 || !object(records.context)) throw Error('自动化备份格式无效。');
  if (Buffer.byteLength(JSON.stringify(records)) > 16 * 1024 * 1024) throw Error('自动化备份索引超过16MB，请按项目分批备份。');
  for (const key of collections) unique(records[key], key);
  for (const key of contextKeys) unique(records.context[key], `context.${key}`);
  const owners = new Map(records.context.projects.map(project => [project.id, project.workspaceId])), workspaces = new Set(records.context.workspaces.map(workspace => workspace.id));
  const owns = value => validId(value?.workspaceId) && owners.get(value.projectId) === value.workspaceId;
  if (records.context.projects.some(project => !workspaces.has(project.workspaceId) || !['word', 'ppt', 'excel', 'image'].includes(project.kind)) || records.context.workflows.some(workflow => !workspaces.has(workflow.workspaceId) || !Array.isArray(workflow.steps))) throw Error('自动化备份上下文归属无效。');
  if (scope.projects && records.context.projects.some(project => !scope.projects.some(item => (item.id || item.projectId) === project.id && item.workspaceId === project.workspaceId)) || scope.workspaces && records.context.workspaces.some(workspace => !scope.workspaces.some(item => (item.id || item.workspaceId) === workspace.id))) throw Error('自动化备份超出所选项目或工作区。');
  const ruleShape = rule => (rule?.creationFingerprint === undefined || /^[a-f0-9]{64}$/.test(rule.creationFingerprint)) && (rule?.creationKey === undefined || validId(rule.creationKey)) && validId(rule?.workspaceId) && validId(rule.projectId) && typeof rule.enabled === 'boolean' && triggers.has(rule.trigger) && validId(rule.workflowId) && typeof rule.input === 'string' && rule.input.length <= 100000 && object(rule.variables) && Object.values(rule.variables).every(value => typeof value === 'string' && value.length <= 10000);
  const ruleValid = rule => owns(rule) && ruleShape(rule);
  if (records.rules.some(rule => !ruleValid(rule))) throw Error('自动化规则备份无效。');
  for (const rule of [...records.rules, ...records.jobs.map(job => job.ruleSnapshot).filter(Boolean)]) normalizePreparation(rule.preparation);
  const rules = new Set(records.rules.map(rule => rule.id)), jobs = new Map(records.jobs.map(job => [job.id, job]));
  if (records.jobs.some(job => !owns(job) || !rules.has(job.ruleId) || !['queued', 'dispatching', 'running', 'decision', 'complete', 'cancelled'].includes(job.status) || !/^[a-f0-9]{64}$/.test(job.dispatchKey) || job.ruleSnapshot && (!ruleShape(job.ruleSnapshot) || job.ruleSnapshot.projectId !== job.projectId || job.ruleSnapshot.id !== job.ruleId) || job.attachmentIds && (!Array.isArray(job.attachmentIds) || job.attachmentIds.some(id => !validId(id))))) throw Error('自动化派单备份无效。');
  if (records.events.some(event => !owns(event) || !triggers.has(event.trigger)) || records.decisions.some(card => !owns(card) || !jobs.has(card.jobId) || jobs.get(card.jobId).projectId !== card.projectId) || records.memories.some(memory => !owns(memory) || typeof memory.note !== 'string' || memory.note.length > 3000)) throw Error('自动化事件、决定或记忆归属无效。');
}

function exportAutomationBackup(state, { workspaceIds, projectIds } = {}) {
  if (!Array.isArray(workspaceIds) || !workspaceIds.length || workspaceIds.some(id => !validId(id)) || projectIds && (!Array.isArray(projectIds) || projectIds.some(id => !validId(id)))) throw Error('请选择自动化备份的工作区与项目范围。');
  const selectedProjects = state.context.projects.filter(project => workspaceIds.includes(project.workspaceId) && (!projectIds || projectIds.includes(project.id))), projects = new Set(selectedProjects.map(project => project.id));
  const scoped = entry => workspaceIds.includes(entry.workspaceId) && projects.has(entry.projectId);
  const entries = Object.fromEntries(collections.map(key => [key, state[key].filter(scoped)]));
  if (!collections.some(key => entries[key].length)) return undefined;
  const currentOwnerCopy = (snapshot, owner) => snapshot.workspaceId === owner ? structuredClone(snapshot) : { ...structuredClone(snapshot), workspaceId: owner, originWorkspaceId: snapshot.originWorkspaceId || snapshot.workspaceId };
  for (const job of entries.jobs) if (!entries.rules.some(rule => rule.id === job.ruleId)) { if (!job.ruleSnapshot) throw Error('自动化历史缺少规则快照，未创建不完整备份。'); entries.rules.push(currentOwnerCopy(job.ruleSnapshot, job.workspaceId)); }
  const workflowIds = new Set([...entries.rules.flatMap(rule => [rule.workflowId, rule.sourceWorkflowId]), ...entries.jobs.map(job => job.workflowSnapshot?.id)].filter(Boolean));
  const workflows = state.context.workflows.filter(workflow => workflowIds.has(workflow.id) && workspaceIds.includes(workflow.workspaceId));
  for (const job of entries.jobs) if (job.workflowSnapshot && !workflows.some(workflow => workflow.id === job.workflowSnapshot.id)) workflows.push(currentOwnerCopy(job.workflowSnapshot, job.workspaceId));
  const modelIds = new Set([...workflows, ...entries.jobs.map(job => job.workflowSnapshot).filter(Boolean)].flatMap(workflow => workflow.steps.map(step => step.modelConfigId)).filter(Boolean));
  const models = state.context.models.filter(model => modelIds.has(model.id)), connectionIds = new Set(models.map(model => model.connectionId));
  // Lazy lookup avoids the cycle with backup-format's optional extension validation.
  const { withoutSecrets } = require('./backup-format.cjs');
  const records = withoutSecrets({ kind: 'xuzuo-automation-backup', version: 1, ...entries, context: { workspaces: state.context.workspaces.filter(workspace => workspaceIds.includes(workspace.id)), projects: selectedProjects, workflows, models, connections: state.context.connections.filter(connection => connectionIds.has(connection.id)) } });
  validateAutomationBackup(records); return records;
}

function mergeAutomationBackup(current, { records, idMap, backupId, availableRuns, now = new Date().toISOString() }) {
  validateAutomationBackup(records);
  if (!records) return { changed: false, state: current };
  if (!validId(backupId) || !object(idMap) || !Array.isArray(availableRuns) || current.imports !== undefined && !Array.isArray(current.imports)) throw Error('自动化恢复所需的编号映射或运行记录无效。');
  const fingerprint = hash(records), mappingFingerprint = hash(Object.entries(idMap).sort(([first], [second]) => first.localeCompare(second))), previous = current.imports?.find(item => item.backupId === backupId);
  if (previous) { if (previous.fingerprint !== fingerprint || previous.mappingFingerprint !== mappingFingerprint) throw Error('同一备份的自动化恢复内容或编号映射已经变化，未覆盖现有记录。'); return { changed: false, state: current }; }
  for (const entry of [...collections.flatMap(key => records[key]), ...contextKeys.flatMap(key => records.context[key])]) if (!Object.hasOwn(idMap, entry.id) || !validId(idMap[entry.id])) throw Error('自动化恢复缺少实体编号映射，未沿用原机编号。');
  const { remap, withoutSecrets } = require('./backup-format.cjs'), restored = remap(withoutSecrets(records), idMap), sourceJobs = new Map(records.jobs.map(job => [idMap[job.id], job]));
  const added = Object.fromEntries(collections.map(key => [key, restored[key]])), pending = new Set();
  for (const rule of added.rules) { rule.enabled = false; rule.updatedAt = now; rule.lastTriggeredAt = now; if (rule.creationKey) rule.creationFingerprint = ruleCreationFingerprint(rule); rule.importOrigin = { backupId, sourceRuleId: records.rules.find(source => idMap[source.id] === rule.id).id }; }
  for (const job of added.jobs) {
    const source = sourceJobs.get(job.id), linked = availableRuns.find(run => run.projectId === job.projectId && run.workspaceId === job.workspaceId && (source.runId && run.id === idMap[source.runId] || run.dispatchKey === source.dispatchKey));
    job.importOrigin = { backupId, sourceJobId: source.id, ...(source.runId ? { sourceRunId: source.runId } : {}) }; job.dispatchKey = hash(['restored-automation', backupId, source.dispatchKey]);
    if (linked) job.runId = linked.id; else delete job.runId;
    const unfinished = !['complete', 'cancelled'].includes(source.status) || source.status === 'complete' && !linked || added.decisions.some(card => card.jobId === job.id && !card.resolvedAt);
    if (unfinished) { pending.add(job.id); job.status = 'decision'; job.error = '从内部备份恢复，未自动续跑。请先检查已有结果和费用、重新配置凭据，再明确决定是否继续。'; job.updatedAt = now; job.cancelRequested = false; }
  }
  for (const card of added.decisions) if (!card.resolvedAt && pending.has(card.jobId)) { card.kind = 'uncertain'; card.title = '恢复的自动化任务需要检查'; card.detail = added.jobs.find(job => job.id === card.jobId).error; card.runId = added.jobs.find(job => job.id === card.jobId).runId; delete card.action; }
  for (const job of added.jobs.filter(job => pending.has(job.id))) if (!added.decisions.some(card => card.jobId === job.id && !card.resolvedAt)) added.decisions.push({ id: hash(['restored-decision', backupId, sourceJobs.get(job.id).id]), jobId: job.id, runId: job.runId, workspaceId: job.workspaceId, projectId: job.projectId, kind: 'uncertain', title: '恢复的自动化任务需要检查', detail: job.error, createdAt: now });
  const state = structuredClone(current);
  for (const key of collections) { const ids = new Set(state[key].map(entry => entry.id)); if (added[key].some(entry => ids.has(entry.id))) throw Error('恢复的自动化编号已存在，未覆盖当前规则或历史。'); state[key].push(...added[key]); }
  for (const key of contextKeys) {
    for (const entry of restored.context[key]) {
      const previous = state.context[key].find(item => item.id === entry.id);
      if (previous && (key === 'projects' && (previous.workspaceId !== entry.workspaceId || previous.kind !== entry.kind) || key === 'workflows' && previous.workspaceId !== entry.workspaceId)) throw Error('恢复自动化的上下文归属冲突，未覆盖当前配置。');
      if (!previous) state.context[key].push(entry);
    }
  }
  state.imports = [...(state.imports || []), { backupId, fingerprint, mappingFingerprint, importedAt: now }]; return { changed: true, state };
}
module.exports = { validateAutomationBackup, exportAutomationBackup, mergeAutomationBackup };
