import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url), { dependencies, until } = require('./production-test-fixtures.cjs');
const { createWorkspaceStorage } = require('../../electron/workspace-storage.cjs');
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
const { createLiveWorkflowEngine } = require('../../electron/live-workflow-engine.cjs');
const { createProjectBackup } = require('../../electron/project-backup.cjs');
const { createChatService } = require('../../electron/chat-service.cjs');
const { hash } = require('../../electron/backup-format.cjs');
const Zip = dependencies('jszip'), profiles = [], stamp = '2026-11-09T10:00:00.000Z';
const connection = { id: 'chat-connection', name: '本地验收', providerId: 'openai', protocol: 'openai-responses', baseUrl: 'https://api.openai.com/v1', enabled: true, status: 'configured' };
const model = { id: 'chat-model', name: '固定计费验收', modelId: 'gpt-6.1-terra', connectionId: connection.id, enabled: true, capabilities: ['text'], pricing: { unit: 'million-tokens', currency: 'CNY', input: '1000', output: '2000' } };
const workspaceId = 'chat-source-workspace', conversationId = 'chat-source-conversation';

async function profile({ unbound = false, legacy = false } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-chat-backup-'));
  const storage = createWorkspaceStorage({ directory }), artifacts = createArtifactStore({ directory: path.join(directory, 'artifacts-v1'), workspaceStorage: storage, loadModule: dependencies });
  storage.setArtifactMigrator((id, destination) => artifacts.migrateProject(id, destination));
  const workspace = path.join(directory, 'work'), project = { id: 'chat-source-project', workspaceId, name: '备份项目', kind: 'word', status: 'draft', description: '', updatedAt: stamp, costCents: 0, version: 0, accent: 'blue' };
  if (!unbound) { await fs.mkdir(workspace); await storage.bindRoot({ workspaceId, name: '聊天与制作', directory: workspace }); await storage.ensureProject({ projectId: project.id, workspaceId, name: project.name }); }
  const engine = createLiveWorkflowEngine({ directory, artifactStore: artifacts, credentials: {}, modelRuntime: {} });
  const calls = [], chat = createChatService({ directory, credentialStore: { withSecret: async (_id, _connection, action) => action('FIXTURE_KEY_NEVER_EXPORTED') }, execute: async (input, messages) => { calls.push({ input, messages }); return { text: `收到：${input.text}`, usage: { inputTokens: 10, outputTokens: 20 }, requestStarted: true }; } });
  const backup = createProjectBackup({ directory, workspaceStorage: storage, artifactStore: artifacts, liveEngine: engine, loadModule: dependencies, ...(legacy ? {} : { chatProvider: () => chat }) });
  const f = { directory, storage, artifacts, engine, chat, backup, calls, workspace, project, unbound }; profiles.push(f); return f;
}
afterEach(async () => {
  for (const f of profiles.splice(0).reverse()) {
    await f.backup.flush(); await f.chat.shutdown(); await f.engine.shutdown(); await f.artifacts.drain();
    const real = await fs.realpath(f.directory), temporary = await fs.realpath(os.tmpdir());
    if (path.dirname(real).toLowerCase() !== temporary.toLowerCase() || !path.basename(real).startsWith('xuzuo-chat-backup-')) throw Error('Unowned chat-backup fixture');
    await fs.rm(real, { recursive: true, force: true });
  }
});
function meta(f) {
  return { workspaces: [{ id: workspaceId, name: '聊天与制作', createdAt: stamp }], projects: f.unbound ? [] : [f.project], ledger: [], customPrompts: [], preferencesByWorkspace: {}, configuration: { version: 1, connections: [connection], models: [model], workflows: [], categories: [], studioActions: [], useTemplates: [] } };
}
async function talk(f, id = 'chat-source-turn', changes = {}) {
  await f.chat.start({ id, workspaceId, conversationId, text: '请帮我讨论产品介绍', connection, model, credentialId: 'fixture-key-id', ...changes });
  await until(() => f.chat.read({ workspaceId, conversationId }), value => !value.turns.some(turn => turn.status === 'running'));
}
async function archive(f, projectOnly = false) {
  const filePath = path.join(f.directory, `chat-backup-${projectOnly ? 'project' : 'workspace'}.zip`);
  await f.backup.exportBackup({ meta: meta(f), workspaceIds: [workspaceId], ...(projectOnly ? { projectIds: [f.project.id] } : {}), filePath });
  const zip = await Zip.loadAsync(await fs.readFile(filePath)); return { zip, filePath, manifest: JSON.parse(await zip.file('manifest.json').async('string')) };
}
async function destination(f) { const selected = path.join(f.directory, 'restore'); await fs.mkdir(selected); return selected; }
async function corruptChat(source, exported, change, suffix) {
  const relative = `chat/${workspaceId}/chat.json`, value = JSON.parse(await exported.zip.file(relative).async('string')); change(value);
  const bytes = Buffer.from(JSON.stringify(value) + '\n'), manifest = structuredClone(exported.manifest), entry = manifest.files.find(item => item.path === relative);
  Object.assign(entry, { bytes: bytes.length, sha256: hash(bytes) }); exported.zip.file(relative, bytes, { createFolders: false }); exported.zip.file('manifest.json', JSON.stringify(manifest) + '\n', { createFolders: false });
  const filePath = path.join(source.directory, `invalid-chat-${suffix}.zip`); await fs.writeFile(filePath, await exported.zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })); return filePath;
}

