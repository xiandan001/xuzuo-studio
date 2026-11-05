import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createWorkspaceStorage } = require('../../electron/workspace-storage.cjs');
const { createAutomationCenter } = require('../../electron/automation-center.cjs');
const { createProjectPurge } = require('../../electron/project-purge.cjs');
const { inspectPurgeDirectory } = require('../../electron/project-purge-paths.cjs');
const { createLiveWorkflowEngine } = require('../../electron/live-workflow-engine.cjs');
const root = path.resolve('work');

async function fixture(purgeFs = fs, purgeOptions = {}) {
  const base = await fs.mkdtemp(path.join(root, 'purge-native-')), directory = path.join(base, 'profile'), workspace = path.join(base, 'workspace'), other = path.join(base, 'other');
  await fs.mkdir(workspace); await fs.mkdir(other);
  const storage = createWorkspaceStorage({ directory, fileSystem: purgeFs }); storage.setArtifactMigrator(async () => undefined);
  await storage.bindRoot({ workspaceId: 'one', name: 'one', directory: workspace }); await storage.bindRoot({ workspaceId: 'two', name: 'two', directory: other });
  const projects = [];
  for (const [id, workspaceId] of [['target', 'one'], ['neighbor', 'one'], ['foreign', 'two']]) {
    const location = await storage.ensureProject({ projectId: id, workspaceId, name: id }); await fs.writeFile(path.join(location.directory, 'files/client.txt'), `keep-${id}`);
    projects.push({ id, workspaceId, directory: location.directory, name: id, kind: 'word', costCents: 123, updatedAt: '2026-11-04T00:00:00Z' });
  }
  const ledger = [{ id: 'fee', projectId: 'target', costCents: 123 }], engine = { busy: false, snapshot: async () => ({ runs: [], ledger }), isProjectBusy: async () => engine.busy };
  const center = createAutomationCenter({ directory, liveEngine: engine, start: () => { throw Error('no model calls'); }, control: () => { throw Error('no model calls'); } });
  const context = { workspaces: [{ id: 'one' }, { id: 'two' }], projects, workflows: [], models: [], connections: [] };
  await center.syncContext(context); await center.prepareProjectArchive({ projectId: 'target', workspaceId: 'one' });
  const create = () => {
    const purge = createProjectPurge({ directory, workspaceStorage: storage, automationCenter: center, liveEngine: engine, fileSystem: purgeFs, protectedRoots: [directory], ...purgeOptions });
    storage.setProjectPurgeGuard({ ready: purge.ready, isPurged: purge.isPurged, audits: purge.audits }); center.setProjectPurgeGuard(id => purge.isPurged(id) || storage.isProjectPurged(id), purge.ready); return purge;
  };
  const purge = create(); await purge.ready;
  return { base, directory, workspace, storage, center, context, engine, ledger, purge, create, project: projects[0], neighbor: projects[1], async close() { await center.shutdown(); } };
}
const input = (id, selectionId, deleteFiles = false) => ({ id, selectionId, workspaceId: 'one', projectIds: ['target'], deleteFiles });
const preview = (f, deleteFiles = false) => f.purge.preview({ workspaceId: 'one', projectIds: ['target'], deleteFiles });

