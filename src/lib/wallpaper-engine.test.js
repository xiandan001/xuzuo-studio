import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { dependencies } = require('./production-test-fixtures.cjs');
const { PNG } = dependencies('pngjs');
const { createCpuTasks } = require('../../electron/cpu-tasks.cjs');
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
const { createModelRuntime } = require('../../electron/model-runtime.cjs');
const { createLiveWorkflowEngine } = require('../../electron/live-workflow-engine.cjs');
const { createDeliverySource } = require('../../electron/delivery-source.cjs');
const owned = [], target = { width: 64, height: 128, fit: 'cover', label: '固定壁纸设备' };
const hash = value => createHash('sha256').update(value).digest('hex');
const original = PNG.sync.write(new PNG({ width: 4, height: 2 }));
async function fixture(count = 1, failFitAt = 0, holdFit = false) {
  const temporary = await fs.realpath(os.tmpdir()), directory = await fs.mkdtemp(path.join(temporary, 'xuzuo-wallpaper-engine-')), tasks = createCpuTasks();
  let fits = 0, releaseFit, enteredFit;
  const gate = new Promise(resolve => { releaseFit = resolve; }), fitStarted = new Promise(resolve => { enteredFit = resolve; });
  const fitWallpaper = vi.fn(async (input, options) => { enteredFit(); if (holdFit) await gate; if (++fits === failFitAt) throw Error('模拟本地适配失败，原图保留。'); return tasks.run('wallpaper', input, options); });
  const artifactStore = createArtifactStore({ directory: path.join(directory, 'artifacts'), loadModule: dependencies, fitWallpaper });
  const fetchImpl = vi.fn(async (_url, init) => { expect(JSON.parse(init.body).size).toBe('1024x1536'); return new Response(JSON.stringify({ data: [{ b64_json: original.toString('base64') }], usage: { input_tokens: 30, output_tokens: 196 } }), { headers: { 'content-type': 'application/json', 'x-request-id': 'wallpaper-fixture-only' } }); });
  const credentialStore = { withSecret: async (_id, _connection, action) => action('fixture-not-an-account') };
  const modelRuntime = createModelRuntime({ artifactStore, credentialStore, fetchImpl, directory });
  const engine = createLiveWorkflowEngine({ directory, artifactStore, modelRuntime, credentials: { list: async () => [{ id: 'fixture-key', connectionId: 'connection', enabled: true }] } });
  const producers = Array.from({ length: count }, (_, index) => ({ id: `producer-${index}`, name: `制作原图${index + 1}`, kind: 'image-generation', inputSource: 'project', prompt: '仅本地模拟模型请求', enabled: true, modelConfigId: 'model', credentialId: 'fixture-key', imageOutputFormat: 'png', imageSize: '1024x1536', imageBackground: 'opaque', count: 1 }));
  const input = { project: { id: 'project', workspaceId: 'workspace', name: '精确像素壁纸', kind: 'image', costCents: 0 }, workflow: { id: 'wallpaper-flow', workspaceId: 'workspace', name: '壁纸生成与本地适配', outputKind: 'image', steps: [...producers, { id: 'fit', name: '本地适配壁纸', kind: 'export', inputSource: 'previous', prompt: '', enabled: true, wallpaperTarget: target, contentSourceStepIds: producers.map(step => step.id) }, { id: 'review', name: '检查最终壁纸', kind: 'manual-review', inputSource: 'previous', prompt: '', enabled: true }] }, models: [{ id: 'model', modelId: 'gpt-image-2.6-sunburst', name: '隔离图片模型', connectionId: 'connection', capabilities: ['image-generation', 'image-editing'], enabled: true, pricing: { unit: 'image', currency: 'CNY', input: '', output: '1' } }], connections: [{ id: 'connection', providerId: 'custom', protocol: 'image', baseUrl: 'https://fixture.invalid/v1', enabled: true }], input: '制作固定图案的壁纸', variables: {}, attachmentIds: [], acknowledgePaidCalls: true, acknowledgeUnknownCost: true };
  const workspaceStorage = { projectDirectory: async () => directory, list: async () => ({ projects: [{ projectId: 'project', name: input.project.name }] }) };
  const delivery = liveEngine => createDeliverySource({ workspaceStorage, artifactStore, liveEngine, inspectImage: async buffer => { const image = PNG.sync.read(buffer); return { width: image.width, height: image.height, transparency: 'opaque' }; } });
  const f = { directory, temporary, tasks, engine, artifactStore, fitWallpaper, fetchImpl, input, releaseFit, fitStarted, delivery: () => delivery(engine), deliveryFor: run => delivery({ snapshot: async () => ({ runs: [run] }) }) }; owned.push(f); return f;
}
afterEach(async () => {
  for (const f of owned.splice(0)) {
    f.releaseFit();
    await f.engine.shutdown(); await f.tasks.drain(); await f.artifactStore.drain();
    expect(path.dirname(await fs.realpath(f.directory))).toBe(f.temporary); expect(path.basename(f.directory)).toMatch(/^xuzuo-wallpaper-engine-/); expect((await fs.lstat(f.directory)).isSymbolicLink()).toBe(false); await fs.rm(f.directory, { recursive: true, force: true });
  }
});
async function waitFor(f, id, status) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) { const snapshot = await f.engine.snapshot(), run = snapshot.runs.find(item => item.id === id); if (run?.status === status) return { snapshot, run }; if (run?.status === 'failed' && status !== 'failed') throw Error(run.error); await new Promise(resolve => setTimeout(resolve, 10)); }
  throw Error('Wallpaper engine fixture deadline');
}
const producerFiles = run => run.attempts.filter(attempt => attempt.status === 'complete' && attempt.stepId.startsWith('producer-')).flatMap(attempt => attempt.artifacts || []);

