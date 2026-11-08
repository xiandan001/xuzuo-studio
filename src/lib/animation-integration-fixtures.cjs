const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { fixture: productionFixture, dependencies, until } = require('./production-test-fixtures.cjs');
const { createAnimationStore } = require('../../electron/animation-store.cjs');
const { createAnimationJournal } = require('../../electron/animation-journal.cjs');
const { createAnimationService } = require('../../electron/animation-service.cjs');
const { createAnimationProduction } = require('../../electron/animation-production.cjs');
const { createLiveWorkflowEngine } = require('../../electron/live-workflow-engine.cjs');
const core = require('../../electron/animation-document.runtime.cjs');
const { PNG } = dependencies('pngjs');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function png(width = 64, height = 64, marker = 80) { const image = new PNG({ width, height }); for (let i = 0; i < image.data.length; i += 4) { image.data[i] = marker; image.data[i + 1] = 110; image.data[i + 2] = 170; image.data[i + 3] = 255; } return PNG.sync.write(image); }
function gif(width = 16, height = 16, loopMs = 200) {
  const header = Buffer.from([71,73,70,56,57,97,width & 255,width >> 8,height & 255,height >> 8,128,0,0,255,0,0,0,0,255]);
  const loop = Buffer.from([33,255,11,...Buffer.from('NETSCAPE2.0'),3,1,0,0,0]);
  const firstMs = Math.max(10, Math.floor(loopMs / 20) * 10), frame = (marker, milliseconds) => { const delay = milliseconds / 10; return Buffer.from([33,249,4,8,delay & 255,delay >> 8,0,0,44,0,0,0,0,1,0,1,0,0,2,2,marker,1,0]); };
  return Buffer.concat([header,loop,frame(68, firstMs),frame(76, loopMs - firstMs),Buffer.from([59])]);
}
function abortable(promise, signal) { if (!signal) return promise; return new Promise((resolve, reject) => { const abort = () => reject(Object.assign(Error('Synthetic tool cancelled'), { name: 'AbortError' })); if (signal.aborted) return abort(); signal.addEventListener('abort', abort, { once: true }); Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort)).catch(() => undefined); }); }

