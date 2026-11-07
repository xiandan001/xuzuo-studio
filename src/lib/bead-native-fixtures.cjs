const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { dependencies } = require('./production-test-fixtures.cjs');
const { PNG } = dependencies('pngjs');
const { createWorkspaceStorage } = require('../../electron/workspace-storage.cjs');
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
const { createCpuTasks } = require('../../electron/cpu-tasks.cjs');
const { createBeadStore } = require('../../electron/bead-store.cjs');
const { createBeadService } = require('../../electron/bead-service.cjs');
const { createLiveWorkflowEngine } = require('../../electron/live-workflow-engine.cjs');
const core = require('../../electron/bead-pattern.runtime.cjs');
function image(width = 8, height = 8, color = [255, 255, 255, 255]) { const result = new PNG({ width, height }); for (let at = 0; at < result.data.length; at += 4) result.data.set(color, at); return result; }
function fakeImage(bitmap) {
  return { isEmpty: () => false, getSize: () => ({ width: bitmap.width, height: bitmap.height }), toPNG: () => PNG.sync.write(bitmap), toBitmap() { const output = Buffer.alloc(bitmap.data.length); for (let at = 0; at < output.length; at += 4) { const alpha = bitmap.data[at + 3]; output.set([Math.round(bitmap.data[at + 2] * alpha / 255), Math.round(bitmap.data[at + 1] * alpha / 255), Math.round(bitmap.data[at] * alpha / 255), alpha], at); } return output; }, resize({ width, height }) { const resized = image(width, height, [0, 0, 0, 0]); for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const sx = Math.min(bitmap.width - 1, Math.floor((x + 0.5) * bitmap.width / width)), sy = Math.min(bitmap.height - 1, Math.floor((y + 0.5) * bitmap.height / height)); resized.data.set(bitmap.data.subarray((sy * bitmap.width + sx) * 4, (sy * bitmap.width + sx) * 4 + 4), (y * width + x) * 4); } return fakeImage(resized); } };
}
function pdfFixture(pages = 1) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, index) => `${index + 3} 0 R`).join(' ')}] /Count ${pages} >>`, ...Array.from({ length: pages }, () => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] >>')];
  let text = '%PDF-1.7\n', offsets = [0]; for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(text)); text += `${index + 1} 0 obj\n${object}\nendobj\n`; } const start = Buffer.byteLength(text); text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(at => String(at).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${start}\n%%EOF\n`; return Buffer.from(text);
}
const palette = { id: 'native-fixture', name: '原生测试色卡', brand: 'synthetic', version: 'v1', sourceUrl: 'https://example.com/palette', sourceNote: 'Synthetic fixture; no user images.', license: 'MIT synthetic fixture license', colors: [{ code: 'R1', name: '红', hex: '#FF0000', rgb: [255, 0, 0], kind: 'solid', automatic: true }, { code: 'W1', name: '白', hex: '#FFFFFF', rgb: [255, 255, 255], kind: 'solid', automatic: true }, { code: 'T1', name: '透明实体珠', hex: '#FFFFFF', rgb: [255, 255, 255], kind: 'transparent', automatic: false }] };
async function fixture() {
  const temporary = await fs.realpath(os.tmpdir()), directory = await fs.mkdtemp(path.join(temporary, 'xuzuo-bead-native-'));
  const workspaceStorage = createWorkspaceStorage({ directory }), artifactStore = createArtifactStore({ directory: path.join(directory, 'artifacts'), workspaceStorage, loadModule: dependencies }), workspace = path.join(directory, 'workspace');
  workspaceStorage.setArtifactMigrator((id, destination) => artifactStore.migrateProject(id, destination)); await fs.mkdir(workspace); await workspaceStorage.bindRoot({ workspaceId: 'workspace', name: '本地测试工作区', directory: workspace, projects: [] });
  const locations = {}; for (const id of ['project-a', 'project-b']) locations[id] = await workspaceStorage.ensureProject({ projectId: id, workspaceId: 'workspace', name: id });
  const store = createBeadStore({ workspaceStorage }), tasks = createCpuTasks();
  const calls = [], changes = []; let taskHook, printHook;
  const cpuTasks = { run(task, input, options) { calls.push({ task, input }); const execute = () => tasks.run(task, input, options); return taskHook ? taskHook(task, input, options, execute) : execute(); } };
  const nativeImage = { createFromBuffer(buffer) { return fakeImage(PNG.sync.read(buffer)); } }, dialog = { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }) };
  const providerCalls = [], engine = createLiveWorkflowEngine({ directory, artifactStore, readBeadDocument: projectId => store.read({ projectId }), credentials: { list: async () => [] }, modelRuntime: { supports: () => false, execute: async input => { providerCalls.push(input); throw Error('Bead fixtures must never call a provider'); } } });
  const service = createBeadService({ workspaceStorage, artifactStore, store, nativeImage, cpuTasks, dialog, printPdf: async (input, options) => printHook ? printHook(input, options) : pdfFixture(input.pages), onChanged: id => changes.push(id), onExport: input => engine.recordLocalExport({ projectId: input.projectId, workspaceId: 'workspace', name: input.document.title, kind: 'image', artifacts: input.artifacts, beadExport: input.beadExport }) });
  const references = {}; for (const id of ['project-a', 'project-b']) references[id] = await artifactStore.write({ projectId: id, name: '底图.png', mimeType: 'image/png', buffer: PNG.sync.write(image()) });
  const settings = { ...core.DEFAULT_BEAD_SETTINGS, columns: 8, rows: 8, maxColors: 2, boardColumns: 4, boardRows: 4 }, procurement = { copies: 3, lossPercent: 5, defaultPackSize: 1000, stock: { W1: 2 }, packSizes: { W1: 50 } };
  const input = (id = 'project-a', expectedRevision = 0) => ({ projectId: id, referenceId: references[id].id, title: '测试拼豆图纸', settings: structuredClone(settings), palette: structuredClone(palette), procurement: structuredClone(procurement), expectedRevision });
  return { directory, temporary, workspace, workspaceStorage, locations, artifactStore, store, tasks, service, dialog, references, input, settings, procurement, calls, changes, providerCalls, engine, core, nativeImage, setTaskHook(fn) { taskHook = fn; }, setPrintHook(fn) { printHook = fn; }, async close() { await service.shutdown(); await engine.shutdown(); await tasks.drain(); await store.drain(); await artifactStore.drain(); if (path.dirname(await fs.realpath(directory)) !== temporary || !path.basename(directory).startsWith('xuzuo-bead-native-') || (await fs.lstat(directory)).isSymbolicLink()) throw Error('Unsafe bead fixture cleanup'); await fs.rm(directory, { recursive: true, force: true }); } };
}
module.exports = { fixture, palette, image, fakeImage, pdfFixture, dependencies };
