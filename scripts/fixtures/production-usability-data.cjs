const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { Worker } = require('node:worker_threads');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function illustration(nativeImage, width, height) {
  const bitmap = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4, circle = (x - width * .5) ** 2 + (y - height * .45) ** 2 < (width * .3) ** 2;
    bitmap.set(circle ? [64, 185, 245, 255] : y > height * .75 ? [160, 110, 35, 255] : [215, 242, 249, 255], at);
  }
  return nativeImage.createFromBitmap(bitmap, { width, height }).toPNG();
}
async function createProductionUsabilityData({ directory, nativeImage, BrowserWindow, metrics, ownerFile, ownerNonce, loadModule }) {
  const workspaceId = 'usability-workspace', projectId = 'usability-poster';
  const workspaceStorage = require('../../electron/workspace-storage.cjs').createWorkspaceStorage({ directory: path.join(directory, 'registration') });
  const artifactStore = require('../../electron/artifact-store.cjs').createArtifactStore({ directory: path.join(directory, 'artifacts'), workspaceStorage, loadModule });
  workspaceStorage.setArtifactMigrator((id, target, options) => artifactStore.migrateProject(id, target, options));
  const workspace = path.join(directory, 'workspace'); await fs.mkdir(workspace);
  await workspaceStorage.bindRoot({ workspaceId, name: '隔离制作验收', directory: workspace, projects: [] });
  for (const id of [projectId, 'usability-word', 'usability-ppt']) await workspaceStorage.ensureProject({ projectId: id, workspaceId, name: id });
  const workers = [], exports = [], calls = { performanceReads: 0, performanceSaves: 0, previews: [], templateSaves: 0, templateInstantiations: 0, reflowPreviews: 0, reflowExports: 0, createdProjects: 0, provider: 0 };
  const cpuTasks = require('../../electron/cpu-tasks.cjs').createCpuTasks({ workerFile: path.join(__dirname, 'production-usability-worker.cjs'), createWorker: (file, options) => {
    const worker = new Worker(file, { ...options, workerData: { ...options.workerData, testOwnerFile: ownerFile, testOwnerNonce: ownerNonce } });
    const row = { task: options.workerData.task, threadId: worker.threadId, dependencyBootstrapVerified: false, exited: false }; workers.push(row);
    worker.once('message', message => { row.dependencyBootstrapVerified = message.fixtureDependencyBootstrapVerified === true; }); worker.once('exit', () => { row.exited = true; }); return worker;
  } });
  const performanceControl = require('../../electron/performance-control.cjs').createPerformanceControl({ directory, cpuTasks, metrics });
  const commerce = require('../../electron/commerce-images.cjs').createCommerceImages({ workspaceStorage, artifactStore, nativeImage, cpuTasks, BrowserWindow, onExport: async result => { exports.push(result); } });
  const editorStore = require('../../electron/editor-store.cjs').createEditorStore({ workspaceStorage, artifactStore });
  const spreadsheetStore = require('../../electron/spreadsheet-store.cjs').createSpreadsheetStore({ workspaceStorage, artifactStore, loadModule });
  const templates = require('../../electron/project-templates.cjs').createProjectTemplates({ directory, workspaceStorage, artifactStore, editorStore, spreadsheetStore, commerceImages: () => commerce, loadModule });
  const source = await artifactStore.write({ projectId, name: '原始商品.png', mimeType: 'image/png', buffer: illustration(nativeImage, 240, 320) });
  const opened = await commerce.read({ projectId, sourceArtifactId: source.id });
  const scope = { projectId, sourceArtifactId: source.id, documentId: opened.documentId };
  const document = await commerce.save({ ...scope, expectedRevision: 0, document: { type: 'xuzuo-commerce-image', version: 1, id: opened.documentId, projectId, sourceArtifactId: source.id, sourceSha256: opened.source.sha256, revision: 0, title: '客户甲海报原稿', width: 480, height: 480, background: '#FFFFFF', updatedAt: '', layers: [
    { id: 'usability-product', name: '原始商品', type: 'image', role: 'product', artifactId: source.id, x: 150, y: 110, width: 180, height: 240, opacity: 1, visible: true, locked: false },
    { id: 'usability-heading', name: '客户文案', type: 'text', text: '新一季 · 原创好物', fontSize: 28, fontFamily: 'Arial', fontWeight: 'bold', color: '#112233', align: 'center', x: 24, y: 28, width: 432, height: 70, opacity: 1, visible: true, locked: false },
  ] } });
  const imageIds = {}, documents = {};
  for (const kind of ['word', 'ppt']) {
    const id = `usability-${kind}`, image = await artifactStore.write({ projectId: id, name: `${kind}-实际插图.png`, mimeType: 'image/png', buffer: illustration(nativeImage, 360, 240) }); imageIds[kind] = image.id;
    const body = kind === 'word' ? { schemaVersion: 1, kind, title: '带图说明书', blocks: [{ id: 'word-intro', type: 'paragraph', text: '这份正文与插图来自独立项目的实际已保存文稿。', fontSize: 14, bold: false, italic: false, align: 'left' }, { id: 'word-picture', type: 'image', imageId: image.id, text: '实物配图 · 可以点击定位编辑', fontSize: 12, bold: false, italic: false, align: 'center' }, ...Array.from({ length: 8 }, (_, index) => ({ id: `word-copy-${index}`, type: 'paragraph', text: `第 ${index + 1} 项：完整说明用于检查正文滚动及插图下方内容是否可达。`, fontSize: 14, bold: false, italic: false, align: 'left' }))] } : { schemaVersion: 1, kind, title: '带图产品提案', theme: 'paper', slides: [{ id: 'ppt-picture', title: '一页看懂产品', body: '真实管理插图\n预览中直接定位此页', notes: '', layout: 'image-right', fontSize: 22, align: 'left', imageId: image.id }, { id: 'ppt-last', title: '交付前检查', body: '检查图片、正文与最终文件。', notes: '', layout: 'title-body', fontSize: 22, align: 'left' }] };
    documents[kind] = await editorStore.save({ projectId: id, expectedRevision: 0, document: body, sourceArtifactIds: [image.id] });
  }
  const original = new Map(); for (const id of [source.id, ...Object.values(imageIds)]) original.set(id, hash((await artifactStore.read(id)).buffer));
  const originalDocument = structuredClone(document), originalDocuments = structuredClone(documents);
  const stamp = new Date().toISOString(), project = { id: projectId, workspaceId, kind: 'image', name: '客户甲海报', description: '隔离项目创建 seam；无 Key、无供应商调用', status: 'review', costCents: 123, budgetCents: null, version: 1, updatedAt: stamp, accent: 'blue' };
  // This immutable prior-cost UI fixture is not a supplier receipt or a paid call.
  const ledger = [{ id: 'synthetic-prior-cost', workspaceId, projectId, projectName: project.name, billingMode: 'live', status: 'complete', action: '合成的历史费用保护样例', costCents: 123, amount: 1.23, currency: 'CNY', time: stamp }];
  const projects = [project]; let lastTemplate, lastInstance, lastReflow;
  async function preview(id) {
    const file = await artifactStore.read(id); const image = nativeImage.createFromBuffer(file.buffer); assert(!image.isEmpty()); calls.previews.push({ id, projectId: file.projectId, sha256: hash(file.buffer) });
    const size = image.getSize(); return { mimeType: file.mimeType, dataUrl: image.toDataURL(), width: size.width, height: size.height, sourceSha256: hash(file.buffer) };
  }
  async function createProject(input) {
    assert.equal(input.workspaceId, workspaceId); assert.equal(calls.createdProjects, 0); calls.createdProjects++;
    const created = { ...project, id: 'usability-copy', name: input.name, costCents: 0, version: 0, status: 'draft' };
    await workspaceStorage.ensureProject({ projectId: created.id, workspaceId, name: created.name }); projects.push(created); return created;
  }
  async function snapshot() {
    const sources = []; for (const [id, sha256] of original) sources.push({ id, sha256: hash((await artifactStore.read(id)).buffer), unchanged: hash((await artifactStore.read(id)).buffer) === sha256 });
    assert.deepEqual(await commerce.templateSource(scope), originalDocument);
    for (const kind of ['word', 'ppt']) assert.deepEqual(await editorStore.load({ projectId: `usability-${kind}`, kind }), originalDocuments[kind]);
    return { sourceUnchanged: sources.every(item => item.unchanged), originalDocumentsUnchanged: true, sources, calls, workers, providerCalls: calls.provider, ledger, exports: exports.map(result => ({ ...result })), lastTemplate, lastInstance, lastReflow };
  }
  return { workspaceStorage, artifactStore, cpuTasks, performanceControl, commerce, editorStore, templates, scope, document, source, projects, calls, exports, preview, createProject, snapshot,
    setTemplate: value => { lastTemplate = value; }, setInstance: value => { lastInstance = value; }, setReflow: value => { lastReflow = value; },
    context: { workspaceId, project, source, scope, revision: document.revision, documents, imageIds, ledger, configuration: { version: 1, models: [], connections: [], credentials: [], workflows: [], categories: [], studioActions: [], useTemplates: [], vaultStatus: { available: false } } },
    async close() { await commerce.prepareClose(); await commerce.shutdown(); await templates.drain(); await Promise.all([cpuTasks.drain(), performanceControl.flush(), editorStore.drain(), spreadsheetStore.drain(), artifactStore.drain()]); const end = Date.now() + 2500; while (workers.some(row => !row.exited) && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 25)); assert(workers.every(row => row.exited)); },
  };
}
module.exports = { createProductionUsabilityData };
