const fsDefault = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { atomicJson, checkedDirectory, checkedFile, key } = require('./workspace-paths.cjs');
const { inspectPurgeDirectory, removePurgeTree } = require('./project-purge-paths.cjs');
const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(value);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone = value => structuredClone(value);

function createProjectPurge({ directory, workspaceStorage, automationCenter, liveEngine, fileSystem = fsDefault, protectedRoots = [], withExclusive = async (_id, action) => action(), clock = Date.now }) {
  const fs = fileSystem, filename = path.join(path.resolve(directory), 'project-purge-v1.json'), previews = new Map();
  let state = { version: 1, requests: [] }, writes = Promise.resolve();
  const executing = new Set(), submitted = new Map();
  const purgedIds = new Set(); let auditIndex = [], pendingPathIndex = [];
  function refreshIndex() {
    purgedIds.clear(); auditIndex = []; const pending = new Set();
    for (const request of state.requests) for (const item of request.items) if (item.recordPurged) {
      purgedIds.add(item.projectId); const blockedDirectories = item.filesPending ? [...new Set([item.quarantine, ...(item.phase === 'isolated' ? [] : [item.directory])].filter(Boolean))] : [];
      blockedDirectories.forEach(directory => pending.add(directory)); auditIndex.push({ ...publicItem(item), directories: item.directories || [], blockedDirectories });
    }
    pendingPathIndex = [...pending];
  }
  const now = () => new Date(clock()).toISOString();
  const ready = (async () => {
    await workspaceStorage.ready;
    await checkedDirectory(fs, directory, true);
    try {
      const stat = await checkedFile(fs, filename); if (stat.size > 32 * 1024 * 1024) throw Error('size'); const value = JSON.parse(await fs.readFile(filename, 'utf8'));
      if (value?.version !== 1 || !Array.isArray(value.requests) || new Set(value.requests.map(item => item.id)).size !== value.requests.length) throw Error('shape');
      for (const request of value.requests) {
        const selected = scope(request);
        if (!Number.isFinite(Date.parse(request.createdAt)) || request.finishedAt !== undefined && !Number.isFinite(Date.parse(request.finishedAt))) throw Error('request time');
        if (!validId(request.id) || request.inputHash !== digest(selected) || !Array.isArray(request.items) || request.items.length !== selected.projectIds.length || request.items.some((row, index) => row.projectId !== selected.projectIds[index] || row.workspaceId !== selected.workspaceId || row.requestId !== request.id || !['ppt','word','excel','image'].includes(row.kind) || typeof row.name !== 'string' || !Number.isSafeInteger(row.costCents) || row.costCents < 0 || !['recordPurged','filesDeleted','folderMissing','filesPending','retryable'].every(key => typeof row[key] === 'boolean') || row.recordPurged && !Number.isFinite(Date.parse(row.purgedAt)) || row.directory !== undefined && !path.isAbsolute(row.directory) || row.error !== undefined && (typeof row.error !== 'string' || row.error.length > 1800))) throw Error('shape');
        for (const row of request.items) if (row.filesPending) {
          if (!row.directory || row.quarantine !== path.join(path.dirname(row.directory), `.xuzuo-purge-${digest([request.id, row.projectId]).slice(0, 24)}`) || !row.proof || typeof row.proof.identity !== 'string' || !/^[a-f0-9]{64}$/.test(row.proof.markerHash) || !['prepared', 'isolated'].includes(row.phase)) throw Error('pending shape');
        }
      }
      state = value; refreshIndex();
    } catch (error) { if (error.code !== 'ENOENT') throw Error('永久移除记录无法可靠读取，未允许项目写入或删除文件。'); }
  })(); void ready.catch(() => undefined);
  const serial = action => { const task = writes.then(async () => { await ready; return action(); }); writes = task.catch(() => undefined); return task; };
  async function change(action) { const next = clone(state); action(next); if (Buffer.byteLength(JSON.stringify(next)) > 32 * 1024 * 1024) throw Error('永久移除审计超过32MB，未执行新操作。'); await atomicJson(fs, filename, next); state = next; refreshIndex(); }
  const audits = () => auditIndex;
  const isPurged = projectId => purgedIds.has(projectId);
  function scope(input) {
    if (!input || !validId(input.workspaceId) || !Array.isArray(input.projectIds) || !input.projectIds.length || input.projectIds.length > 100 || input.projectIds.some(id => !validId(id)) || new Set(input.projectIds).size !== input.projectIds.length || typeof input.deleteFiles !== 'boolean') throw Error('请选择同一工作区内1至100个回收站项目及删除方式。');
    return { workspaceId: input.workspaceId, projectIds: [...input.projectIds], deleteFiles: input.deleteFiles };
  }
  const binding = (metadata, projectId) => ({ project: metadata.projects.find(item => item.projectId === projectId) || null, locations: metadata.locations.filter(item => item.projectId === projectId), workspace: metadata.workspaces.find(item => item.workspaceId === metadata.projects.find(project => project.projectId === projectId)?.workspaceId) || null });
  function publicItem(item) {
    const fields = ['projectId','workspaceId','name','kind','trashedAt','purgedAt','costCents','updatedAt','requestId','recordPurged','filesDeleted','folderMissing','filesPending','error','retryable','directory'];
    return { ...Object.fromEntries(fields.filter(key => item[key] !== undefined).map(key => [key, item[key]])), ...(item.filesPending && typeof item.cleanupDirectory === 'string' && path.isAbsolute(item.cleanupDirectory) ? { cleanupDirectory: item.cleanupDirectory } : {}), ...(item.filesPending && item.phase === 'isolated' && typeof item.quarantine === 'string' && path.isAbsolute(item.quarantine) ? { cleanupDirectory: item.quarantine } : {}) };
  }
  const receipt = request => ({ id: request.id, requestId: request.id, workspaceId: request.workspaceId, projectIds: request.projectIds, deleteFiles: request.deleteFiles, inProgress: executing.has(request.id), ...(request.finishedAt ? { finishedAt: request.finishedAt } : {}), complete: Boolean(request.finishedAt) && !executing.has(request.id) && request.items.every(item => !item.filesPending && !item.retryable && (!item.recordPurged || item.metadataComplete)), items: request.items.map(publicItem) });
  async function target(projectId, workspaceId, deleteFiles) {
    const project = await automationCenter.getProjectPurgeContext({ projectId, workspaceId }), metadata = await workspaceStorage.purgeMetadata();
    const registered = metadata.projects.find(item => item.projectId === projectId);
    if (registered && registered.workspaceId !== workspaceId) throw Error('项目目录属于其它工作区。');
    const native = await liveEngine.snapshot(undefined, { summaryOnly: true, projectIds: [projectId] }), nativeCost = native.ledger.filter(entry => entry.projectId === projectId && Number.isSafeInteger(entry.costCents)).reduce((sum, entry) => sum + entry.costCents, 0);
    if (!Number.isSafeInteger(nativeCost)) throw Error('项目费用超出安全计量范围，请先核对账本。');
    const frozen = binding(metadata, projectId), item = { projectId, workspaceId, name: project.name, kind: project.kind, trashedAt: project.trashedAt, costCents: Math.max(nativeCost, Number.isSafeInteger(project.costCents) && project.costCents >= 0 ? project.costCents : 0), updatedAt: project.updatedAt || project.trashedAt, ...(registered ? { directory: registered.directory } : {}), directories: [...new Set(metadata.locations.filter(item => item.projectId === projectId).map(item => item.directory).concat(registered ? [registered.directory] : []))], bindingHash: digest(frozen), recordPurged: false, filesDeleted: false, folderMissing: false, filesPending: false, retryable: false };
    if (deleteFiles) {
      try {
        if (!registered) item.folderMissing = true;
        else { if (metadata.transitionalProjectIds.includes(projectId)) throw Error('项目迁移尚未完成，请改选仅移除记录或先完成迁移。'); item.proof = await inspectPurgeDirectory({ fs, target: item, metadata, protectedRoots }); item.folderMissing = item.proof.missing; }
      } catch (error) { item.error = String(error.message).slice(0, 1800); }
    }
    return item;
  }
  async function finalizeMetadata(item) {
    await automationCenter.sealProjectPurge({ projectId: item.projectId, workspaceId: item.workspaceId });
    await workspaceStorage.forgetProject({ projectId: item.projectId, workspaceId: item.workspaceId, audit: { ...publicItem(item), directories: item.directories || [] } });
  }
  async function executeItem(requestId, projectId) {
    let request = state.requests.find(item => item.id === requestId), item = request.items.find(item => item.projectId === projectId);
    if (item.recordPurged && !item.filesPending && item.metadataComplete) return;
    await withExclusive(projectId, async () => {
      const release = await automationCenter.reserveProject(projectId, { allowReview: true });
      try {
        if (await liveEngine.isProjectBusy?.(projectId, { allowReview: true })) throw Error('项目请求或取消收尾尚未完成，请结束后再永久移除。');
        request = state.requests.find(item => item.id === requestId); item = request.items.find(item => item.projectId === projectId);
        if (!item.recordPurged) {
          if (item.error) return;
          const current = await target(projectId, request.workspaceId, request.deleteFiles);
          if (current.error) throw Error(current.error);
          if (current.bindingHash !== item.bindingHash || current.directory && key(current.directory) !== key(item.directory) || request.deleteFiles && !current.folderMissing && (current.proof.identity !== item.proof?.identity || current.proof.markerHash !== item.proof?.markerHash)) throw Error('确认后项目归属、目录或身份已变化，请重新预览。');
          await change(next => { const row = next.requests.find(value => value.id === requestId).items.find(value => value.projectId === projectId); row.recordPurged = true; row.purgedAt = now(); row.folderMissing = current.folderMissing; row.filesPending = request.deleteFiles && !current.folderMissing; row.retryable = row.filesPending; row.phase = 'prepared'; if (row.filesPending) { row.quarantine = path.join(path.dirname(row.directory), `.xuzuo-purge-${digest([requestId, projectId]).slice(0, 24)}`); row.directories = [...new Set([...row.directories, row.quarantine])]; } delete row.error; });
          item = state.requests.find(value => value.id === requestId).items.find(value => value.projectId === projectId);
        }
        await finalizeMetadata(item);
        await change(next => { next.requests.find(value => value.id === requestId).items.find(value => value.projectId === projectId).metadataComplete = true; });
        if (!request.deleteFiles || item.folderMissing) {
          await change(next => { const row = next.requests.find(value => value.id === requestId).items.find(value => value.projectId === projectId); row.filesPending = false; row.retryable = false; delete row.error; }); return;
        }
        if (!item.filesPending) return;
        const metadata = await workspaceStorage.purgeMetadata(), quarantined = await fs.lstat(item.quarantine).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (!quarantined && item.phase === 'isolated') {
          await change(next => { const row = next.requests.find(value => value.id === requestId).items.find(value => value.projectId === projectId); row.filesPending = false; row.filesDeleted = true; row.retryable = false; delete row.error; }); return;
        }
        if (!quarantined) {
          const current = await inspectPurgeDirectory({ fs, target: item, metadata, protectedRoots, expected: item.proof });
          if (current.missing) { await change(next => { const row = next.requests.find(value => value.id === requestId).items.find(value => value.projectId === projectId); row.folderMissing = true; row.filesPending = false; row.retryable = false; delete row.error; }); return; }
          await fs.rename(item.directory, item.quarantine);
        }
        await inspectPurgeDirectory({ fs, target: { ...item, directory: item.quarantine }, metadata, protectedRoots, expected: item.proof, quarantine: true });
        await change(next => { next.requests.find(value => value.id === requestId).items.find(value => value.projectId === projectId).phase = 'isolated'; });
        await removePurgeTree(fs, item.quarantine, item.proof);
        await change(next => { const row = next.requests.find(value => value.id === requestId).items.find(value => value.projectId === projectId); row.filesDeleted = true; row.filesPending = false; row.retryable = false; row.phase = 'complete'; delete row.error; });
      } finally { await release(); }
    });
  }
  function execute(input) {
    let inputHash; try { inputHash = digest(scope(input)); if (!validId(input.id)) throw Error('永久移除请求编号无效。'); } catch (error) { return Promise.reject(error); }
    const id = input.id, previous = submitted.get(id);
    if (previous) return previous.inputHash === inputHash ? previous.task : Promise.reject(Error('此请求编号已用于不同的项目、归属或删除方式。'));
    const task = executeQueued(clone(input)); submitted.set(id, { inputHash, task });
    void task.finally(() => { if (submitted.get(id)?.task === task) submitted.delete(id); }).catch(() => undefined); return task;
  }
  function executeQueued(input) { return serial(async () => {
      const selected = scope(input); if (!validId(input.id)) throw Error('永久移除请求编号无效。'); const inputHash = digest(selected);
      let request = state.requests.find(item => item.id === input.id);
      if (request) { if (request.inputHash !== inputHash) throw Error('此请求编号已用于不同的项目、归属或删除方式。'); if (request.finishedAt && request.items.every(item => !item.retryable)) return receipt(request); }
      else {
        const preview = previews.get(input.selectionId);
        if (!preview || preview.expiresAt < clock() || digest(scope(preview)) !== inputHash) throw Error('删除预览已过期或范围改变，请重新确认。');
        request = { id: input.id, ...selected, inputHash, createdAt: now(), items: preview.items.map(item => ({ ...item, requestId: input.id })) };
        await change(next => next.requests.push(clone(request))); previews.delete(input.selectionId);
      }
      executing.add(input.id);
      try {
        for (const id of selected.projectIds) {
          try { await executeItem(input.id, id); }
          catch (error) { await change(next => { const row = next.requests.find(value => value.id === input.id).items.find(value => value.projectId === id); row.error = String(error.message).slice(0, 1800); row.filesPending = row.recordPurged && selected.deleteFiles && !row.folderMissing; row.retryable = row.recordPurged && (row.filesPending || !row.metadataComplete); }); }
        }
        await change(next => { next.requests.find(value => value.id === input.id).finishedAt = now(); });
      } finally { executing.delete(input.id); }
      return receipt(state.requests.find(item => item.id === input.id));
    }); }
  return {
    ready, isPurged, audits, blockedPaths: () => pendingPathIndex,
    preview: input => serial(async () => {
      const selected = scope(input), items = [];
      for (const id of selected.projectIds) items.push(await target(id, selected.workspaceId, selected.deleteFiles));
      const selectionId = randomUUID(); if (previews.size >= 100) previews.delete(previews.keys().next().value);
      previews.set(selectionId, { ...selected, items, expiresAt: clock() + 10 * 60 * 1000 });
      return { selectionId, ...selected, items: items.map(publicItem) };
    }),
    execute,
    async status(input) { await ready; const request = state.requests.find(item => item.id === input?.id && item.workspaceId === input?.workspaceId); return request ? receipt(request) : null; },
    async tombstones({ workspaceId } = {}) { await ready; if (!validId(workspaceId)) throw Error('工作区编号无效。'); return (await workspaceStorage.listPurges()).filter(item => item.workspaceId === workspaceId).map(item => publicItem({ recordPurged: true, filesDeleted: false, folderMissing: false, filesPending: false, retryable: false, ...item })); },
    drain: () => writes,
  };
}
module.exports = { createProjectPurge };