describe('Native永久移除只在owned目录验证', () => {
  it('仅移除记录保留目录原字节、费用，拒绝旧context/restore/ensure同ID复活', async () => {
    const f = await fixture(); try {
      const before = await fs.readFile(path.join(f.project.directory, 'files/client.txt')), selected = await preview(f), result = await f.purge.execute(input('record-only', selected.selectionId));
      expect(result.items[0]).toMatchObject({ recordPurged: true, filesDeleted: false, filesPending: false, costCents: 123 });
      expect(await fs.readFile(path.join(f.project.directory, 'files/client.txt'))).toEqual(before); expect(f.ledger).toEqual([{ id: 'fee', projectId: 'target', costCents: 123 }]);
      expect((await f.storage.list()).projects.some(item => item.projectId === 'target')).toBe(false);
      await f.center.syncContext(f.context); await expect(f.center.restoreProjectArchive({ projectId: 'target', workspaceId: 'one' })).rejects.toThrow('永久移除');
      await expect(f.storage.ensureProject({ projectId: 'target', workspaceId: 'one', name: 'revive' })).rejects.toThrow('永久移除');
      expect((await f.storage.listPurges())[0].directories).toContain(f.project.directory);
    } finally { await f.close(); }
  });
  it('真实移除唯一项目目录，邻居与原费用完全保留；重放与模式变更受控', async () => {
    const f = await fixture(); try {
      const selected = await preview(f, true), result = await f.purge.execute(input('delete-files', selected.selectionId, true));
      expect(result.items[0]).toMatchObject({ recordPurged: true, filesDeleted: true, filesPending: false });
      await expect(fs.stat(f.project.directory)).rejects.toMatchObject({ code: 'ENOENT' }); expect(await fs.readFile(path.join(f.neighbor.directory, 'files/client.txt'), 'utf8')).toBe('keep-neighbor');
      expect(await f.purge.execute(input('delete-files', '', true))).toEqual(result); await expect(f.purge.execute(input('delete-files', '', false))).rejects.toThrow('不同');
      expect(f.ledger[0].costCents).toBe(123);
    } finally { await f.close(); }
  });
  it('外部移走原目录仍能清记录，不重建，不追删移走副本', async () => {
    const f = await fixture(); try {
      const moved = path.join(f.base, 'external-copy'); await fs.rename(f.project.directory, moved);
      const selected = await preview(f, true), result = await f.purge.execute(input('missing-folder', selected.selectionId, true));
      expect(result.items[0]).toMatchObject({ recordPurged: true, folderMissing: true, filesDeleted: false, filesPending: false });
      expect(await fs.readFile(path.join(moved, 'files/client.txt'), 'utf8')).toBe('keep-target'); await expect(fs.stat(f.project.directory)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await f.close(); }
  });
  it('junction树预校验失败保留普通trash，邻居sentinel不变', async () => {
    const f = await fixture(); try {
      await fs.symlink(f.neighbor.directory, path.join(f.project.directory, 'files/link'), process.platform === 'win32' ? 'junction' : 'dir');
      const selected = await preview(f, true); expect(selected.items[0].error).toMatch(/链接|junction/);
      const result = await f.purge.execute(input('unsafe-link', selected.selectionId, true)); expect(result.items[0].recordPurged).toBe(false);
      expect(await fs.readFile(path.join(f.neighbor.directory, 'files/client.txt'), 'utf8')).toBe('keep-neighbor'); expect((await f.storage.list()).projects.some(item => item.projectId === 'target')).toBe(true);
    } finally { await f.close(); }
  });
  it('未登记的嵌套项目marker也阻止整目录删除', async () => {
    const f = await fixture(); try {
      const nested = path.join(f.project.directory, 'nested/.xuzuo'); await fs.mkdir(nested, { recursive: true }); await fs.writeFile(path.join(nested, 'project-v1.json'), JSON.stringify({ version: 1, projectId: 'foreign-copy' }));
      const selected = await preview(f, true); expect(selected.items[0].error).toContain('嵌套'); expect((await f.purge.execute(input('nested-marker', selected.selectionId, true))).items[0].recordPurged).toBe(false);
    } finally { await f.close(); }
  });
  it('磁盘根/工作区根/受保护祖先在任何读取或删除前被拒绝', async () => {
    let reads = 0; const unsafeFs = { lstat: async () => { reads++; throw Error('must not inspect root'); } }, drive = path.parse(root).root;
    const metadata = { workspaces: [{ workspaceId: 'one', directory: drive }], projects: [], locations: [] };
    await expect(inspectPurgeDirectory({ fs: unsafeFs, target: { projectId: 'target', workspaceId: 'one', directory: drive }, metadata })).rejects.toThrow('独立项目目录'); expect(reads).toBe(0);
  });
  it('确认后原路径换成新目录时拒绝，原副本及新目录均不删', async () => {
    const f = await fixture(); try {
      const selected = await preview(f, true), moved = path.join(f.base, 'original-retained'); await fs.rename(f.project.directory, moved);
      await fs.mkdir(path.join(f.project.directory, '.xuzuo'), { recursive: true }); await fs.writeFile(path.join(f.project.directory, '.xuzuo/project-v1.json'), JSON.stringify({ version: 1, projectId: 'target' })); await fs.writeFile(path.join(f.project.directory, 'new.txt'), 'new folder');
      const result = await f.purge.execute(input('changed-identity', selected.selectionId, true)); expect(result.items[0].recordPurged).toBe(false); expect(result.items[0].error).toContain('身份');
      expect(await fs.readFile(path.join(f.project.directory, 'new.txt'), 'utf8')).toBe('new folder'); expect(await fs.readFile(path.join(moved, 'files/client.txt'), 'utf8')).toBe('keep-target');
    } finally { await f.close(); }
  });
  it('隔离后部分失败跨重启不自动删除，原request仅清隔离目录、不追新原路径', async () => {
    let fail = true;
    const injected = new Proxy(fs, { get(target, key) { if (key === 'unlink') return async filename => { if (fail && filename.includes('.xuzuo-purge-') && filename.endsWith('client.txt')) throw Object.assign(Error('owned disk failure'), { code: 'EACCES' }); return target.unlink(filename); }; return target[key]; } });
    const f = await fixture(injected); try {
      const selected = await preview(f, true), result = await f.purge.execute(input('partial-delete', selected.selectionId, true)); expect(result.items[0]).toMatchObject({ recordPurged: true, filesPending: true, retryable: true });
      const audits = await f.storage.listPurges(), quarantine = audits[0].directories.find(item => path.basename(item).startsWith('.xuzuo-purge-')); expect(quarantine).toBeTruthy(); expect((await fs.stat(quarantine)).isDirectory()).toBe(true);
      expect(result.items[0].cleanupDirectory).toBe(quarantine);
      expect((await f.purge.tombstones({ workspaceId: 'one' })).find(item => item.projectId === 'target').cleanupDirectory).toBe((await f.purge.status({ id: 'partial-delete', workspaceId: 'one' })).items[0].cleanupDirectory);
      await fs.mkdir(f.project.directory); await fs.writeFile(path.join(f.project.directory, 'new.txt'), 'do not delete');
      const restarted = f.create(); await restarted.ready; expect((await fs.stat(quarantine)).isDirectory()).toBe(true); expect((await restarted.status({ id: 'partial-delete', workspaceId: 'one' })).items[0].filesPending).toBe(true);
      expect((await restarted.tombstones({ workspaceId: 'one' })).find(item => item.projectId === 'target').cleanupDirectory).toBe((await restarted.status({ id: 'partial-delete', workspaceId: 'one' })).items[0].cleanupDirectory);
      fail = false; const retried = await restarted.execute(input('partial-delete', '', true)); expect(retried.items[0]).toMatchObject({ recordPurged: true, filesDeleted: true, filesPending: false }); expect(await fs.readFile(path.join(f.project.directory, 'new.txt'), 'utf8')).toBe('do not delete');
    } finally { await f.close(); }
  });
  it('active、foreign、仍在取消收尾的项目均不允许永久移除', async () => {
    const f = await fixture(); try {
      await expect(f.purge.preview({ workspaceId: 'one', projectIds: ['neighbor'], deleteFiles: false })).rejects.toThrow('回收站'); await expect(f.purge.preview({ workspaceId: 'one', projectIds: ['foreign'], deleteFiles: false })).rejects.toThrow('回收站');
      const selected = await preview(f, true); f.engine.busy = true; const result = await f.purge.execute(input('busy-native', selected.selectionId, true)); expect(result.items[0].recordPurged).toBe(false); expect(result.items[0].error).toContain('收尾');
    } finally { await f.close(); }
  });
  it('备份导入审计不建目录，同ID不得ensure/claim/import成项目', async () => {
    const f = await fixture(); try {
      const audit = { projectId: 'imported-purged', workspaceId: 'one', name: 'audit', kind: 'word', purgedAt: new Date().toISOString(), trashedAt: new Date().toISOString(), costCents: 9, updatedAt: new Date().toISOString(), directories: [] };
      await f.storage.importPurges([audit]); expect((await f.purge.tombstones({ workspaceId: 'one' })).some(item => item.projectId === audit.projectId)).toBe(true);
      await expect(f.storage.ensureProject({ projectId: audit.projectId, workspaceId: 'one', name: 'revive' })).rejects.toThrow('永久移除'); await expect(f.storage.importPurges([{ ...audit, directories: [f.neighbor.directory] }])).rejects.toThrow('路径');
    } finally { await f.close(); }
  });
  it('仅记录模式不探测写入用户目录，包括probe、rename或mkdir', async () => {
    const writes = [], methods = new Set(['writeFile', 'rename', 'unlink', 'mkdir', 'rmdir', 'rm']);
    const monitored = new Proxy(fs, { get(target, key) { if (methods.has(key)) return async (...args) => { if ([args[0], ...(key === 'rename' ? [args[1]] : [])].some(value => typeof value === 'string' && value.includes(path.sep + 'workspace' + path.sep))) writes.push([key, ...args.slice(0, 2)]); return target[key](...args); }; return target[key]; } });
    const f = await fixture(monitored); try {
      writes.length = 0; const selected = await preview(f); await f.purge.execute(input('no-folder-writes', selected.selectionId)); expect(writes).toEqual([]);
    } finally { await f.close(); }
  });
  it('清理pending时其它新项目不能认领隔离目录内部', async () => {
    const injected = new Proxy(fs, { get(target, key) { if (key === 'unlink') return async filename => { if (filename.includes('.xuzuo-purge-') && filename.endsWith('client.txt')) throw Error('owned partial'); return target.unlink(filename); }; return target[key]; } });
    const f = await fixture(injected); try {
      const selected = await preview(f, true); await f.purge.execute(input('pending-namespace', selected.selectionId, true));
      const audit = (await f.storage.listPurges())[0], directory = path.join(audit.directories.find(value => path.basename(value).startsWith('.xuzuo-purge-')), 'empty'); await fs.mkdir(directory);
      await expect(f.storage.inspectProjectFolder({ projectId: 'new-id', workspaceId: 'one', directory })).rejects.toThrow(/清理|内部资料/);
    } finally { await f.close(); }
  });
  it('purge journal损坏会封住ensure，不自动删除任何目录', async () => {
    const f = await fixture(); try {
      await fs.writeFile(path.join(f.directory, 'project-purge-v1.json'), '{invalid'); const restarted = f.create(); await expect(restarted.ready).rejects.toThrow('无法可靠读取');
      await expect(f.storage.ensureProject({ projectId: 'target', workspaceId: 'one', name: 'same' })).rejects.toThrow('无法可靠读取'); expect(await fs.readFile(path.join(f.project.directory, 'files/client.txt'), 'utf8')).toBe('keep-target');
    } finally { await f.close(); }
  });
  it('真实engine同ID新的start/既有待检查续跑都被永久guard挡住，收费读取仍可用', async () => {
    const f = await fixture(); let engine; try {
      engine = createLiveWorkflowEngine({ directory: path.join(f.base, 'guard-engine'), credentials: { list: async () => [] }, modelRuntime: { execute: async () => { throw Error('No paid calls'); } }, artifactStore: {}, assertProjectAdmission: id => f.storage.assertNotPurged(id) });
      const request = { project: f.project, workflow: { id: 'review-flow', workspaceId: 'one', name: 'review', outputKind: 'word', steps: [{ id: 'manual', name: 'check', kind: 'manual-review', enabled: true, inputSource: 'project', prompt: '' }] }, connections: [], models: [], input: 'owned', variables: {}, attachmentIds: [], acknowledgePaidCalls: true, acknowledgeUnknownCost: true };
      const run = await engine.start(request);
      for (let i = 0; i < 50 && (await engine.snapshot()).runs[0].status === 'running'; i++) await new Promise(resolve => setTimeout(resolve, 10));
      const selected = await preview(f); await f.purge.execute(input('engine-guard', selected.selectionId));
      await expect(engine.start(request)).rejects.toThrow('永久移除'); await expect(engine.control({ id: run.id, action: 'resume' })).rejects.toThrow('永久移除');
      const snapshot = await engine.snapshot(); expect(snapshot.runs).toHaveLength(1); expect(snapshot.ledger).toEqual([]); await engine.recalculateCosts();
    } finally { await engine?.shutdown(); await f.close(); }
  });
  it('已持久request在执行尚未结束时可读complete:false，结束后同id无需preview重放', async () => {
    let release; const held = new Promise(resolve => { release = resolve; });
    const f = await fixture(fs, { withExclusive: async (_id, action) => { await held; return action(); } }); try {
      const selected = await preview(f), task = f.purge.execute(input('held-request', selected.selectionId));
      let status; for (let i = 0; i < 100; i++) { status = await f.purge.status({ id: 'held-request', workspaceId: 'one' }); if (status) break; await new Promise(resolve => setTimeout(resolve, 5)); }
      expect(status).toMatchObject({ complete: false, inProgress: true, requestId: 'held-request' }); expect(status.finishedAt).toBeUndefined(); const repeated = f.purge.execute(input('held-request', '')); release(); const done = await task; expect(done.complete).toBe(true); expect(done.inProgress).toBe(false); expect(done.finishedAt).toBeTruthy(); expect(await repeated).toEqual(done);
      expect(await f.purge.execute(input('held-request', ''))).toEqual(done);
    } finally { release(); await f.close(); }
  });
  it('仅记录private索引失败可跨重启同request修复，不误走目录删除', async () => {
    let fail = false;
    const injected = new Proxy(fs, { get(target, key) { if (key === 'rename') return async (from, to) => { if (fail && to.endsWith('workspace-directories-v1.json')) throw Error('owned metadata write failure'); return target.rename(from, to); }; return target[key]; } });
    const f = await fixture(injected); try {
      const selected = await preview(f); fail = true; const partial = await f.purge.execute(input('metadata-only-retry', selected.selectionId));
      expect(partial).toMatchObject({ complete: false, inProgress: false }); expect(partial.finishedAt).toBeTruthy(); expect(partial.items[0]).toMatchObject({ recordPurged: true, filesPending: false, retryable: true });
      fail = false; const restarted = f.create(); await restarted.ready; const result = await restarted.execute(input('metadata-only-retry', '')); expect(result.complete).toBe(true); expect(result.items[0]).toMatchObject({ filesDeleted: false, filesPending: false, retryable: false });
      expect(await fs.readFile(path.join(f.project.directory, 'files/client.txt'), 'utf8')).toBe('keep-target');
    } finally { await f.close(); }
  });
});
