import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url), { dependencies } = require('./production-test-fixtures.cjs'), { PNG } = dependencies('pngjs');
const { JPEG } = require('./engineering-test-fixtures.cjs');
const { createCpuTasks } = require('../../electron/cpu-tasks.cjs');
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
const { createModelRuntime } = require('../../electron/model-runtime.cjs');
const { createLiveWorkflowEngine } = require('../../electron/live-workflow-engine.cjs');
const { createRunHistoryStore } = require('../../electron/run-history-store.cjs');
const { createDeliverySource } = require('../../electron/delivery-source.cjs');
const owned = [], hash = bytes => createHash('sha256').update(bytes).digest('hex');
function png(width = 64, height = 128) { const image = new PNG({ width, height }); for (let at = 0; at < image.data.length; at += 4) image.data.set([255, 0, 0, 128], at); return PNG.sync.write(image); }
async function fixture(count = 1, { trailer = false, failFitAt = 0, hold = false } = {}) {
  const temporary = await fs.realpath(os.tmpdir()), directory = await fs.mkdtemp(path.join(temporary, 'xuzuo-engineering-engine-')), tasks = createCpuTasks(); let fits = 0, release, entered;
  const gate = new Promise(resolve => { release = resolve; }), fitStarted = new Promise(resolve => { entered = resolve; });
  const fitEngineering = vi.fn(async (input, options) => { entered(); if (hold) await gate; if (++fits === failFitAt) throw Error('模拟工程适配失败，原图保留。'); return tasks.run('engineering', input, options); });
  const store = createArtifactStore({ directory: path.join(directory, 'artifacts'), loadModule: dependencies, fitEngineering });
  const referenceBytes = trailer ? Buffer.concat([JPEG, Buffer.alloc(24, 65)]) : png();
  const reference = await store.write({ projectId: 'project', name: '主原图.png', mimeType: 'image/png', buffer: referenceBytes }), auxiliary = await store.write({ projectId: 'project', name: '辅助参考.png', mimeType: 'image/png', buffer: png() });
  const normalize = vi.fn(async () => ({ buffer: png(), mimeType: 'image/png', width: 64, height: 128 }));
  const fetchImpl = vi.fn(async (_url, init) => { expect(init.body).toBeInstanceOf(FormData); expect(init.body.getAll('image[]')).toHaveLength(2); expect(init.body.get('size')).toBe('1024x1536'); expect([...init.body.keys()]).not.toContain('engineeringReferenceId'); expect([...init.body.keys()]).not.toContain('maxPixels'); return new Response(JSON.stringify({ data: [{ b64_json: png(4, 2).toString('base64') }], usage: { input_tokens: 30, output_tokens: 196 } }), { headers: { 'content-type': 'application/json', 'x-request-id': 'engineering-fixture-only' } }); });
  const runtime = createModelRuntime({ artifactStore: store, credentialStore: { withSecret: async (_id, _connection, action) => action('fixture-not-an-account') }, fetchImpl, normalizeRasterReference: normalize, directory });
  const engineOptions = { directory, artifactStore: store, modelRuntime: runtime, credentials: { list: async () => [{ id: 'fixture-key', connectionId: 'connection', enabled: true }] } }, engine = createLiveWorkflowEngine(engineOptions);
  const producers = Array.from({ length: count }, (_, index) => ({ id: `producer-${index}`, name: `工程图片编辑${index + 1}`, kind: 'image-editing', inputSource: 'project', prompt: '首图是主画布，保留结构、文字和尺寸，仅执行用户明确修改。', enabled: true, modelConfigId: 'model', credentialId: 'fixture-key', imageOutputFormat: 'png', imageSize: '1024x1536', count: 1 }));
  const input = { project: { id: 'project', workspaceId: 'workspace', name: '工程照片与图纸', kind: 'image', costCents: 0 }, workflow: { id: 'engineering-flow', workspaceId: 'workspace', name: '工程编辑与原尺寸保存', outputKind: 'image', steps: [...producers, { id: 'fit', name: '按主原图尺寸保存', kind: 'export', inputSource: 'previous', prompt: '', enabled: true, engineeringReferenceId: reference.id, contentSourceStepIds: producers.map(step => step.id) }, { id: 'review', name: '对照检查工程成品', kind: 'manual-review', inputSource: 'previous', prompt: '', enabled: true }] }, models: [{ id: 'model', modelId: 'gpt-image-2.6-sunburst', name: '隔离图片模型', connectionId: 'connection', capabilities: ['image-generation', 'image-editing'], enabled: true, pricing: { unit: 'image', currency: 'CNY', input: '', output: '1' } }], connections: [{ id: 'connection', providerId: 'custom', protocol: 'image', baseUrl: 'https://fixture.invalid/v1', enabled: true }], input: '对主原图进行指定工程编辑', variables: {}, attachmentIds: [reference.id, auxiliary.id], acknowledgePaidCalls: true, acknowledgeUnknownCost: true };
  const deliveryFor = liveEngine => createDeliverySource({ artifactStore: store, liveEngine, workspaceStorage: { projectDirectory: async () => directory, list: async () => ({ projects: [{ projectId: 'project', name: input.project.name }] }) }, inspectImage: async buffer => { const image = PNG.sync.read(buffer); return { width: image.width, height: image.height, transparency: 'present' }; } });
  const f = { directory, temporary, tasks, store, runtime, engine, engineOptions, input, reference, referenceBytes, auxiliary, fitEngineering, fitStarted, release, fetchImpl, normalize, delivery: () => deliveryFor(engine), deliveryFor: run => deliveryFor({ snapshot: async () => ({ runs: [run] }) }) }; owned.push(f); return f;
}
afterEach(async () => { for (const f of owned.splice(0)) { f.release(); await f.engine.shutdown(); await f.tasks.drain(); await f.store.drain(); expect(path.dirname(await fs.realpath(f.directory))).toBe(f.temporary); expect(path.basename(f.directory)).toMatch(/^xuzuo-engineering-engine-/); expect((await fs.lstat(f.directory)).isSymbolicLink()).toBe(false); await fs.rm(f.directory, { recursive: true, force: true }); } });
async function waitFor(f, id, status) { const deadline = Date.now() + 10000; while (Date.now() < deadline) { const snapshot = await f.engine.snapshot(), run = snapshot.runs.find(item => item.id === id); if (run?.status === status) return { snapshot, run }; if (run?.status === 'failed' && status !== 'failed') throw Error(run.error); await new Promise(resolve => setTimeout(resolve, 10)); } throw Error('Engineering fixture deadline'); }
const exportAttempt = run => run.attempts.findLast(attempt => attempt.stepId === 'fit');
describe('工程编辑真实引擎与本地原尺寸导出', () => {
  it.each([false, true])('preserves original SHA and exact target with injected normalization trailer=%s, keeping paid size and local zero fee', async trailer => {
    const f = await fixture(2, { trailer }), started = await f.engine.start(f.input), state = await waitFor(f, started.id, 'waiting-review'), fitted = exportAttempt(state.run);
    expect(f.fetchImpl).toHaveBeenCalledTimes(2); expect(state.snapshot.ledger).toHaveLength(2); expect(state.snapshot.ledger.every(entry => entry.costCents === 100 && entry.costState === 'calculated')).toBe(true); expect(fitted.costState).toBe('not-incurred');
    expect(fitted.engineeringSource).toEqual({ referenceId: f.reference.id, width: 64, height: 128, sha256: hash(f.referenceBytes) }); expect(fitted.sourceArtifactIds).toHaveLength(2); expect(fitted.artifacts).toHaveLength(2);
    for (const output of fitted.artifacts) { expect(PNG.sync.read((await f.store.read(output.id)).buffer)).toMatchObject({ width: 64, height: 128 }); expect(fitted.sourceArtifactIds).not.toContain(output.id); }
    expect(hash((await f.store.read(f.reference.id)).buffer)).toBe(hash(f.referenceBytes));
    if (trailer) { expect(f.normalize).toHaveBeenCalledTimes(2); expect(f.normalize.mock.calls.every(([input]) => input.maxPixels === 16000000 && hash(input.buffer) === hash(f.referenceBytes))).toBe(true); } else expect(f.normalize).not.toHaveBeenCalled();
    const ledger = structuredClone(state.snapshot.ledger); await f.engine.control({ id: started.id, action: 'resume' }); expect((await waitFor(f, started.id, 'complete')).snapshot.ledger).toEqual(ledger); expect(f.fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('retains partial local results and retries failed fitting without another paid request', async () => {
    const f = await fixture(2, { failFitAt: 2 }), started = await f.engine.start(f.input), failed = await waitFor(f, started.id, 'failed'); expect(exportAttempt(failed.run).artifacts).toHaveLength(1);
    await f.engine.control({ id: started.id, action: 'continue' }); const recovered = await waitFor(f, started.id, 'waiting-review'); expect(recovered.snapshot.ledger).toEqual(failed.snapshot.ledger); expect(f.fetchImpl).toHaveBeenCalledTimes(2); expect(exportAttempt(recovered.run).artifacts).toHaveLength(2);
  });
  it('grants the 16M normalization context only to the bound primary image, never auxiliary references', async () => {
    const f = await fixture(1, { trailer: true }), read = f.store.read;
    vi.spyOn(f.store, 'read').mockImplementation(async id => { const file = await read(id); return id === f.auxiliary.id ? { ...file, buffer: f.referenceBytes } : file; });
    const started = await f.engine.start(f.input); await waitFor(f, started.id, 'waiting-review');
    expect(f.normalize).toHaveBeenCalledTimes(2); expect(f.normalize.mock.calls[0][0].maxPixels).toBe(16000000); expect(f.normalize.mock.calls[1][0]).not.toHaveProperty('maxPixels'); expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('ignores client-supplied limit fields and rejects an internal context not bound to the first actual reference', async () => {
    const f = await fixture(1, { trailer: true });
    const request = { requestId: 'ordinary-context', projectId: 'project', runId: 'direct-run', model: f.input.models[0], connection: f.input.connections[0], credentialId: 'fixture-key', kind: 'image-editing', prompt: '仅验证内部上下文', input: '', attachments: [f.reference, f.auxiliary], options: { count: 1, size: '1024x1536', outputFormat: 'png', maxPixels: 16000000, engineeringReferenceId: f.reference.id } };
    await f.runtime.execute(request); expect(f.normalize.mock.calls[0][0]).not.toHaveProperty('maxPixels'); expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    await expect(f.runtime.execute({ ...request, requestId: 'misbound-context' }, { engineeringReferenceId: f.auxiliary.id })).rejects.toMatchObject({ code: 'INVALID_IMAGE_INPUT', requestStarted: false }); expect(f.fetchImpl).toHaveBeenCalledTimes(1); expect(f.normalize).toHaveBeenCalledTimes(1);
  });
  it('cancels local fitting without a late file or reversing the completed provider fee', async () => {
    const f = await fixture(1, { hold: true }), started = await f.engine.start(f.input); await f.fitStarted; const before = await f.engine.snapshot();
    await f.engine.control({ id: started.id, action: 'cancel' }); f.release(); await vi.waitFor(async () => expect(exportAttempt((await f.engine.snapshot()).runs.find(run => run.id === started.id)).status).toBe('cancelled'));
    const after = await f.engine.snapshot(); expect(after.ledger).toEqual(before.ledger); expect(after.ledger[0].costCents).toBe(100); expect(f.fetchImpl).toHaveBeenCalledTimes(1); expect(await f.store.listProject('project')).toHaveLength(3);
    expect(path.dirname(f.reference.path)).toBe(path.join(f.directory, 'artifacts', 'files')); await fs.unlink(f.reference.path);
    await expect(f.engine.control({ id: started.id, action: 'continue' })).rejects.toThrow(); expect((await f.engine.snapshot()).runs.find(run => run.id === started.id).status).toBe('cancelled'); expect((await f.engine.snapshot()).ledger).toEqual(before.ledger); expect(f.fetchImpl).toHaveBeenCalledTimes(1); await fs.writeFile(f.reference.path, f.referenceBytes);
    await f.engine.control({ id: started.id, action: 'continue' }); const recovered = await waitFor(f, started.id, 'waiting-review'); expect(recovered.snapshot.ledger).toEqual(before.ledger); expect(f.fetchImpl).toHaveBeenCalledTimes(1); expect(exportAttempt(recovered.run).artifacts).toHaveLength(1);
  });
  it('cannot resume a superseded cancelled local export', async () => {
    const f = await fixture(1, { hold: true }), started = await f.engine.start(f.input); await f.fitStarted; await f.engine.control({ id: started.id, action: 'cancel' }); f.release();
    await vi.waitFor(async () => expect(exportAttempt((await f.engine.snapshot()).runs.find(run => run.id === started.id)).status).toBe('cancelled')); await f.engine.shutdown();
    const history = createRunHistoryStore({ directory: f.directory, fileSystem: fs }), stored = await history.load(), record = stored.records.find(item => item.run.id === started.id); record.run.supersededByRunId = 'replacement-run'; await history.save(stored.records, stored.revision + 1, { changedIds: [started.id] });
    const reopened = createLiveWorkflowEngine(f.engineOptions);
    try { const before = await reopened.snapshot(); await expect(reopened.control({ id: started.id, action: 'continue' })).rejects.toThrow('当前状态'); expect((await reopened.snapshot()).ledger).toEqual(before.ledger); expect(f.fetchImpl).toHaveBeenCalledTimes(1); }
    finally { await reopened.shutdown(); }
  });
  it('cannot resume a cancelled paid producer through the local-export recovery path', async () => {
    const f = await fixture(), normalFetch = f.fetchImpl.getMockImplementation(); let finish;
    const held = new Promise(resolve => { finish = resolve; }); f.fetchImpl.mockImplementationOnce(async (...args) => { await held; return normalFetch(...args); });
    const started = await f.engine.start(f.input); await vi.waitFor(() => expect(f.fetchImpl).toHaveBeenCalledTimes(1)); await f.engine.control({ id: started.id, action: 'cancel' }); finish();
    await vi.waitFor(async () => expect((await f.engine.snapshot()).runs.find(run => run.id === started.id).attempts[0].status).toBe('cancelled'));
    const before = await f.engine.snapshot(); await expect(f.engine.control({ id: started.id, action: 'continue' })).rejects.toThrow('当前状态'); expect((await f.engine.snapshot()).ledger).toEqual(before.ledger); expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('restores a missing primary reference then resumes only local fitting with original fees intact', async () => {
    const f = await fixture(1, { failFitAt: 1 }), started = await f.engine.start(f.input), failed = await waitFor(f, started.id, 'failed'); expect(path.dirname(f.reference.path)).toBe(path.join(f.directory, 'artifacts', 'files')); await fs.unlink(f.reference.path);
    await expect(f.engine.control({ id: started.id, action: 'continue' })).rejects.toThrow(); expect((await f.engine.snapshot()).ledger).toEqual(failed.snapshot.ledger);
    await fs.writeFile(f.reference.path, f.referenceBytes); await f.engine.control({ id: started.id, action: 'continue' }); expect((await waitFor(f, started.id, 'waiting-review')).snapshot.ledger).toEqual(failed.snapshot.ledger); expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each(['missing-reference', 'not-first', 'foreign-reference', 'text-generation', 'producer-marker', 'mixed-wallpaper', 'null-reference', 'reference-as-markup'])('%s is rejected before the provider can be called', async reason => {
    const f = await fixture(), exporter = f.input.workflow.steps[1], producer = f.input.workflow.steps[0];
    if (reason === 'missing-reference') f.input.attachmentIds = [];
    if (reason === 'not-first') exporter.engineeringReferenceId = f.auxiliary.id;
    if (reason === 'foreign-reference') { const read = f.store.read; vi.spyOn(f.store, 'read').mockImplementation(async id => { const file = await read(id); return id === f.reference.id ? { ...file, projectId: 'other' } : file; }); }
    if (reason === 'text-generation') producer.kind = 'image-generation';
    if (reason === 'producer-marker') producer.engineeringReferenceId = f.reference.id;
    if (reason === 'mixed-wallpaper') exporter.wallpaperTarget = { width: 64, height: 128, fit: 'cover' };
    if (reason === 'null-reference') exporter.engineeringReferenceId = null;
    if (reason === 'reference-as-markup') producer.imageMarkupId = f.reference.id;
    const checked = await f.engine.preflight(f.input); expect(checked.ok).toBe(false); expect(checked.errors.join('')).toMatch(/工程/); expect(f.fetchImpl).not.toHaveBeenCalled(); expect(f.fitEngineering).not.toHaveBeenCalled();
  });
});
describe('工程服务端交付绑定原图与已付费编辑结果', () => {
  it('accepts exact engineer PNG, refuses references or pre-fit output, and checks the retained original source', async () => {
    const f = await fixture(), started = await f.engine.start(f.input), state = await waitFor(f, started.id, 'waiting-review'), fitted = exportAttempt(state.run), delivery = f.delivery();
    const inspected = await delivery({ projectId: 'project', kind: 'image', artifactIds: [fitted.artifacts[0].id] }); expect(inspected.errors).toEqual([]); expect(inspected.checks.find(item => item.id.startsWith('dimensions-')).status).toBe('passed');
    for (const id of [f.reference.id, fitted.sourceArtifactIds[0]]) expect((await delivery({ projectId: 'project', kind: 'image', artifactIds: [id] })).errors.length).toBeGreaterThan(0);
    await fs.unlink(f.reference.path); expect((await delivery({ projectId: 'project', kind: 'image', artifactIds: [fitted.artifacts[0].id] })).errors.join('')).toMatch(/主原图/); await fs.writeFile(f.reference.path, f.referenceBytes);
    expect((await delivery({ projectId: 'project', kind: 'image', artifactIds: [fitted.artifacts[0].id] })).errors).toEqual([]); expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each(['wrong-size', 'wrong-sha', 'wrong-reference', 'stale-paid-source'])('rejects %s even when UI claims acceptance', async reason => {
    const f = await fixture(), started = await f.engine.start(f.input), state = await waitFor(f, started.id, 'waiting-review'), run = structuredClone(state.run), fitted = exportAttempt(run);
    if (reason === 'wrong-size') fitted.artifacts = [await f.store.write({ projectId: 'project', runId: run.id, name: '错误尺寸.png', mimeType: 'image/png', buffer: png(128, 64) })];
    if (reason === 'wrong-sha') fitted.engineeringSource.sha256 = '0'.repeat(64);
    if (reason === 'wrong-reference') fitted.engineeringSource.referenceId = f.auxiliary.id;
    if (reason === 'stale-paid-source') fitted.sourceArtifactIds = [f.reference.id];
    const inspected = await f.deliveryFor(run)({ projectId: 'project', kind: 'image', artifactIds: [fitted.artifacts[0].id], checks: [{ id: 'dimensions', status: 'passed' }] }); expect(inspected.errors.length > 0 || inspected.checks.some(check => check.status === 'failed')).toBe(true);
  });
});