async function fixture(changes = {}) {
  const f = await productionFixture(), releases = [], calls = [], tools = [], exported = [], controls = {};
  if (changes.engineOverrides) { await f.engine.shutdown(); Object.assign(f.engineOptions, changes.engineOverrides); f.engine = createLiveWorkflowEngine(f.engineOptions); f.liveEngine = f.engine; }
  const project = { id: 'animation-project', workspaceId: 'production-workspace', name: '动画集成：合成模型与合成编码器', kind: 'image', costCents: 0, status: 'draft', description: '', version: 0, updatedAt: '2026-11-08T00:00:00Z', accent: 'blue' };
  await f.workspaceStorage.ensureProject({ projectId: project.id, workspaceId: project.workspaceId, name: project.name });
  const context = { project, connections: [{ id: 'connection', providerId: 'custom', protocol: 'image', baseUrl: 'https://no-network.invalid/v1', enabled: true }], models: [{ id: 'model', name: '合成图片模型，不连接供应商', modelId: 'synthetic-png', connectionId: 'connection', capabilities: ['image-generation','image-editing'], pricing: { unit: 'image', currency: 'CNY', input: '0', output: '0.02' }, enabled: true }], credentials: [{ id: 'metadata-only', connectionId: 'connection', name: '仅合成凭证元数据', enabled: true }] };
  f.engineOptions.modelRuntime.execute = async (input, options) => { calls.push(input); if (controls.modelGate) await abortable(controls.modelGate, options?.signal); if (controls.modelError) throw controls.modelError; const artifact = await f.artifactStore.write({ name: '合成PNG图集.png', mimeType: 'image/png', buffer: png(64, 64, 50 + calls.length), projectId: project.id, runId: input.runId }); return { artifacts: [artifact], usage: { images: 1, inputTokens: 5, outputTokens: 5 } }; };
  const tool = {
    async status() { if (controls.statusGate) await controls.statusGate; return controls.unavailable ? { available: false, reason: '合成测试：工具不可用' } : { available: true }; },
    async run(manifest, outputDirectory, { signal } = {}) {
      tools.push(structuredClone(manifest)); if (controls.toolGate) await abortable(controls.toolGate, signal); if (controls.toolError) throw controls.toolError;
      try { await fs.mkdir(outputDirectory); } catch (error) { if (error.code !== 'EEXIST' || (await fs.readdir(outputDirectory)).length) throw error; } const outputs = [];
      for (const entry of manifest.entries) { const coverPath = entry.id + '.png', framePaths = [];
        await fs.writeFile(path.join(outputDirectory, coverPath), png(manifest.width, manifest.height, 70));
        for (let i = 0, count = manifest.exportFrames && manifest.mode === 'gif' ? 2 : entry.frames.length; i < count; i++) { const filename = `${entry.id}-frame-${i}.png`; await fs.writeFile(path.join(outputDirectory, filename), png(manifest.width, manifest.height, 90 + i)); framePaths.push(filename); }
        const gifPath = entry.id + '.gif'; if (manifest.mode === 'gif') await fs.writeFile(path.join(outputDirectory, gifPath), gif(manifest.width, manifest.height, manifest.loopMs));
        outputs.push({ entryId: entry.id, ...(manifest.mode === 'gif' ? { gifPath } : {}), coverPath, framePaths, report: { width: manifest.width, height: manifest.height, frames: manifest.mode === 'gif' ? 2 : framePaths.length, loopMs: manifest.loopMs, loop: 0, transparent: false, warnings: ['Synthetic compositor; not a quality or actual GIF Factory renderer test.'] } });
      }
      if (manifest.exportFrames) { const Zip = dependencies('jszip'), zip = new Zip(); for (const output of outputs) for (const [index, filename] of output.framePaths.entries()) zip.file(`${output.entryId}/${String(index + 1).padStart(3, '0')}.png`, await fs.readFile(path.join(outputDirectory, filename))); const archivePath = 'frames.zip'; await fs.writeFile(path.join(outputDirectory, archivePath), await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' })); return { outputs, archivePath }; }
      return { outputs };
    },
    async drain() {}, async prepareClose() {}, async shutdown() {},
  };
  const events = [], store = createAnimationStore({ workspaceStorage: f.workspaceStorage }), journal = createAnimationJournal({ workspaceStorage: f.workspaceStorage });
  const options = { directory: f.directory, workspaceStorage: f.workspaceStorage, artifactStore: f.artifactStore, liveEngine: f.engine, getContext: async () => structuredClone(context), store, journal, tool, onChanged: value => events.push(value), onExport: async value => exported.push(value), ...changes };
  const service = createAnimationService(options), production = createAnimationProduction({ ...options, core });
  const initial = core.newAnimationDocument(project.id); await store.save({ projectId: project.id, expectedRevision: 0, document: { ...initial, style: 'pixel-light', columns: 1, rows: 1, width: 16, height: 16, fps: 10, loopMs: 200, modelConfigId: 'model', credentialId: 'metadata-only', entries: initial.entries.map(entry => ({ ...entry, description: '合成测试的独立角色反应' })) } });
  let stopped = false;
  async function close() { if (stopped) return; stopped = true; for (const release of releases) release(); controls.toolGate = undefined; controls.modelGate = undefined; controls.statusGate = undefined; await service.shutdown(); await f.engine.shutdown(); await Promise.all([store.drain(), journal.drain(), f.artifactStore.drain(), f.editorStore.drain(), f.spreadsheetStore.drain()]); const real = await fs.realpath(f.directory); if (path.dirname(real) !== await fs.realpath(os.tmpdir()) || !path.basename(real).startsWith('xuzuo-production-')) throw Error('Unsafe animation fixture cleanup'); await fs.rm(real, { recursive: true, force: true }); }
  async function job() { const timestamp = new Date().toISOString(), id = randomUUID(); await journal.mutate(project.id, state => { state.jobs.push({ id, projectId: project.id, status: 'running', stage: 'generating', entryIds: ['entry-1'], completedEntryIds: [], runIds: [], operations: [], createdAt: timestamp, updatedAt: timestamp }); return state; }); return id; }
  async function completed() { await service.drain(); return service.read({ projectId: project.id }); }
  async function source(document, entry = document.entries[0], frames = 1) { const artifact = await f.artifactStore.write({ projectId: project.id, name: '合成既有图集.png', mimeType: 'image/png', buffer: png() }); return { artifact, entry: { ...entry, frames: Array.from({ length: frames }, (_, index) => ({ id: `source-frame-${index}`, atlasArtifactId: artifact.id, cell: [index, 0], grid: [frames, 1], durationMs: Math.floor(200 / frames / 10) * 10 })), sourceHash: core.animationArtHash(document, [entry.id]), status: 'stale' } }; }
  return { ...f, project, context, store, journal, tool, calls, tools, exported, controls, options, service, production, events, releases, close, job, completed, source, input: { projectId: project.id }, until };
}
module.exports = { fixture, until, deferred, png, gif };
