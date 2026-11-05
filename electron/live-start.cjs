const { createHash } = require('node:crypto');
const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value);
const admissions = new WeakMap();
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, stable(value[key])]));
  return value;
}
function startFingerprint(request) {
  const { updatedAt: _updated, ...workflow } = request.workflow;
  const project = Object.fromEntries(['id', 'workspaceId', 'kind', 'name', 'budgetCents'].map(key => [key, request.project[key]]));
  const { project: _project, workflow: _workflow, dispatchKey: _key, ...rest } = request;
  return createHash('sha256').update(JSON.stringify(stable({ ...rest, project, workflow }))).digest('hex');
}
function checkLookup(input) {
  if (!input || !validId(input.projectId) || !validId(input.workspaceId) || typeof input.dispatchKey !== 'string' || !/^[a-f0-9]{64}$/.test(input.dispatchKey)) throw Error('启动查询归属或编号无效。');
  return input;
}
async function lookupStart(liveEngine, input) {
  checkLookup(input);
  while (true) { const pending = admissions.get(liveEngine)?.get(input.projectId); if (!pending?.size) break; await Promise.allSettled([...pending]); }
  const run = await liveEngine.lookupStart(input);
  return run ? { status: 'started', run } : { status: 'not-found' };
}
async function performStart(liveEngine, start, input) {
  try { return { status: 'started', run: await start(input) }; }
  catch (error) {
    const message = typeof error.message === 'string' ? error.message.slice(0, 1000) : '本次启动未完成，请查看当前任务。';
    if (error.code === 'START_KEY_CHANGED') return { status: 'rejected', error: message, code: error.code };
    try {
      const run = await liveEngine.lookupStart(checkLookup({ projectId: input?.project?.id, workspaceId: input?.project?.workspaceId, dispatchKey: input?.dispatchKey }));
      if (run) return { status: 'started', run, recovered: true };
      return { status: 'rejected', error: message, ...(typeof error.code === 'string' ? { code: error.code } : {}) };
    } catch {
      return { status: 'unknown', error: '启动结果暂不能可靠读取；原请求和费用保留，请读取已有任务。', dispatchKey: typeof input?.dispatchKey === 'string' ? input.dispatchKey : '' };
    }
  }
}
function startChecked(liveEngine, start, input) {
  let projects = admissions.get(liveEngine); if (!projects) { projects = new Map(); admissions.set(liveEngine, projects); }
  const id = input?.project?.id; let pending = projects.get(id); if (!pending) { pending = new Set(); projects.set(id, pending); }
  const task = performStart(liveEngine, start, input).finally(() => { pending.delete(task); if (!pending.size) projects.delete(id); }); pending.add(task); return task;
}
module.exports = { startFingerprint, lookupStart, startChecked };
