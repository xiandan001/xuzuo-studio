const fs = require('node:fs/promises');
const path = require('node:path');
const { atomicJson, checkedDirectory, checkedFile } = require('./workspace-paths.cjs');
const id = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value);
const isMarketAnalysisPath = relative => /(?:^|\/)\.xuzuo\/bead-market-analysis-v1\.json$/.test(relative);
function checkedMarketAnalysis(value, projectId) {
  if (!value || value.version !== 1 || !id(value.projectId) || projectId && value.projectId !== projectId || !Array.isArray(value.requests) || value.requests.length > 40) throw Error('报价识读记录无效，原文件保留。');
  const identities = new Set();
  for (const row of value.requests) {
    if (!row || !/^[a-f0-9]{64}$/.test(row.identity) || row.sourceIdentity !== undefined && !/^[a-f0-9]{64}$/.test(row.sourceIdentity) || identities.has(row.identity) || !id(row.artifactId) || !id(row.requestId) || !/^[a-f0-9]{64}$/.test(row.dispatchKey) || row.runId !== undefined && !id(row.runId) || !['submitting', 'running', 'complete', 'failed', 'unknown'].includes(row.status) || typeof row.startedAt !== 'string' || !Number.isFinite(Date.parse(row.startedAt))) throw Error('报价识读记录格式无效，未重发模型请求。');
    identities.add(row.identity);
  }
  return value;
}
function createMarketAnalysisJournal({ workspaceStorage, fileSystem = fs }) {
  let tail = Promise.resolve();
  async function location(projectId) { if (!id(projectId)) throw Error('请选择本地拼豆项目。'); const directory = path.join(await workspaceStorage.projectDirectory(projectId), '.xuzuo'); await checkedDirectory(fileSystem, directory); return path.join(directory, 'bead-market-analysis-v1.json'); }
  async function read(projectId) { const filename = await location(projectId); try { const info = await checkedFile(fileSystem, filename); if (info.size > 65536) throw Error('识读记录超过安全容量。'); return checkedMarketAnalysis(JSON.parse(await fileSystem.readFile(filename, 'utf8')), projectId); } catch (error) { if (error.code === 'ENOENT') return { version: 1, projectId, requests: [] }; throw error; } }
  return { read: projectId => tail.then(() => read(projectId)), mutate(projectId, transform) { const task = tail.then(async () => { const value = checkedMarketAnalysis(await transform(await read(projectId)), projectId); await atomicJson(fileSystem, await location(projectId), value); return value; }); tail = task.catch(() => undefined); return task; }, drain: () => tail };
}
function remapMarketAnalysis(value, ids) { const checked = checkedMarketAnalysis(structuredClone(value)), map = id => Object.hasOwn(ids, id) ? ids[id] : id; checked.projectId = map(checked.projectId); checked.requests = checked.requests.map(row => ({ ...row, artifactId: map(row.artifactId), ...(row.runId ? { runId: map(row.runId) } : {}), ...(row.status === 'complete' ? {} : { status: 'unknown' }) })); return checkedMarketAnalysis(checked); }
module.exports = { createMarketAnalysisJournal, checkedMarketAnalysis, isMarketAnalysisPath, remapMarketAnalysis };
