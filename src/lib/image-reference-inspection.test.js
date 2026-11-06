import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { fixture: productionFixture, request, PNG } = require('./production-test-fixtures.cjs');
const { createImageGroupTestScope } = require('./image-group-test-scope.cjs');
const { createModelRuntime } = require('../../electron/model-runtime.cjs');
const { preflight } = require('../../electron/live-validation.cjs');
const limit = 20 * 1024 * 1024;
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M0 0h16v16H0z"/></svg>');
const gif = Buffer.from('47494638396101000100800000ff00000000ff21f90400140000002c000000000100010000020244010021f90400140000002c00000000010001000002024c01003b', 'hex');

async function fixture(context) {
  const scope = createImageGroupTestScope(context.signal);
  const ready = (async () => ({ ...await productionFixture(), ownedRoot: await fs.realpath(os.tmpdir()) }))();
  context.onTestFinished(async () => {
    scope.close(); vi.restoreAllMocks(); vi.unstubAllGlobals();
    const f = await ready;
    await f.engine.shutdown(); await scope.drain(); await f.artifactStore.drain(); await f.workspaceStorage.list();
    const actual = await fs.realpath(f.directory), stat = await fs.lstat(f.directory), canonicalStat = await fs.lstat(actual);
    if (stat.isSymbolicLink() || !stat.isDirectory() || canonicalStat.isSymbolicLink() || !canonicalStat.isDirectory() || String(stat.dev) !== String(canonicalStat.dev) || String(stat.ino) !== String(canonicalStat.ino) || path.relative(f.ownedRoot, path.dirname(actual)) || !path.basename(actual).startsWith('xuzuo-production-')) throw Error('Non-owned inspection fixture cleanup');
    await fs.rm(actual, { recursive: true, force: true });
  });
  const f = await ready; scope.check();
  const project = request().project;
  await scope.run(() => f.workspaceStorage.ensureProject({ projectId: project.id, workspaceId: project.workspaceId, name: project.name }));
  await scope.run(() => f.engine.snapshot());
  return { ...f, scope, project, manifest: path.join(f.directory, 'artifacts-v1/manifest-v1.json') };
}
const write = (f, buffer = PNG, mimeType = 'image/png', name = '实际原图.png') => f.scope.run(() => f.artifactStore.write({ projectId: f.project.id, runId: 'owned-source', name, mimeType, buffer }));
const inspect = (f, id) => f.scope.run(() => f.artifactStore.inspectImageArtifact(id));
const watchWrites = () => ['writeFile', 'rename', 'unlink', 'mkdir'].map(name => vi.spyOn(fs, name));
const expectNoWrites = spies => { for (const spy of spies) expect(spy).not.toHaveBeenCalled(); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

it('managed image inspection returns exact metadata without writes, provider work or ledger changes', async context => {
  const f = await fixture(context), file = await write(f), manifest = await fs.readFile(f.manifest), original = await fs.readFile(file.path), before = (await f.engine.snapshot()).ledger;
  const mutations = watchWrites(), fetch = vi.fn(() => { throw Error('No provider request is permitted'); }); vi.stubGlobal('fetch', fetch);
  const result = await inspect(f, file.id);
  expect(result).toEqual({ id: file.id, mimeType: 'image/png', bytes: PNG.length });
  expect(Object.keys(result).sort()).toEqual(['bytes', 'id', 'mimeType']);
  expect(JSON.stringify(result)).not.toMatch(/dataUrl|base64|buffer|text/);
  await expect(inspect(f, '../outside')).rejects.toThrow('编号');
  await expect(inspect(f, 'missing-owned-id')).rejects.toThrow('不存在');
  expect(await fs.readFile(f.manifest)).toEqual(manifest); expect(await fs.readFile(file.path)).toEqual(original);
  expect((await f.engine.snapshot()).ledger).toEqual(before); expect(f.calls).toHaveLength(0); expect(fetch).not.toHaveBeenCalled(); expectNoWrites(mutations);
});

it('inspection does not cache integrity and later same-length tampering fails before Key access or HTTP', async context => {
  const f = await fixture(context), file = await write(f), manifest = await fs.readFile(f.manifest);
  await expect(inspect(f, file.id)).resolves.toEqual({ id: file.id, mimeType: 'image/png', bytes: PNG.length });
  const damaged = Buffer.from(PNG); damaged[damaged.length - 1] ^= 1;
  await f.scope.run(() => fs.writeFile(file.path, damaged));
  const mutations = watchWrites(); await expect(inspect(f, file.id)).rejects.toThrow('应用外改变');
  const get = vi.fn(() => 'dummy-only'), withSecret = vi.fn(async (_id, _connectionId, action) => action(get())), fetch = vi.fn(() => { throw Error('HTTP must not start'); });
  const runtime = createModelRuntime({ credentialStore: { withSecret }, artifactStore: f.artifactStore, fetchImpl: fetch });
  const connection = { id: 'connection', name: '隔离无网络', protocol: 'image', providerId: 'custom', baseUrl: 'https://example.test/v1', enabled: true };
  const model = { id: 'image-model', connectionId: connection.id, modelId: 'fixture-image', name: '隔离图片模型', enabled: true, capabilities: ['image-editing'], pricing: { unit: 'image', currency: 'CNY', input: '0', output: '1' } };
  const input = { requestId: 'owned-inspection-request', runId: 'owned-run', projectId: f.project.id, connection, model, credentialId: 'metadata-only', kind: 'image-editing', prompt: '只修改原图', input: '', attachments: [file], options: { count: 1, size: '1024x1024' } };
  const originalRead = vi.spyOn(f.artifactStore, 'read');
  await expect(f.scope.run(() => runtime.execute(input))).rejects.toMatchObject({ requestStarted: false });
  expect(originalRead).toHaveBeenCalledExactlyOnceWith(file.id);
  await expect(originalRead.mock.results[0].value).rejects.toThrow('应用外改变');
  const workflowRequest = { ...request(), project: { ...f.project, kind: 'image' }, connections: [connection], models: [model], input: '独立参考图验收', attachmentIds: [file.id] };
  workflowRequest.workflow = { ...workflowRequest.workflow, outputKind: 'image', steps: [{ id: 'image', name: '精修图片', kind: 'image-editing', modelConfigId: model.id, credentialId: 'metadata-only', inputSource: 'project', prompt: '', count: 1, enabled: true }] };
  const checked = await f.scope.run(() => preflight(workflowRequest, { credentials: { list: async () => [{ id: 'metadata-only', connectionId: connection.id, enabled: true }] }, modelRuntime: runtime, artifactStore: f.artifactStore }));
  expect(checked.ok).toBe(false); expect(checked.errors.join(' ')).toContain('参考文件');
  expect(withSecret).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  expect((await f.engine.snapshot()).ledger).toEqual([]); expect(f.calls).toHaveLength(0);
  expect(await fs.readFile(f.manifest)).toEqual(manifest); expect(await fs.readFile(file.path)).toEqual(damaged); expectNoWrites(mutations);
});

it('damaged manifest rejects inspection without reading the original or replacing bad bytes', async context => {
  const f = await fixture(context), file = await write(f), damaged = Buffer.from('{broken-owned-manifest');
  await f.scope.run(() => fs.writeFile(f.manifest, damaged));
  const mutations = watchWrites(), reads = vi.spyOn(fs, 'readFile');
  await expect(inspect(f, file.id)).rejects.toThrow('登记表');
  expect(reads.mock.calls.some(call => String(call[0]) === file.path)).toBe(false);
  expect(await fs.readFile(f.manifest)).toEqual(damaged); expect(await fs.readFile(file.path)).toEqual(PNG); expectNoWrites(mutations);
});

it('trashed references remain rejected and inspection does not restore them', async context => {
  const f = await fixture(context), file = await write(f), trashed = await f.scope.run(() => f.artifactStore.trash(file.id)), manifest = await fs.readFile(f.manifest);
  const mutations = watchWrites(); await expect(inspect(f, file.id)).rejects.toMatchObject({ code: 'ARTIFACT_TRASHED' });
  expect(await fs.readFile(trashed.path)).toEqual(PNG); expect(await fs.readFile(f.manifest)).toEqual(manifest); expectNoWrites(mutations);
});

it.for([
  ['image/svg+xml', svg, '真实矢量.svg'], ['image/gif', gif, '真实动画.gif'], ['text/plain', Buffer.from('文本参考'), '普通文字.txt'],
])('inspection rejects unsupported reference MIME %s before original reads', async ([mimeType, buffer, name], context) => {
  const f = await fixture(context), file = await write(f, buffer, mimeType, name), mutations = watchWrites(), reads = vi.spyOn(fs, 'readFile');
  await expect(inspect(f, file.id)).rejects.toThrow('PNG、JPEG 或 WebP');
  expect(reads.mock.calls.some(call => String(call[0]) === file.path)).toBe(false); expectNoWrites(mutations);
});

it.for([0, limit, limit + 1])('inspection enforces the real registered-file byte boundary %i', async (bytes, context) => {
  const f = await fixture(context), buffer = Buffer.alloc(bytes); PNG.copy(buffer);
  // These registered raster bytes test the byte gate, not visual decoding or a production image fixture.
  const file = await write(f, buffer), mutations = watchWrites();
  if (bytes === limit) await expect(inspect(f, file.id)).resolves.toEqual({ id: file.id, mimeType: 'image/png', bytes });
  else await expect(inspect(f, file.id)).rejects.toThrow('20 MB');
  expectNoWrites(mutations);
});

it('artifact drain includes an inspection held between metadata listing and original read', async context => {
  const f = await fixture(context), file = await write(f), entered = deferred(), gate = f.scope.gate(), nativeRead = fs.readFile.bind(fs);
  vi.spyOn(fs, 'readFile').mockImplementation((filename, ...args) => {
    if (String(filename) === file.path) { entered.resolve(); return gate.wait.then(() => nativeRead(filename, ...args)); }
    return nativeRead(filename, ...args);
  });
  const pending = inspect(f, file.id); void pending.catch(() => undefined);
  await f.scope.run(() => entered.promise);
  let drained = false; const draining = f.artifactStore.drain().then(() => { drained = true; });
  await Promise.resolve(); expect(drained).toBe(false);
  gate.release(); await pending; await draining; expect(drained).toBe(true);
});