describe('完整工作区备份包含独立聊天和真实费用', () => {
  it('聊天、重试与人工费用校正完整恢复，新工作区重绑身份而冻结原计费快照，不重复调用', async () => {
    const source = await profile(); await talk(source); await talk(source, 'chat-retry-turn', { sourceTurnId: 'chat-source-turn' });
    const before = await source.chat.ledger(workspaceId); await source.chat.reconcile({ entryId: before[0].id, costCents: 9 });
    const original = await source.chat.exportWorkspace(workspaceId), exported = await archive(source);
    expect(exported.manifest.chatWorkspaces).toEqual([workspaceId]); expect(exported.zip.file(`chat/${workspaceId}/chat.json`)).not.toBeNull();
    expect(await exported.zip.file(`chat/${workspaceId}/chat.json`).async('string')).not.toContain('credentialId');
    expect(JSON.stringify(exported.manifest)).not.toContain('FIXTURE_KEY_NEVER_EXPORTED');
    const target = await profile(), location = await destination(target), imported = await target.backup.importBackup({ filePath: exported.filePath, directory: location });
    const restoredWorkspace = imported.idMap[workspaceId], restoredConversation = imported.idMap[conversationId], result = await target.chat.read({ workspaceId: restoredWorkspace, conversationId: restoredConversation });
    expect(restoredWorkspace).not.toBe(workspaceId); expect(restoredConversation).not.toBe(conversationId); expect(result.turns).toHaveLength(2); expect(result.turns.every(turn => turn.status === 'complete')).toBe(true);
    expect(result.turns[1].sourceTurnId).toBe(imported.idMap['chat-source-turn']);
    const restored = await target.chat.exportWorkspace(restoredWorkspace);
    expect(restored.conversations[0].turns.map(turn => turn._billing)).toEqual(original.conversations[0].turns.map(turn => turn._billing));
    expect((await target.chat.ledger(restoredWorkspace)).reduce((sum, entry) => sum + entry.costCents, 0)).toBe(14);
    expect(imported.meta.ledger).toEqual([]); expect(target.calls).toHaveLength(0);
    const info = await target.backup.inspectBackup(exported.filePath); expect(info.chatConversations).toBe(1);
    const restoredRoot = (await target.storage.list()).workspaces.find(item => item.workspaceId === restoredWorkspace).directory;
    expect(await fs.readdir(restoredRoot)).not.toContain('chat'); expect(await fs.stat(path.join(target.directory, 'chat-v1', restoredWorkspace, `${restoredConversation}.conversation.json`))).toBeTruthy();
    const [entry] = await target.chat.ledger(restoredWorkspace); await target.chat.reconcile({ entryId: entry.id, costCents: 21 });
    const after = await target.chat.ledger(restoredWorkspace); await target.backup.importBackup({ filePath: exported.filePath, directory: location });
    expect(await target.chat.ledger(restoredWorkspace)).toEqual(after); expect((await target.chat.list(restoredWorkspace))).toHaveLength(1); expect(target.calls).toHaveLength(0);
  }, 20000);
  it('只聊天且没有绑定项目目录的工作区也能备份，不要求先建项目', async () => {
    const source = await profile({ unbound: true }); await talk(source); expect((await source.storage.list()).workspaces).toHaveLength(0);
    const exported = await archive(source); expect(exported.manifest.locations.projects).toEqual([]); expect((await source.storage.list()).workspaces).toHaveLength(0);
    const target = await profile(), imported = await target.backup.importBackup({ filePath: exported.filePath, directory: await destination(target) });
    expect(imported.meta.projects).toEqual([]); expect((await target.chat.ledger(imported.idMap[workspaceId]))[0].costCents).toBe(5); expect((await target.chat.list(imported.idMap[workspaceId]))).toHaveLength(1); expect(target.calls).toHaveLength(0);
  });
  it('按项目备份不混入整段聊天，旧版无聊天模块仍可导入此类备份', async () => {
    const source = await profile(); await talk(source); const spy = vi.spyOn(source.chat, 'exportWorkspace'), exported = await archive(source, true);
    expect(spy).not.toHaveBeenCalled(); expect(exported.manifest.chatWorkspaces).toBeUndefined(); expect(Object.keys(exported.zip.files).some(name => name.startsWith('chat/'))).toBe(false);
    const target = await profile({ legacy: true }), imported = await target.backup.importBackup({ filePath: exported.filePath, directory: await destination(target) });
    expect(imported.meta.projects).toHaveLength(1); expect(await target.chat.ledger()).toEqual([]);
  });
  it.each(['scope', 'negative-cost', 'duplicate', 'secret'])('外层哈希有效但聊天%s无效时在写入项目目录前拒绝，原数据保留', async kind => {
    const source = await profile(); await talk(source); const exported = await archive(source);
    const filePath = await corruptChat(source, exported, value => { if (kind === 'scope') value.workspaceId = 'foreign-workspace'; else if (kind === 'negative-cost') value.conversations[0].turns[0].costCents = -1; else if (kind === 'duplicate') value.conversations.push(structuredClone(value.conversations[0])); else value.conversations[0].turns[0]._billing.headers = { authorization: 'NOT_A_REAL_KEY' }; }, kind);
    const target = await profile(), before = await target.storage.list(), location = await destination(target);
    await expect(target.backup.importBackup({ filePath, directory: location })).rejects.toThrow(/聊天备份/);
    expect(await fs.readdir(location)).toEqual([]); expect(await target.storage.list()).toEqual(before); expect(await target.chat.ledger()).toEqual([]); expect(target.calls).toHaveLength(0);
  });
  it('缺少恢复模块不能忽略聊天文件并假报完整备份恢复', async () => {
    const source = await profile(); await talk(source); const exported = await archive(source), target = await profile({ legacy: true }), location = await destination(target);
    await expect(target.backup.importBackup({ filePath: exported.filePath, directory: location })).rejects.toThrow('聊天恢复模块'); expect(await fs.readdir(location)).toEqual([]);
  });
});
