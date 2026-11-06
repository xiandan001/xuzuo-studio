import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url), root = fileURLToPath(new URL('../../', import.meta.url)), fixturePrefix = 'xuzuo-image-group-';
const { createWorkspaceStorage } = require('../../electron/workspace-storage.cjs'), { createArtifactStore } = require('../../electron/artifact-store.cjs'), { createLiveWorkflowEngine } = require('../../electron/live-workflow-engine.cjs'), { createBatchProduction } = require('../../electron/batch-production.cjs');
const { validateImageGroupCounts } = require('../../electron/image-group-batch.cjs');
const { createImageGroupTestScope } = require('./image-group-test-scope.cjs');
const dependencies = createRequire(path.join(root, 'work/ui-build/package.json')), PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64'), scopes = new Map();
function scopeFor(context) { const scope = createImageGroupTestScope(context.signal); scopes.set(context.task.id, scope); return scope; }
function scopedBatch(scope, raw) {
  return { ...raw, create: input => scope.run(() => raw.create(input)), control: input => scope.run(() => raw.control(input)), get: input => scope.run(() => raw.get(input)) };
}
afterEach(async context => {
  const scope = scopes.get(context.task.id); if (!scope) return;
  for (const f of scope.close()) {
    await f.ready?.catch(() => undefined); // Drain partial initialization even when the test already failed.
    const errors = [];
    for (const drain of [() => f.pendingFileTask, () => f.batch?.shutdown(), () => f.engine?.shutdown(), () => scope.drain(), () => f.artifactStore?.drain(), () => f.workspaceStorage?.list()]) {
      try { await drain(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Image-group fixture drain failed; owned directory retained');
    if (!f.directory) continue;
    const actualRoot = await fs.realpath(f.ownedRoot), rootStat = await fs.lstat(f.ownedRoot);
    const actual = await fs.realpath(f.directory), stat = await fs.lstat(f.directory), relative = path.relative(actualRoot, actual);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory() || path.relative(f.ownedRoot, actualRoot) || stat.isSymbolicLink() || !stat.isDirectory() || path.relative(f.directory, actual) || !relative || relative.startsWith('..') || path.isAbsolute(relative) || path.relative(actualRoot, path.dirname(actual)) || !path.basename(actual).startsWith(fixturePrefix)) throw Error('Non-owned fixture cleanup');
    await fs.rm(f.directory, { recursive: true, force: true });
  }
  scopes.delete(context.task.id);
});
function fixture(scope, onExecute) {
  const f = scope.register({});
  f.ready = (async () => {
    scope.check(); const ownedRoot = f.ownedRoot = await fs.realpath(os.tmpdir()); scope.check();
    const rootStat = await fs.lstat(ownedRoot); scope.check();
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw Error('Invalid canonical temporary fixture root');
    const directory = f.directory = await fs.mkdtemp(path.join(ownedRoot, fixturePrefix)); scope.check();
    const workspaceStorage = f.workspaceStorage = createWorkspaceStorage({ directory });
    const artifactStore = f.artifactStore = createArtifactStore({ directory: path.join(directory, 'artifacts'), workspaceStorage, loadModule: dependencies });
    workspaceStorage.setArtifactMigrator((id, target) => artifactStore.migrateProject(id, target));
    const workspace = path.join(directory, 'workspace'); await fs.mkdir(workspace); scope.check();
    await workspaceStorage.bindRoot({ workspaceId: 'group-workspace', name: '独立分组', directory: workspace }); scope.check();
    const calls = f.calls = [];
    const engineOptions = f.engineOptions = { directory, artifactStore, credentials: { list: async () => [{ id: 'key', connectionId: 'connection', enabled: true, name: '无真实Key的元数据' }] }, modelRuntime: { supports: () => true, execute: async input => {
      scope.check(); calls.push(input); expect(input.options.count).toBe(1);
      const result = await onExecute?.(input, calls); scope.check();
      const count = result?.images ?? 1, artifacts = [];
      for (let i = 0; i < count; i++) { scope.check(); artifacts.push(await artifactStore.write({ projectId: input.projectId, runId: input.runId, name: `实图-${calls.length}-${i}.${result?.extension || 'png'}`, mimeType: result?.mimeType || 'image/png', buffer: result?.buffer || PNG })); scope.check(); }
      return { artifacts, usage: { images: 1 } };
    } } };
    scope.check(); f.engine = createLiveWorkflowEngine(engineOptions);
    f.batch = scopedBatch(scope, createBatchProduction({ directory, workspaceStorage, artifactStore, liveEngine: f.engine })); scope.check();
    return f;
  })();
  return f.ready;
}
function input(counts = [2, 3]) {
  return { name: '独立图片组', rows: counts.map((count, index) => ({ 组名: '产品组' + (index + 1), 需求: index ? '独立红色产品需求' : '独立蓝色产品需求' })), imageGroupCounts: counts, projectNameTemplate: '{{组名}}', request: { project: { id: 'template', workspaceId: 'group-workspace', name: '图片模板', kind: 'image', status: 'draft', costCents: 0, version: 0, updatedAt: '', accent: 'blue' }, workflow: { id: 'group-template', workspaceId: 'group-workspace', name: '图片组模板', outputKind: 'image', description: '', updatedAt: '', steps: [{ id: 'picture', kind: 'image-generation', name: '生成图片', inputSource: 'project', prompt: '独立制作：{{需求}}', modelConfigId: 'model', credentialId: 'key', count: 1, enabled: true }, { id: 'export', kind: 'export', name: '生成实际交付文件', prompt: '', inputSource: 'previous', enabled: true }] }, models: [{ id: 'model', connectionId: 'connection', modelId: 'fixture-image', name: '无网络模型', enabled: true, capabilities: ['image-generation'], pricing: { unit: 'image', currency: 'CNY', input: '0', output: '1' } }], connections: [{ id: 'connection', name: '隔离连接', protocol: 'image', providerId: 'custom', baseUrl: 'http://127.0.0.1:9000/v1', enabled: true }], input: '{{需求}}', variables: {}, attachmentIds: [], acknowledgePaidCalls: true, acknowledgeUnknownCost: true } };
}
const uniqueImages = item => [...new Map(item.artifacts.filter(file => file.kind === 'image').map(file => [file.id, file])).values()];
describe('独立图片分组复用真实批量队列', () => {
  it.for([
    ['svg', 'image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="red" d="M0 0h16v16H0z"/></svg>')],
    ['gif', 'image/gif', Buffer.from('47494638396101000100800000ff00000000ff21f90400140000002c000000000100010000020244010021f90400140000002c00000000010001000002024c01003b', 'hex')],
  ])('%s分组三张完成真实生成到交付步骤，保留3个原始ID/字节且导出不新增调用或费用', async ([extension, mimeType, buffer], context) => {
    const scope = scopeFor(context), f = await fixture(scope, async () => ({ extension, mimeType, buffer })), request = input([3]);
    request.request.models[0].modelId = 'gpt-image-2.6-flare'; request.request.workflow.steps[0].imageOutputFormat = extension;
    const created = await f.batch.create(request); expect(f.calls).toHaveLength(0);
    await f.batch.control({ id: created.id, action: 'start' }); const done = await f.scope.until(() => f.batch.get({ id: created.id }), value => value.status === 'complete'), item = done.items[0];
    const detail = await f.engine.runDetail(item.runId), producers = detail.attempts.filter(attempt => attempt.stepId.startsWith('group-image-')), exported = detail.attempts.find(attempt => attempt.stepId === 'group-export');
    expect(producers).toHaveLength(3); expect(exported.status).toBe('complete');
    const sourceIds = producers.flatMap(attempt => attempt.artifacts.filter(file => file.kind === 'image').map(file => file.id)), finalImages = exported.artifacts.filter(file => file.kind === 'image');
    expect(finalImages.map(file => file.id)).toEqual(sourceIds); expect(new Set(sourceIds).size).toBe(3);
    for (const file of finalImages) { scope.check(); expect(file.mimeType).toBe(mimeType); expect((await f.artifactStore.read(file.id)).buffer).toEqual(buffer); scope.check(); }
    expect(f.calls).toHaveLength(3); expect((await f.engine.snapshot()).ledger).toHaveLength(3); expect(uniqueImages(item).map(file => file.id)).toEqual(sourceIds);
  });
  it('2+3组需求生成两个项目/五次单张请求/五张真实图，创建本身不请求且费用分开', async context => {
    const scope = scopeFor(context), f = await fixture(scope), request = input(), before = structuredClone(request.request.workflow), created = await f.batch.create(request); expect(f.calls).toHaveLength(0); expect(created.kind).toBe('image-groups'); expect(created.items.map(item => item.imageCount)).toEqual([2, 3]); expect(created.items[0].project.description).toBe('独立蓝色产品需求'); expect(created.items[1].project.description).toBe('独立红色产品需求');
    await f.batch.control({ id: created.id, action: 'start' }); const done = await f.scope.until(() => f.batch.get({ id: created.id }), value => value.status === 'complete'); expect(f.calls).toHaveLength(5); expect(done.items.map(item => uniqueImages(item).length)).toEqual([2, 3]); expect(done.items.map(item => item.costCents)).toEqual([200, 300]); expect(new Set(done.items.map(item => item.project.directory)).size).toBe(2); expect(request.request.workflow).toEqual(before);
    expect(f.calls.slice(0, 2).every(call => call.input === '独立蓝色产品需求' && !call.prompt.includes('红色'))).toBe(true); expect(f.calls.slice(2).every(call => call.input === '独立红色产品需求' && !call.prompt.includes('蓝色'))).toBe(true);
    const snapshot = await f.engine.snapshot();
    for (const item of done.items) { scope.check(); const run = snapshot.runs.find(run => run.id === item.runId), exported = run.attempts.find(attempt => attempt.stepId === 'group-export'); expect(exported.artifacts.filter(file => file.kind === 'image')).toHaveLength(item.imageCount); for (const file of uniqueImages(item)) { scope.check(); expect((await f.artifactStore.read(file.id)).buffer.equals(PNG)).toBe(true); scope.check(); } }
  });
  it('中途失败暂停后续组，明确重试只继续未完成图片，保留原图与失败费用', async context => {
    const scope = scopeFor(context); let failed = false; const f = await fixture(scope, input => { if (input.options.count === 1 && input.prompt.includes('本次制作第2张') && !failed) { failed = true; throw Object.assign(Error('temporary'), { publicMessage: '隔离临时失败', requestStarted: true, usage: { images: 1 } }); } }); const created = await f.batch.create(input([3, 2])); await f.batch.control({ id: created.id, action: 'start' }); const stopped = await f.scope.until(() => f.batch.get({ id: created.id }), value => value.status === 'paused'); expect(stopped.items[0].status).toBe('failed'); expect(stopped.items[1].status).toBe('queued'); expect(f.calls).toHaveLength(2); const original = uniqueImages(stopped.items[0])[0]; expect(stopped.items[0].costCents).toBe(200);
    await f.batch.control({ id: created.id, action: 'retry-item', itemId: created.items[0].id }); const done = await f.scope.until(() => f.batch.get({ id: created.id }), value => value.status === 'complete'); expect(f.calls).toHaveLength(6); expect(done.items.map(item => uniqueImages(item).length)).toEqual([3, 2]); expect(uniqueImages(done.items[0]).some(file => file.id === original.id)).toBe(true); expect(done.items[0].costCents).toBe(400); expect((await f.engine.snapshot()).ledger).toHaveLength(6);
  });
  it('暂停仅停后续组，取消未完成项保留已生成项目/文件与费用', async context => {
    const scope = scopeFor(context), { wait: gate, release } = scope.gate(); const f = await fixture(scope, async (_input, calls) => { if (calls.length === 1) await gate; }), created = await f.batch.create(input([2, 2])); await f.batch.control({ id: created.id, action: 'start' }); await f.scope.until(async () => f.calls.length, value => value === 1); await f.batch.control({ id: created.id, action: 'pause' }); release(); const paused = await f.scope.until(() => f.batch.get({ id: created.id }), value => value.items[0].status === 'complete'); expect(paused.status).toBe('paused'); expect(paused.items[1].status).toBe('queued'); expect(f.calls).toHaveLength(2); const ledger = (await f.engine.snapshot()).ledger; await f.batch.control({ id: created.id, action: 'cancel' }); const cancelled = await f.batch.get({ id: created.id }); expect(cancelled.items[0].status).toBe('complete'); expect(cancelled.items[1].status).toBe('cancelled'); expect((await f.engine.snapshot()).ledger).toEqual(ledger); expect(uniqueImages(cancelled.items[0])).toHaveLength(2);
  });
  it('响应图片数量异常时不假报成功，暂停后续并保留供应商实际返回的图和费用', async context => {
    const scope = scopeFor(context), f = await fixture(scope, () => ({ images: 2 })), created = await f.batch.create(input([1, 1])); await f.batch.control({ id: created.id, action: 'start' }); const stopped = await f.scope.until(() => f.batch.get({ id: created.id }), value => value.status === 'paused'); expect(stopped.items[0].status).toBe('failed'); expect(stopped.items[0].error).toContain('数量不匹配'); expect(uniqueImages(stopped.items[0])).toHaveLength(2); expect(stopped.items[1].status).toBe('queued'); expect(f.calls).toHaveLength(1); expect(stopped.items[0].ledger).toHaveLength(1);
  });
  it('数量、总量、模板或参考非法在创建文件夹/调用前拒绝', async context => {
    const scope = scopeFor(context), f = await fixture(scope); for (const counts of [[0], [21], [1.5], Array(26).fill(20)]) await expect(f.batch.create(input(counts))).rejects.toThrow('分组数量'); const reference = input([1]); reference.request.attachmentIds = ['not-supported']; await expect(f.batch.create(reference)).rejects.toThrow(); const bad = input([1]); bad.request.workflow.steps[0].count = 4; await expect(f.batch.create(bad)).rejects.toThrow('单张生成'); expect(f.calls).toHaveLength(0); expect((await f.workspaceStorage.list()).projects).toHaveLength(0); expect(() => validateImageGroupCounts(Array(500).fill(1), 500)).not.toThrow();
  });
  it('重启后不自动重发，显式重试只续未完成步骤，已成功图与原费用保留', async context => {
    const scope = scopeFor(context), { wait: gate, release } = scope.gate(); const f = await fixture(scope, async (_input, calls) => { if (calls.length === 2) await gate; }), created = await f.batch.create(input([3, 1])); await f.batch.control({ id: created.id, action: 'start' }); await f.scope.until(async () => f.calls.length, value => value === 2); const original = (await f.batch.get({ id: created.id })).items[0].artifacts.find(file => file.kind === 'image'); await f.batch.shutdown(); const shutdown = f.engine.shutdown(); release(); await shutdown;
    const restarted = scope.replace(f, () => { const engine = createLiveWorkflowEngine(f.engineOptions), batch = scopedBatch(scope, createBatchProduction({ directory: f.directory, workspaceStorage: f.workspaceStorage, artifactStore: f.artifactStore, liveEngine: engine })); return { ...f, engine, batch }; }); const { engine, batch } = restarted; const restored = await batch.get({ id: created.id }), before = f.calls.length; await f.scope.delay(150); expect(f.calls).toHaveLength(before); expect(restored.status).toBe('interrupted'); expect(restored.items[1].status).toBe('queued'); await batch.control({ id: created.id, action: 'retry-item', itemId: created.items[0].id }); const done = await f.scope.until(() => batch.get({ id: created.id }), value => value.status === 'complete'); expect(uniqueImages(done.items[0]).some(file => file.id === original.id)).toBe(true); expect(f.calls.filter(call => call.projectId === created.items[0].project.id && call.prompt.includes('本次制作第1张'))).toHaveLength(1); expect((await engine.snapshot()).ledger).toHaveLength(f.calls.length);
  });
  it('重启时已成功run但批次终态未写入，继续队列只同步旧结果而不重复收费', async context => {
    const scope = scopeFor(context), { wait: gate, release } = scope.gate(); const f = await fixture(scope, async (_input, calls) => { if (calls.length === 1) await gate; }), created = await f.batch.create(input([2, 1])); await f.batch.control({ id: created.id, action: 'start' }); await f.scope.until(async () => f.calls.length, value => value === 1); await f.batch.control({ id: created.id, action: 'pause' }); release(); await f.scope.until(() => f.batch.get({ id: created.id }), value => value.items[0].status === 'complete'); await f.batch.shutdown(); await f.engine.shutdown(); scope.check(); const filename = path.join(f.directory, 'batches-v1', created.id + '.json'), interrupted = JSON.parse(await (f.pendingFileTask = fs.readFile(filename, 'utf8'))); scope.check(); interrupted.status = 'interrupted'; interrupted.items[0].status = 'interrupted'; await (f.pendingFileTask = fs.writeFile(filename, JSON.stringify(interrupted))); scope.check();
    const restarted = scope.replace(f, () => { const engine = createLiveWorkflowEngine(f.engineOptions), batch = scopedBatch(scope, createBatchProduction({ directory: f.directory, workspaceStorage: f.workspaceStorage, artifactStore: f.artifactStore, liveEngine: engine })); return { ...f, engine, batch }; }); const { engine, batch } = restarted; await f.scope.delay(150); expect(f.calls).toHaveLength(2); await batch.control({ id: created.id, action: 'start' }); const done = await f.scope.until(() => batch.get({ id: created.id }), value => value.status === 'complete'); expect(done.items.every(item => item.status === 'complete')).toBe(true); expect(f.calls).toHaveLength(3); expect((await engine.snapshot()).ledger).toHaveLength(3);
  });
  it('开始ACK延迟时取消后，旧提交回调不得将cancelled回写成paused或启动后续', async context => {
    const scope = scopeFor(context), f = await fixture(scope), { wait: gate, release } = scope.gate(); let entered = false; const start = f.engine.start.bind(f.engine); f.engine.start = async request => { scope.check(); const run = await start(request); scope.check(); entered = true; await gate; scope.check(); return run; }; const created = await f.batch.create(input([3, 1])); await f.batch.control({ id: created.id, action: 'start' }); await f.scope.until(async () => entered, Boolean); await f.batch.control({ id: created.id, action: 'cancel' }); release(); await f.scope.delay(200); const cancelled = await f.batch.get({ id: created.id }); expect(cancelled.status).toBe('cancelled'); expect(cancelled.items[1].status).toBe('cancelled'); const calls = f.calls.length; await f.scope.delay(150); expect(f.calls).toHaveLength(calls); expect(f.calls.some(call => call.projectId === created.items[1].project.id)).toBe(false);
  });
});
