import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { afterEach, expect, it } from 'vitest';
const load = createRequire(import.meta.url), { createChatService } = load('../../electron/chat-service.cjs');
const profiles = [], services = [], workspaceId = 'workspace', credentialStore = { withSecret: (_id, _connection, action) => action('NON_ACCOUNT_FIXTURE_VALUE') };
const connection = { id: 'connection', providerId: 'openai', protocol: 'openai-responses', baseUrl: 'https://api.openai.com/v1', enabled: true };
const model = { id: 'model', name: '正文预算验收', modelId: 'gpt-6.1-terra', connectionId: connection.id, enabled: true, capabilities: ['text'], pricing: { unit: 'million-tokens', currency: 'CNY', input: '1000', output: '2000' } };
const base = { workspaceId, id: 'turn', conversationId: 'conversation', text: '只用于本地文件捕获验收', connection, model, credentialId: 'metadata-only' };
const sha = buffer => createHash('sha256').update(buffer).digest('hex');
async function setup() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-chat-source-budget-')); profiles.push(directory); let calls = 0;
  const service = createChatService({ directory, credentialStore, execute: async () => { calls++; return { text: '已保存的真实测试正文。'.repeat(500), usage: { inputTokens: 10, outputTokens: 20 }, requestStarted: true }; } }); services.push(service);
  async function talk(conversationId, extra = {}) {
    const input = { ...base, conversationId, ...extra }; await service.start(input);
    const end = Date.now() + 4000; while (Date.now() < end) { const value = await service.read(input); if (value.turns.at(-1)?.status === 'complete' && !service.status().running) return; await new Promise(resolve => setTimeout(resolve, 5)); }
    throw Error('Source fixture did not settle');
  }
  return { directory, service, talk, calls: () => calls };
}
afterEach(async () => {
  for (const service of services.splice(0).reverse()) await service.shutdown();
  for (const directory of profiles.splice(0)) { const real = await fs.realpath(directory); expect(path.dirname(real)).toBe(await fs.realpath(os.tmpdir())); expect(path.basename(real)).toMatch(/^xuzuo-chat-source-budget-/); await fs.rm(real, { recursive: true, force: true }); }
});
it('小的元数据预算在读取下一段正文前失败，不构造所有聊天，不改原文件或历史费用', async () => {
  const f = await setup(); for (const conversationId of ['first', 'second', 'third']) await f.talk(conversationId); await f.service.shutdown();
  const fees = await f.service.ledger(), folder = path.join(f.directory, 'chat-v1', workspaceId), index = JSON.parse(await fs.readFile(path.join(folder, 'index.json'), 'utf8')), names = index.items.map(item => item.id + '.conversation.json'), before = await Promise.all(names.map(async name => sha(await fs.readFile(path.join(folder, name)))));
  const firstSize = (await fs.stat(path.join(folder, names[0]))).size, loaded = [];
  const observer = { ...fs, readFile: async (filename, ...args) => { if (String(filename).endsWith('.conversation.json')) loaded.push(path.basename(filename)); return fs.readFile(filename, ...args); } };
  const capturing = createChatService({ directory: f.directory, credentialStore, fileSystem: observer, execute: async () => { throw Error('Backup must not call a model'); } }); services.push(capturing);
  await expect(capturing.exportWorkspaceSources(workspaceId, { metadataLimitBytes: firstSize + 1024 })).rejects.toMatchObject({ code: 'CHAT_BACKUP_CAPTURE_LIMIT', message: expect.stringContaining('本次快照未完成') });
  expect(loaded).toEqual([names[0]]); expect(await capturing.ledger()).toEqual(fees); expect(loaded).toEqual([names[0]]);
  expect(await Promise.all(names.map(async name => sha(await fs.readFile(path.join(folder, name)))))).toEqual(before); expect(f.calls()).toBe(3);
  await expect(capturing.exportWorkspaceSources(workspaceId, { metadataLimitBytes: 0 })).rejects.toMatchObject({ code: 'CHAT_BACKUP_CAPTURE_LIMIT' }); expect(loaded).toEqual([names[0]]);
  const stopped = new AbortController(); stopped.abort();
  await expect(capturing.exportWorkspaceSources(workspaceId, { signal: stopped.signal })).rejects.toMatchObject({ name: 'AbortError' }); expect(loaded).toEqual([names[0]]);
}, 10000);
it('同段聊天的多个Sources附件只读取一次受管索引，返回真实引用而不聚合附件Buffer', async () => {
  const f = await setup(), files = await f.service.importBytes({ ...base, files: [{ name: '材料A.txt', mimeType: 'text/plain', bytes: Buffer.from('实际来源甲') }, { name: '材料B.txt', mimeType: 'text/plain', bytes: Buffer.from('实际来源乙') }] });
  await f.talk(base.conversationId, { attachmentIds: files.map(file => file.id) }); await f.service.shutdown(); let indexReads = 0;
  const observer = { ...fs, readFile: async (filename, ...args) => { const name = String(filename).replaceAll('\\', '/'); if (name.includes('/attachments/') && name.endsWith('/index.json')) indexReads++; return fs.readFile(filename, ...args); } };
  const capturing = createChatService({ directory: f.directory, credentialStore, fileSystem: observer }); services.push(capturing);
  const snapshot = await capturing.exportWorkspaceSources(workspaceId); expect(snapshot.conversations).toHaveLength(1); expect(snapshot.attachmentFiles).toHaveLength(2); expect(indexReads).toBe(1); expect(snapshot.attachmentFiles.every(file => !Object.hasOwn(file, 'buffer'))).toBe(true);
  for (const source of snapshot.attachmentFiles) { const buffer = await fs.readFile(source.source.path); expect(buffer.length).toBe(source.source.bytes); expect(sha(buffer)).toBe(source.source.sha256); expect(source.attachment).toEqual(files.find(file => file.id === source.attachment.id)); }
  expect(f.calls()).toBe(1);
}, 10000);

it('冷启动的待发队列也先受预算约束，捕获不先恢复全部正文或改写原记录', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-chat-source-budget-')); profiles.push(directory);
  const original = createChatService({ directory, credentialStore, execute: (_input, _messages, control) => new Promise((_resolve, reject) => { control.signal.addEventListener('abort', () => reject(Object.assign(Error('Offline fixture stopped'), { requestStarted: true })), { once: true }); }) }); services.push(original);
  await original.start({ ...base, id: 'held' }); await original.enqueue({ ...base, id: 'later', text: '保留为待发的要求' });
  await original.manageQueue({ ...base, id: 'later', action: 'pause' }); await original.shutdown();
  const file = path.join(directory, 'chat-v1', workspaceId, base.conversationId + '.conversation.json'), before = sha(await fs.readFile(file)); let reads = 0;
  const observer = { ...fs, readFile: async (filename, ...args) => { if (String(filename).endsWith('.conversation.json')) reads++; return fs.readFile(filename, ...args); } };
  const capturing = createChatService({ directory, credentialStore, fileSystem: observer }); services.push(capturing);
  for (const metadataLimitBytes of [0, 1000]) await expect(capturing.exportWorkspaceSources(workspaceId, { metadataLimitBytes })).rejects.toMatchObject({ code: 'CHAT_BACKUP_CAPTURE_LIMIT' });
  expect(reads).toBe(0); expect(sha(await fs.readFile(file))).toBe(before);
  const value = await capturing.exportWorkspaceSources(workspaceId); expect(value.conversations[0].queue[0]._request.text).toBe('保留为待发的要求'); expect(reads).toBe(1); expect(sha(await fs.readFile(file))).toBe(before);
}, 10000);
