const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { validId, withoutSecrets } = require('./backup-format.cjs');
const { checkedDirectory, atomicJson } = require('./workspace-paths.cjs');
const { fsDefault, digest, readJson, aborted } = require('./incremental-backup-paths.cjs');

function workspaceMeta(input, workspaceId) {
  if (!validId(workspaceId) || !input || !Array.isArray(input.workspaces) || !input.workspaces.some(item => item.id === workspaceId && !item.removedAt) || !Array.isArray(input.projects) || !Array.isArray(input.ledger) || !Array.isArray(input.customPrompts) || !input.configuration || !input.preferencesByWorkspace) throw Error('自动备份需要已成功保存的工作区索引。');
  const value = withoutSecrets(input), projects = value.projects.filter(item => item.workspaceId === workspaceId), ids = new Set(projects.map(item => item.id));
  const meta = { ...value, activeWorkspaceId: workspaceId, workspaces: value.workspaces.filter(item => item.id === workspaceId), projects, ledger: value.ledger.filter(item => ids.has(item.projectId)), customPrompts: value.customPrompts.filter(item => !item.workspaceId || item.workspaceId === workspaceId), preferencesByWorkspace: { [workspaceId]: value.preferencesByWorkspace[workspaceId] || {} }, configuration: Object.fromEntries(Object.entries(value.configuration).map(([name, items]) => [name, Array.isArray(items) ? items.filter(item => !item.workspaceId || item.workspaceId === workspaceId) : items])), ...(value.quoteDrafts ? { quoteDrafts: value.quoteDrafts.filter(item => ids.has(item.projectId)) } : {}) };
  const encoded = JSON.stringify(meta); if (Buffer.byteLength(encoded) > 16 * 1024 * 1024) throw Error('自动备份管理索引超过16MB，请按项目手动备份。');
  return { meta, hash: digest(encoded) };
}
function createBackupScheduler({ directory, backupManager, isIdle = () => true, yieldBackground, onChanged = () => undefined, fileSystem = fsDefault, now = Date.now, intervalMs = 15000, settleMs = 2000 } = {}) {
  const fs = fileSystem, filename = path.join(path.resolve(directory), 'incremental-backup-settings-v1.json');
  const scopes = new Map(), revisions = new Map(), dirty = new Set(), metadata = new Map(), errors = new Map(), metadataIssues = new Set();
  let ownerId, loadIssue, timer, wakeTimer, started = false, closing = false, checking = false, activeJob, configWrites = Promise.resolve(), lastChange = 0;
  const emit = workspaceId => { try { onChanged({ workspaceId }); } catch { /* Persisted snapshots do not depend on a live renderer. */ } };
  async function load() {
    await checkedDirectory(fs, path.resolve(directory), true);
    let value;
    try { value = await readJson(fs, filename, 1024 * 1024); }
    catch (error) { if (error.code !== 'ENOENT') throw error; ownerId = randomUUID(); return; }
    if (value.kind !== 'xuzuo-backup-scheduler' || value.version !== 1 || !validId(value.ownerId) || !Array.isArray(value.workspaces) || value.workspaces.length > 1000 || new Set(value.workspaces.map(item => item.workspaceId)).size !== value.workspaces.length) throw Error('自动备份设置无效，原设置文件没有被替换。');
    ownerId = value.ownerId;
    for (const item of value.workspaces) {
      if (!validId(item.workspaceId) || typeof item.enabled !== 'boolean' || typeof item.repository !== 'string' || !path.isAbsolute(item.repository) || item.lastSuccess !== undefined && !Number.isFinite(Date.parse(item.lastSuccess)) || item.lastMetaHash !== undefined && !/^[a-f0-9]{64}$/.test(item.lastMetaHash)) throw Error('自动备份位置或状态无效，原设置没有被替换。');
      scopes.set(item.workspaceId, item);
    }
  }
  const ready = load().catch(error => { loadIssue = String(error?.message || error); });
  async function assertReady() { await ready; if (loadIssue) throw Error(loadIssue); }
  function persist() {
    const value = { kind: 'xuzuo-backup-scheduler', version: 1, ownerId, workspaces: [...scopes.values()].map(item => ({ ...item })) };
    if (Buffer.byteLength(JSON.stringify(value)) > 1024 * 1024) throw Error('自动备份设置超过1MB，未覆盖已有配置。');
    const pending = configWrites.then(() => atomicJson(fs, filename, value)); configWrites = pending.catch(() => undefined); return pending;
  }
  function view(workspaceId) {
    const scope = scopes.get(workspaceId), running = activeJob?.workspaceId === workspaceId;
    return { workspaceId, enabledWorkspaceIds: [...scopes].filter(([, item]) => item.enabled).map(([id]) => id), available: !loadIssue, configured: Boolean(scope), enabled: Boolean(scope?.enabled), repository: scope?.repository, lastSuccess: scope?.lastSuccess, lastSnapshot: scope?.lastSnapshot, files: scope?.files, bytes: scope?.bytes, newBytes: scope?.newBytes, running, pending: Boolean(scope?.enabled && dirty.has(workspaceId)), waitingForMeta: Boolean(scope?.enabled && !metadata.has(workspaceId)), error: loadIssue || errors.get(workspaceId) };
  }
  function changed(workspaceId) { revisions.set(workspaceId, (revisions.get(workspaceId) || 0) + 1); dirty.add(workspaceId); lastChange = now(); if (activeJob?.workspaceId === workspaceId) activeJob.controller.abort(); emit(workspaceId); }
  function wake() {
    if (!started || closing || wakeTimer) return;
    wakeTimer = setTimeout(() => { wakeTimer = undefined; void tick(); }, settleMs); wakeTimer.unref?.();
  }
  function start() { if (started || closing) return; started = true; timer = setInterval(() => { void tick(); }, intervalMs); timer.unref?.(); wake(); }
  async function tick() {
    if (checking) return; checking = true;
    try {
    await ready;
    if (loadIssue || closing || !started || activeJob || now() - lastChange < settleMs || !dirty.size || !await isIdle()) return;
    const workspaceId = [...dirty].find(id => scopes.get(id)?.enabled && metadata.has(id)); if (!workspaceId) return;
    const scope = scopes.get(workspaceId), captured = metadata.get(workspaceId), revision = revisions.get(workspaceId) || 0, controller = new AbortController();
    dirty.delete(workspaceId); errors.delete(workspaceId);
    const job = { workspaceId, controller, promise: undefined }; activeJob = job; emit(workspaceId);
    job.promise = (async () => {
      try {
        const result = await backupManager.exportSnapshot({ meta: captured.meta, workspaceIds: [workspaceId], repository: scope.repository, ownerId, signal: controller.signal, yieldBackground, beforeWrite: async () => {
          if (closing || controller.signal.aborted || !scopes.get(workspaceId)?.enabled) throw aborted();
          if ((revisions.get(workspaceId) || 0) !== revision || !await isIdle()) throw Object.assign(Error('工作区内容正在更新，已保留上次备份，稍后空闲时重新保存。'), { name: 'BackupChangedError' });
        } });
        const current = scopes.get(workspaceId);
        if (current && current.repository === scope.repository) {
          const saved = { ...current, lastSuccess: new Date(now()).toISOString(), lastSnapshot: result.snapshotPath, files: result.files, bytes: result.bytes, newBytes: result.newBytes, lastMetaHash: captured.hash };
          scopes.set(workspaceId, saved);
          try { await persist(); } catch (error) { errors.set(workspaceId, '快照已保存，最近备份时间暂未登记：' + String(error?.message || error)); }
        }
      } catch (error) {
        if (error?.name === 'BackupChangedError' && !controller.signal.aborted && !closing && scopes.get(workspaceId)?.enabled) { dirty.add(workspaceId); lastChange = now(); }
        else if (error?.name !== 'AbortError') errors.set(workspaceId, String(error?.message || error));
      } finally { if (activeJob === job) activeJob = undefined; emit(workspaceId); wake(); }
    })();
    await job.promise;
    } catch (error) { for (const workspaceId of dirty) { errors.set(workspaceId, String(error?.message || error)); emit(workspaceId); } }
    finally { checking = false; }
  }
  return {
    async status({ workspaceId }) { await ready; if (!validId(workspaceId)) throw Error('自动备份工作区无效。'); return view(workspaceId); },
    async configure({ workspaceId, enabled, directory: target }) {
      await assertReady(); if (!validId(workspaceId) || typeof enabled !== 'boolean' || closing) throw Error('自动备份设置无效或应用正在关闭。');
      const previous = scopes.get(workspaceId); let repository = previous?.repository;
      if (!previous && scopes.size >= 1000) throw Error('自动备份最多管理1000个工作区，未改动已有设置。');
      if (target !== undefined && activeJob?.workspaceId === workspaceId) activeJob.controller.abort();
      if (target !== undefined) { const created = await backupManager.createSnapshotRepository({ directory: target, ownerId, workspaceId }); repository = created.directory; }
      if (enabled && !repository) throw Error('请先选择自动备份位置。');
      if (!repository) return view(workspaceId);
      if (activeJob?.workspaceId === workspaceId && (!enabled || repository !== previous?.repository)) activeJob.controller.abort();
      scopes.set(workspaceId, { ...(repository === previous?.repository ? previous : {}), workspaceId, enabled, repository });
      try { await persist(); } catch (error) { if (previous) scopes.set(workspaceId, previous); else scopes.delete(workspaceId); throw error; }
      errors.delete(workspaceId); if (enabled && metadata.has(workspaceId)) changed(workspaceId); else emit(workspaceId); wake(); return view(workspaceId);
    },
    async sync({ workspaceId, meta, issue }) {
      await assertReady(); if (!validId(workspaceId)) throw Error('自动备份工作区无效。'); if (closing) return view(workspaceId);
      if (issue !== undefined) { if (typeof issue !== 'string' || !issue.trim() || issue.length > 2000) throw Error('备份索引异常信息无效。'); if (metadataIssues.has(workspaceId) && errors.get(workspaceId) === issue && !metadata.has(workspaceId)) return view(workspaceId); metadata.delete(workspaceId); metadataIssues.add(workspaceId); errors.set(workspaceId, issue); revisions.set(workspaceId, (revisions.get(workspaceId) || 0) + 1); if (activeJob?.workspaceId === workspaceId) activeJob.controller.abort(); emit(workspaceId); return view(workspaceId); }
      const captured = workspaceMeta(meta, workspaceId), previous = metadata.get(workspaceId); if (metadataIssues.delete(workspaceId)) errors.delete(workspaceId);
      metadata.set(workspaceId, captured);
      if (scopes.get(workspaceId)?.enabled && previous?.hash !== captured.hash) changed(workspaceId);
      wake(); return view(workspaceId);
    },
    markDirty(workspaceId) {
      if (closing) return;
      for (const [id, scope] of scopes) if (scope.enabled && metadata.has(id) && (workspaceId === undefined || id === workspaceId)) changed(id);
      wake();
    },
    async run({ workspaceId, meta }) {
      await assertReady(); let sameMeta = true; if (meta) { const captured = workspaceMeta(meta, workspaceId); sameMeta = metadata.get(workspaceId)?.hash === captured.hash; metadata.set(workspaceId, captured); if (metadataIssues.delete(workspaceId)) errors.delete(workspaceId); }
      if (!scopes.get(workspaceId)?.enabled || !metadata.has(workspaceId)) throw Error('请先启用自动备份，并保存工作区索引。');
      if (activeJob?.workspaceId === workspaceId && sameMeta) return view(workspaceId);
      changed(workspaceId); lastChange = now() - settleMs; wake(); void tick(); return view(workspaceId);
    },
    async cancel({ workspaceId }) { await assertReady(); if (!validId(workspaceId)) throw Error('自动备份工作区无效。'); if (activeJob?.workspaceId === workspaceId) activeJob.controller.abort(); dirty.delete(workspaceId); emit(workspaceId); return view(workspaceId); },
    async yieldToForeground() {
      const job = activeJob;
      if (job && !job.controller.signal.aborted) { if (scopes.get(job.workspaceId)?.enabled) { dirty.add(job.workspaceId); lastChange = now(); } job.controller.abort(); }
      await job?.promise;
    },
    wake,
    start,
    resume() { closing = false; start(); wake(); },
    pause() { started = false; clearInterval(timer); clearTimeout(wakeTimer); wakeTimer = undefined; },
    async flush() { await ready; await activeJob?.promise; await configWrites; },
    async shutdown() { closing = true; started = false; clearInterval(timer); clearTimeout(wakeTimer); wakeTimer = undefined; if (activeJob && !activeJob.controller.signal.aborted && scopes.get(activeJob.workspaceId)?.enabled) dirty.add(activeJob.workspaceId); activeJob?.controller.abort(); await activeJob?.promise; await configWrites; },
  };
}
module.exports = { createBackupScheduler, workspaceMeta };