describe('壁纸实际引擎与文件库恢复', () => {
  it('generates two paid originals then exact PNGs locally before review, retains hashes and model billing sizes', async () => {
    const f = await fixture(2), started = await f.engine.start(f.input), state = await waitFor(f, started.id, 'waiting-review');
    const originals = producerFiles(state.run), fitted = state.run.attempts.find(attempt => attempt.stepId === 'fit');
    expect(f.fetchImpl).toHaveBeenCalledTimes(2); expect(state.snapshot.ledger).toHaveLength(2); expect(state.snapshot.ledger.every(entry => entry.costState === 'calculated' && entry.costCents === 100)).toBe(true);
    expect(fitted.costState).toBe('not-incurred'); expect(fitted.sourceArtifactIds).toEqual(originals.map(file => file.id)); expect(fitted.artifacts).toHaveLength(2);
    for (const file of originals) expect(hash((await f.artifactStore.read(file.id)).buffer)).toBe(hash(original));
    for (const file of fitted.artifacts) { expect(originals.map(item => item.id)).not.toContain(file.id); expect(PNG.sync.read((await f.artifactStore.read(file.id)).buffer)).toMatchObject({ width: 64, height: 128 }); expect(file.name).toMatch(/\d{4}-\d{2}-\d{2}/); }
    const ledger = structuredClone(state.snapshot.ledger); await f.engine.control({ id: started.id, action: 'resume' }); const complete = await waitFor(f, started.id, 'complete'); expect(complete.snapshot.ledger).toEqual(ledger); expect(f.fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('continues a failed local fit with partial visible artifacts without another HTTP call or changing fees', async () => {
    const f = await fixture(2, 2), started = await f.engine.start(f.input), failed = await waitFor(f, started.id, 'failed'), prior = failed.run.attempts.find(attempt => attempt.stepId === 'fit');
    expect(prior.artifacts).toHaveLength(1); expect(prior.costState).toBe('not-incurred'); expect(f.fetchImpl).toHaveBeenCalledTimes(2);
    const ledger = structuredClone(failed.snapshot.ledger); await f.engine.control({ id: started.id, action: 'continue' }); const recovered = await waitFor(f, started.id, 'waiting-review');
    expect(f.fetchImpl).toHaveBeenCalledTimes(2); expect(recovered.snapshot.ledger).toEqual(ledger); expect(recovered.run.attempts.findLast(attempt => attempt.stepId === 'fit').artifacts).toHaveLength(2);
    expect((await f.artifactStore.read(prior.artifacts[0].id)).mimeType).toBe('image/png'); for (const file of producerFiles(recovered.run)) expect(hash((await f.artifactStore.read(file.id)).buffer)).toBe(hash(original));
  });
  it('cancels a held local fit without late writes or removing the completed model fee', async () => {
    const f = await fixture(1, 0, true), started = await f.engine.start(f.input); await f.fitStarted;
    const before = await f.engine.snapshot(); await f.engine.control({ id: started.id, action: 'cancel' }); f.releaseFit();
    await vi.waitFor(async () => { const state = await f.engine.snapshot(); expect(state.runs.find(run => run.id === started.id).attempts.find(attempt => attempt.stepId === 'fit').status).toBe('cancelled'); });
    const after = await f.engine.snapshot(), run = after.runs.find(item => item.id === started.id);
    expect(after.ledger).toEqual(before.ledger); expect(after.ledger).toHaveLength(1); expect(after.ledger[0].costCents).toBe(100); expect(run.attempts.find(attempt => attempt.stepId === 'fit').artifacts).toEqual([]); expect(await f.artifactStore.listProject('project')).toHaveLength(1); expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    const source = producerFiles(run)[0]; expect(path.dirname(source.path)).toBe(path.join(f.directory, 'artifacts', 'files')); await fs.unlink(source.path); await expect(f.engine.control({ id: started.id, action: 'continue' })).rejects.toThrow(); expect((await f.engine.snapshot()).runs.find(item => item.id === started.id).status).toBe('cancelled'); expect((await f.engine.snapshot()).ledger).toEqual(before.ledger); await fs.writeFile(source.path, original);
    await f.engine.control({ id: started.id, action: 'continue' }); const recovered = await waitFor(f, started.id, 'waiting-review'); expect(recovered.snapshot.ledger).toEqual(before.ledger); expect(f.fetchImpl).toHaveBeenCalledTimes(1); expect(recovered.run.attempts.findLast(attempt => attempt.stepId === 'fit').artifacts).toHaveLength(1);
  });
  it('blocks a missing retained source, restores it, then resumes only local work without charging again', async () => {
    const f = await fixture(1, 1), started = await f.engine.start(f.input), failed = await waitFor(f, started.id, 'failed'), source = producerFiles(failed.run)[0];
    expect(path.dirname(source.path)).toBe(path.join(f.directory, 'artifacts', 'files')); await fs.unlink(source.path);
    await expect(f.engine.control({ id: started.id, action: 'continue' })).rejects.toThrow(source.name);
    const blocked = await f.engine.snapshot(); expect(blocked.ledger).toEqual(failed.snapshot.ledger); expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    await fs.writeFile(source.path, original); await f.engine.control({ id: started.id, action: 'continue' }); const recovered = await waitFor(f, started.id, 'waiting-review');
    expect(recovered.snapshot.ledger).toEqual(failed.snapshot.ledger); expect(f.fetchImpl).toHaveBeenCalledTimes(1); expect(recovered.run.attempts.findLast(attempt => attempt.stepId === 'fit').artifacts).toHaveLength(1);
  });
  it.each(['invalid-target', 'producer-target', 'non-image-project', 'non-png-source', 'missing-target'])('%s is rejected before any model request', async reason => {
    const f = await fixture(), exporter = f.input.workflow.steps[1];
    if (reason === 'invalid-target') exporter.wallpaperTarget = { ...target, width: 8193 };
    if (reason === 'producer-target') f.input.workflow.steps[0].wallpaperTarget = target;
    if (reason === 'non-image-project') { f.input.project.kind = 'word'; f.input.workflow.outputKind = 'word'; }
    if (reason === 'non-png-source') f.input.workflow.steps[0].imageOutputFormat = 'gif';
    if (reason === 'missing-target') exporter.wallpaperTarget = null;
    const checked = await f.engine.preflight(f.input); expect(checked.ok).toBe(false); expect(checked.errors.join('')).toMatch(/壁纸/); expect(f.fetchImpl).not.toHaveBeenCalled(); expect(f.fitWallpaper).not.toHaveBeenCalled();
  });
});

describe('壁纸服务端交付只认可本次精确成品', () => {
  it('accepts a successful exact export and rejects its paid source as a wallpaper finished product', async () => {
    const f = await fixture(), started = await f.engine.start(f.input), state = await waitFor(f, started.id, 'waiting-review'), output = state.run.attempts.find(attempt => attempt.stepId === 'fit').artifacts[0];
    const delivery = f.delivery(), selected = await delivery({ projectId: 'project', kind: 'image', artifactIds: [output.id] });
    expect(selected.errors).toEqual([]); expect(selected.checks.find(check => check.id.startsWith('dimensions-')).status).toBe('passed');
    const source = await delivery({ projectId: 'project', kind: 'image', artifactIds: [producerFiles(state.run)[0].id] }); expect(source.errors.join('')).toContain('成功交付产物');
  });
  it.each(['reference', 'stale-source', 'wrong-size', 'generic-export'])('rejects %s despite successful-looking UI metadata', async reason => {
    const f = await fixture(), started = await f.engine.start(f.input), state = await waitFor(f, started.id, 'waiting-review'), run = structuredClone(state.run), exporter = run.snapshot.steps.find(step => step.id === 'fit'), attempt = run.attempts.find(item => item.stepId === 'fit');
    const fake = await f.artifactStore.write({ projectId: 'project', ...(reason !== 'reference' ? { runId: run.id } : {}), name: '错误成品.png', mimeType: 'image/png', buffer: original });
    if (reason === 'reference' || reason === 'wrong-size') attempt.artifacts = [fake];
    if (reason === 'stale-source') run.attempts.find(item => item.stepId === 'producer-0').artifacts = [fake];
    if (reason === 'generic-export') delete exporter.wallpaperTarget;
    const selected = await f.deliveryFor(run)({ projectId: 'project', kind: 'image', artifactIds: [attempt.artifacts[0].id], checks: [{ id: 'dimensions', status: 'passed' }] });
    expect(selected.errors.length > 0 || selected.checks.some(check => check.id.startsWith('dimensions-') && check.status === 'failed')).toBe(true);
  });
});
