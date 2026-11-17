const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { fixture, request, PNG, dependencies, until } = require('./production-test-fixtures.cjs');
const { createProjectBackup } = require('../../electron/project-backup.cjs');
const { createProjectTemplates } = require('../../electron/project-templates.cjs');
const { createChatService } = require('../../electron/chat-service.cjs');

const workspaceId = 'production-workspace', projectId = 'template-project', ownerId = 'incremental-fixture-owner', stamp = '2026-11-17T00:00:00.000Z';
const connection = { id: 'chat-connection', name: 'Synthetic offline only', providerId: 'custom', protocol: 'openai-chat', baseUrl: 'https://synthetic.invalid/v1', enabled: true };
const model = { id: 'chat-model', name: 'Synthetic pricing', modelId: 'synthetic-chat', connectionId: connection.id, capabilities: ['text', 'vision'], enabled: true, pricing: { unit: 'request', currency: 'CNY', input: '0', output: '0.05' } };
async function profile() {
  const f = await fixture();
  const location = await f.workspaceStorage.ensureProject({ projectId, workspaceId, name: 'Synthetic 备份项目' });
  const project = { ...request().project, directory: location.directory, name: 'Synthetic 备份项目', updatedAt: stamp };
  const calls = [], chat = createChatService({ directory: f.directory, credentialStore: { withSecret: async (_id, _connection, action) => action('SYNTHETIC_BACKUP_SECRET_NOT_FOR_EXPORT') }, execute: async input => { calls.push(input); return { text: 'Synthetic offline reply', usage: { inputTokens: 10, outputTokens: 20 }, requestStarted: true }; } });
  const templates = createProjectTemplates({ directory: f.directory, workspaceStorage: f.workspaceStorage, artifactStore: f.artifactStore, editorStore: f.editorStore, spreadsheetStore: f.spreadsheetStore, loadModule: dependencies });
  const backup = createProjectBackup({ directory: f.directory, workspaceStorage: f.workspaceStorage, artifactStore: f.artifactStore, liveEngine: f.engine, chatProvider: chat, templateProvider: templates, loadModule: dependencies });
  return Object.assign(f, { project, chat, templates, backup, chatCalls: calls });
}
function meta(f) {
  return { activeWorkspaceId: workspaceId, workspaces: [{ id: workspaceId, name: 'Synthetic 工作区', directory: f.workspace, createdAt: stamp }], projects: [f.project], ledger: f.fee ? [f.fee] : [], customPrompts: [], preferencesByWorkspace: {}, configuration: { version: 1, connections: [{ ...connection, apiKey: 'SYNTHETIC_METADATA_KEY_NOT_FOR_EXPORT' }], models: [model], workflows: [], categories: [], studioActions: [], useTemplates: [] } };
}
async function repository(f) { const target = path.join(f.directory, 'backup-target'); await fs.mkdir(target); return (await f.backup.createSnapshotRepository({ directory: target, ownerId, workspaceId })).directory; }
async function destination(f) { const target = path.join(f.directory, 'restore-target'); await fs.mkdir(target); return target; }
async function addHistory(f) {
  const artifact = await f.artifactStore.write({ projectId, runId: 'synthetic-history', name: '历史正文.txt', mimeType: 'text/plain', text: 'Synthetic historical output, no request executed' });
  const workflow = { ...request().workflow, steps: request().workflow.steps.slice(0, 1) }, fee = { id: 'synthetic-history-fee', projectId, projectName: f.project.name, workflowRunId: 'synthetic-history', workflowAttemptId: 'synthetic-attempt', workflowStepId: 'text', action: '历史调用', model: 'Synthetic historical accounting', costCents: 17, costState: 'manual', billingMode: 'live', time: stamp, status: 'complete', quantity: 1, calculation: { completeness: 'complete', nativeCurrency: 'CNY', nativeAmount: '0.17', cnyAmount: '0.17' } };
  const run = { id: 'synthetic-history', mode: 'live', workspaceId, projectId, workflowId: workflow.id, workflowName: workflow.name, snapshot: workflow, status: 'complete', stepIndex: 1, variables: {}, input: 'Synthetic historical input', createdAt: stamp, updatedAt: stamp, attempts: [{ id: 'synthetic-attempt', stepId: 'text', stepName: '正文', modelLabel: fee.model, action: fee.action, status: 'complete', costCents: fee.costCents, costState: fee.costState, calculation: fee.calculation, summary: 'Synthetic persisted history', artifacts: [artifact], input: '', prompt: '', startedAt: stamp }] };
  await f.engine.importRecords([{ run, request: { ...request(), project: f.project, workflow, connections: [], models: [] }, ledger: [fee], legacyBaseCostCents: 0 }]);
  f.project.costCents = 17; f.fee = fee; return { artifact, fee, run };
}
async function addMaterials(f, { chatText = 'Synthetic inspect only' } = {}) {
  const image = await f.artifactStore.write({ projectId, name: '真实参考图.png', mimeType: 'image/png', buffer: PNG });
  const saved = await f.templates.save({ workspaceId, sourceProjectId: projectId, sourceArtifactId: image.id, kind: 'image', name: 'Synthetic 可复用图片模板', retain: { content: false, assets: true, workflow: false, formulas: false } });
  const filename = path.join(f.directory, '聊天附件.png'); await fs.writeFile(filename, PNG);
  const [attachment] = await f.chat.importAttachments({ workspaceId, conversationId: 'source-chat', paths: [filename] });
  await f.chat.start({ id: 'source-turn', workspaceId, conversationId: 'source-chat', text: chatText, connection, model, credentialId: 'synthetic-key', attachmentIds: [attachment.id] });
  await until(() => f.chat.read({ workspaceId, conversationId: 'source-chat' }), value => value.turns.length === 1 && value.turns[0].status === 'complete');
  return { image, template: saved, attachment };
}
async function patternFile(filename, bytes, seed) {
  const handle = await fs.open(filename, 'wx'), chunk = Buffer.alloc(256 * 1024), hash = createHash('sha256');
  try { for (let offset = 0; offset < bytes; offset += chunk.length) { chunk.fill((seed + offset / chunk.length) % 251); chunk.writeUInt32LE(seed * 10000 + offset / chunk.length); const piece = chunk.subarray(0, Math.min(chunk.length, bytes - offset)); await handle.writeFile(piece); hash.update(piece); } await handle.sync(); }
  finally { await handle.close(); }
  return { bytes, sha256: hash.digest('hex') };
}
async function close(f) { f.backup.cancelSnapshots(); await f.backup.flush(); await f.chat.shutdown(); await f.engine.shutdown(); await f.templates.drain(); await Promise.all([f.artifactStore.drain(), f.editorStore.drain(), f.spreadsheetStore.drain()]); }
module.exports = { profile, meta, repository, destination, addHistory, addMaterials, patternFile, close, workspaceId, projectId, ownerId, PNG };
