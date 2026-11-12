const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
const { createLiveWorkflowEngine } = require('../../electron/live-workflow-engine.cjs');
const { startChecked, lookupStart } = require('../../electron/live-start.cjs');
const fs = require('node:fs/promises');
const { createWorkspaceStorage } = require('../../electron/workspace-storage.cjs');
const { createEditorStore } = require('../../electron/editor-store.cjs');
const { createSpreadsheetStore } = require('../../electron/spreadsheet-store.cjs');
const { createDocumentArtifactPreview } = require('../../electron/artifact-document-preview.cjs');
const { createDeliveryStore } = require('../../electron/delivery-store.cjs');

async function createFixtureProduction({ directory, workspaceId, png, nativeImage, credential }) {
  const calls = [], project = { id: 'chat-refinement-project', workspaceId, kind: 'image', name: '离线精修验收作品', description: '真实本地成品，外部模型只使用确定性替身', status: 'draft', costCents: 0, budgetCents: null, version: 1, updatedAt: new Date().toISOString(), accent: 'blue' };
  const connection = { id: 'fixture-image-connection', name: '离线图像制作替身', providerId: 'custom', protocol: 'openai-chat', baseUrl: 'https://image-offline.invalid/v1', enabled: true, status: 'configured' };
  const model = { id: 'fixture-image-model', name: '离线精修模型', modelId: 'fixture-image-edit', connectionId: connection.id, enabled: true, capabilities: ['image-editing', 'image-generation'], pricing: { unit: 'image', currency: 'CNY', input: '', output: '0.10' } };
  const key = { ...credential, id: 'fixture-image-key', connectionId: connection.id, name: '离线图片账户' };
  const workspaceStorage = createWorkspaceStorage({ directory: path.join(directory, 'workspace-registration') }), workspace = path.join(directory, 'workspace'); await fs.mkdir(workspace, { recursive: true });
  const artifactStore = createArtifactStore({ directory: path.join(directory, 'artifacts'), workspaceStorage, fitEngineering: async input => nativeImage.createFromBuffer(input.buffer).resize({ width: input.target.width, height: input.target.height }).toPNG() });
  workspaceStorage.setArtifactMigrator((projectId, destination, options) => artifactStore.migrateProject(projectId, destination, options));
  await workspaceStorage.bindRoot({ workspaceId, name: '独立文档与聊天验收', directory: workspace, projects: [] });
  await workspaceStorage.ensureProject({ projectId: project.id, workspaceId, name: project.name });
  const editorStore = createEditorStore({ workspaceStorage, artifactStore }), spreadsheetStore = createSpreadsheetStore({ workspaceStorage, artifactStore });
  const documentProjects = [], manualRecords = {};
  for (const kind of ['word', 'ppt', 'excel']) {
    const entry = { ...project, id: 'chat-export-' + kind, name: `回复保存${kind.toUpperCase()}验收`, kind }; documentProjects.push(entry);
    await workspaceStorage.ensureProject({ projectId: entry.id, workspaceId, name: entry.name });
    const document = kind === 'excel' ? { schemaVersion: 1, kind, title: '既有Excel人工稿', sheets: [{ id: 'manual-sheet', name: '人工记录', rowCount: 2, columnCount: 2, cells: { A1: { value: 'MANUAL_EXCEL_UNCHANGED' }, B2: { value: 7 } } }] } : kind === 'ppt' ? { schemaVersion: 1, kind, title: '既有PPT人工稿', theme: 'paper', slides: [{ id: 'manual-page', title: 'MANUAL_PPT_UNCHANGED', body: '人工确认的页面内容', notes: '', layout: 'title-body', fontSize: 20, align: 'left' }] } : { schemaVersion: 1, kind, title: '既有Word人工稿', blocks: [{ id: 'manual-block', type: 'paragraph', text: 'MANUAL_WORD_UNCHANGED', fontSize: 12, bold: false, italic: false, align: 'left' }] };
    manualRecords[kind] = await (kind === 'excel' ? spreadsheetStore : editorStore).save({ projectId: entry.id, expectedRevision: 0, document });
  }
  const source = await artifactStore.write({ projectId: project.id, name: '已保存精修原图.png', mimeType: 'image/png', buffer: png });
  const digest = createHash('sha256').update(png).digest('hex');
  const modelRuntime = { supports: (_connection, kind) => ['image-editing', 'image-generation'].includes(kind), async execute(input) {
    assert.equal(input.projectId, project.id); assert.equal(input.kind, 'image-editing');
    const references = await Promise.all(input.attachments.map(file => artifactStore.read(file.id)));
    assert.equal(references.length, 1); assert.equal(references[0].id, source.id); assert.equal(createHash('sha256').update(references[0].buffer).digest('hex'), digest);
    calls.push({ projectId: input.projectId, runId: input.runId, sourceArtifactId: source.id, sourceSha256: digest, input: input.input, prompt: input.prompt });
    const output = await artifactStore.write({ projectId: input.projectId, runId: input.runId, name: '独立精修结果.png', mimeType: 'image/png', buffer: png });
    return { text: '已根据明确选定的原图返回独立精修成品。', artifacts: [output], usage: { images: 1 } };
  } };
  const engine = createLiveWorkflowEngine({ directory: path.join(directory, 'history'), artifactStore, modelRuntime, credentials: { list: async () => [key] } });
  const readArtifact = async input => { assert.equal(input.workspaceId, workspaceId); assert([project, ...documentProjects].some(item => item.id === input.projectId)); const file = await artifactStore.read(input.artifactId); assert.equal(file.projectId, input.projectId); return file; };
  const documentArtifactPreview = createDocumentArtifactPreview({ liveEngine: engine, editorStore, spreadsheetStore });
  const previewArtifact = async id => { const [artifact] = await artifactStore.list([id]), content = await documentArtifactPreview(artifact); return content ? { artifact, supported: true, ...content } : artifactStore.preview(id); };
  const delivery = createDeliveryStore({ workspaceStorage, artifactStore, liveEngine: engine, editorStore, spreadsheetStore });
  return { project, documentProjects, manualRecords, source, model, connection, credential: key, calls, engine, artifactStore, workspaceStorage, editorStore, spreadsheetStore, delivery, previewArtifact, readArtifact, start: input => startChecked(engine, request => engine.start(request), input), lookup: input => lookupStart(engine, input) };
}
module.exports = { createFixtureProduction };
