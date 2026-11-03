const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { existsSync } = require('node:fs');
const projectRoot = path.resolve(__dirname, '../..');
const { createWorkspaceStorage } = require(path.join(projectRoot, 'electron/workspace-storage.cjs'));
const { createArtifactStore } = require(path.join(projectRoot, 'electron/artifact-store.cjs'));
const { createEditorStore } = require(path.join(projectRoot, 'electron/editor-store.cjs'));
const { createSpreadsheetStore } = require(path.join(projectRoot, 'electron/spreadsheet-store.cjs'));
const { createLiveWorkflowEngine } = require(path.join(projectRoot, 'electron/live-workflow-engine.cjs'));
const healthyManifest = path.join(projectRoot, 'work/ui-build/package.json');
const dependencies = createRequire(existsSync(healthyManifest) ? healthyManifest : path.join(projectRoot, 'package.json'));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
const word = (text = '客户已经确认的完整正文') => ({ schemaVersion: 1, kind: 'word', title: '客户交付文稿', blocks: [{ id: 'paragraph', type: 'paragraph', text, fontSize: 12, bold: false, italic: false, align: 'left' }] });
function request() {
  return { project: { id: 'template-project', workspaceId: 'production-workspace', name: '批量模板', kind: 'word', costCents: 0, status: 'draft', description: '', version: 0, updatedAt: '', accent: 'blue' }, workflow: { id: 'quick-template-word-create', workspaceId: 'production-workspace', name: '默认快速制作', description: '由工作台创建，可编辑步骤、模型和提示词后重复使用。', outputKind: 'word', updatedAt: '', steps: [{ id: 'text', name: '正文', kind: 'text', prompt: '撰写完整商用正文', modelConfigId: 'model', credentialId: 'metadata-only', inputSource: 'project', enabled: true }, { id: 'review', name: '人工检查实际结果', kind: 'manual-review', prompt: '', inputSource: 'previous', enabled: true }, { id: 'export', name: '生成实际交付文件', kind: 'export', prompt: '', inputSource: 'previous', enabled: true }] }, connections: [{ id: 'connection', name: '内存fixture', providerId: 'custom', protocol: 'openai-chat', baseUrl: 'https://isolated.invalid/v1', enabled: true }], models: [{ id: 'model', name: '无网络fixture', modelId: 'fixture', connectionId: 'connection', capabilities: ['text'], pricing: { unit: 'million-tokens', currency: 'CNY', input: '2', output: '8' }, enabled: true }], input: '为{{客户}}制作完整交付文稿', variables: {}, attachmentIds: [], acknowledgePaidCalls: true, acknowledgeUnknownCost: true };
}
async function fixture(execute) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-production-'));
  const workspaceStorage = createWorkspaceStorage({ directory }), artifactStore = createArtifactStore({ directory: path.join(directory, 'artifacts-v1'), workspaceStorage, loadModule: dependencies });
  workspaceStorage.setArtifactMigrator((id, destination) => artifactStore.migrateProject(id, destination));
  const workspace = path.join(directory, '工作区'); await fs.mkdir(workspace); await workspaceStorage.bindRoot({ workspaceId: 'production-workspace', name: '固定验收', directory: workspace, projects: [] });
  const calls = [];
  const modelRuntime = { supports: () => true, execute: async (input, options) => { calls.push(input); const supplied = execute ? await execute(input, options) : undefined; const text = typeof supplied === 'string' ? supplied : `# 客户成品\n${input.input}\n这是经过完整编排的本地固定验收正文。`; return { text, artifacts: [await artifactStore.write({ projectId: input.projectId, runId: input.runId, name: '正文.txt', mimeType: 'text/plain', text })], usage: { inputTokens: 100, outputTokens: 50 } }; } };
  const engineOptions = { directory, artifactStore, modelRuntime, credentials: { list: async () => [{ id: 'metadata-only', connectionId: 'connection', name: '仅凭证元数据', enabled: true }] } };
  const engine = createLiveWorkflowEngine(engineOptions), editorStore = createEditorStore({ workspaceStorage, artifactStore }), spreadsheetStore = createSpreadsheetStore({ workspaceStorage, artifactStore, loadModule: dependencies });
  return { directory, workspace, workspaceStorage, artifactStore, engine, liveEngine: engine, editorStore, spreadsheetStore, calls, loadModule: dependencies, engineOptions };
}
async function until(read, predicate) { const deadline = Date.now() + 10000; while (Date.now() < deadline) { const value = await read(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 15)); } throw new Error('Production fixture deadline exceeded'); }
module.exports = { fixture, request, word, PNG, dependencies, until };
