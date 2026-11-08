const fsDefault = require('node:fs/promises');
const path = require('node:path');
const { atomicJson, checkedDirectory, checkedFile } = require('./workspace-paths.cjs');
const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value);
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const isAnimationJournalPath = value => /(?:^|\/)\.xuzuo\/animation-jobs-v1\.json$/.test(value);
function checkedAnimationJournal(value, projectId) {
  if (!value || value.version !== 1 || !validId(value.projectId) || projectId && value.projectId !== projectId || !Array.isArray(value.jobs) || value.jobs.length > 30) throw Error('动画任务记录无效，原文件保留。');
  const ids = new Set();
  for (const job of value.jobs) {
    if (!job || !validId(job.id) || ids.has(job.id) || job.projectId !== value.projectId || !['running', 'complete', 'cancelled', 'failed', 'interrupted'].includes(job.status) || !['generating', 'composing', 'checking', 'complete'].includes(job.stage) || !Array.isArray(job.entryIds) || job.entryIds.length > 100 || job.entryIds.some(id => !validId(id)) || !Array.isArray(job.completedEntryIds) || job.completedEntryIds.some(id => !job.entryIds.includes(id)) || !Array.isArray(job.runIds) || job.runIds.some(id => !validId(id)) || !Array.isArray(job.operations) || job.operations.length > 100 || typeof job.createdAt !== 'string' || typeof job.updatedAt !== 'string' || !Number.isFinite(Date.parse(job.createdAt)) || !Number.isFinite(Date.parse(job.updatedAt))) throw Error('动画任务内容或归属无效，未重发请求。');
    ids.add(job.id);
    if (job.error !== undefined && (typeof job.error !== 'string' || job.error.length > 4000)) throw Error('动画任务错误说明超过安全容量。');
    if (job.kind !== undefined && !['generate', 'refine', 'compose'].includes(job.kind) || job.request !== undefined && (!job.request || job.request.projectId !== value.projectId || job.request.entryIds !== undefined && (!Array.isArray(job.request.entryIds) || job.request.entryIds.some(id => !validId(id))) || job.request.instruction !== undefined && (typeof job.request.instruction !== 'string' || job.request.instruction.length > 4000) || job.request.entryId !== undefined && !validId(job.request.entryId) || job.request.frameId !== undefined && !validId(job.request.frameId) || job.request.resumeJobId !== undefined && !validId(job.request.resumeJobId) || job.request.sampleAnchorId !== undefined && !validId(job.request.sampleAnchorId))) throw Error('动画续作操作记录无效。');
    for (const operation of job.operations) if (!validId(operation.entryId) || !sha(operation.sourceHash) || !sha(operation.dispatchKey) || !['submitting', 'running', 'complete', 'failed', 'unknown'].includes(operation.status) || operation.runId !== undefined && !validId(operation.runId) || operation.artifactId !== undefined && !validId(operation.artifactId)) throw Error('动画派发记录无效，未重发请求。');
  }
  return value;
}
function createAnimationJournal({ workspaceStorage, fileSystem = fsDefault }) {
  let tail = Promise.resolve();
  async function filename(projectId) { if (!validId(projectId)) throw Error('请选择有效动画项目。'); const directory = path.join(await workspaceStorage.projectDirectory(projectId), '.xuzuo'); await checkedDirectory(fileSystem, directory); return path.join(directory, 'animation-jobs-v1.json'); }
  async function read(projectId) { const file = await filename(projectId); try { const info = await checkedFile(fileSystem, file); if (info.size > 2 * 1024 * 1024) throw Error('动画任务记录超过安全容量。'); return checkedAnimationJournal(JSON.parse(await fileSystem.readFile(file, 'utf8')), projectId); } catch (error) { if (error.code === 'ENOENT') return { version: 1, projectId, jobs: [] }; throw error; } }
  return { read: projectId => tail.then(() => read(projectId)), mutate(projectId, transform) { const task = tail.then(async () => { const value = checkedAnimationJournal(await transform(await read(projectId)), projectId); if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 2 * 1024 * 1024) throw Error('动画任务记录超过安全保存容量，原记录保留。'); await atomicJson(fileSystem, await filename(projectId), value); return value; }); tail = task.catch(() => undefined); return task; }, drain: () => tail };
}
function remapAnimationJournal(value, ids) { const result = checkedAnimationJournal(structuredClone(value)), map = id => Object.hasOwn(ids, id) ? ids[id] : id; result.projectId = map(result.projectId); result.jobs = result.jobs.map(job => ({ ...job, projectId: result.projectId, ...(job.request ? { request: { ...job.request, projectId: result.projectId, ...(job.request.sampleAnchorId ? { sampleAnchorId: map(job.request.sampleAnchorId) } : {}) } } : {}), requiresExplicitRestart: true, runIds: job.runIds.map(map), status: job.status === 'running' ? 'interrupted' : job.status, operations: job.operations.map(row => ({ ...row, ...(row.runId ? { runId: map(row.runId) } : {}), ...(row.artifactId ? { artifactId: map(row.artifactId) } : {}), status: row.status === 'complete' ? row.status : 'unknown' })) })); return checkedAnimationJournal(result); }
module.exports = { createAnimationJournal, checkedAnimationJournal, remapAnimationJournal, isAnimationJournalPath };
