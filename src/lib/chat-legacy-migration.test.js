import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { createChatService, validateWorkspaceSnapshot } = require('../../electron/chat-service.cjs');
const { createChatAttachments } = require('../../electron/chat-attachments.cjs');
const { createChatAttachments: createLegacy, attachmentMetadata } = require('../../electron/chat-attachments-legacy.cjs');
const owned = [], services = [], scope = { workspaceId: 'workspace', conversationId: 'conversation' };
const hash = value => createHash('sha256').update(value).digest('hex');
const connection = { id: 'connection', name: 'Fixture', providerId: 'openai', protocol: 'openai-responses', baseUrl: 'https://api.openai.com/v1', enabled: true, status: 'configured' };
const model = { id: 'model', name: 'Fixture', modelId: 'gpt-6.1-terra', connectionId: 'connection', enabled: true, capabilities: ['text', 'vision'] };
const request = { ...scope, id: 'first', text: '读取原始资料', connection, model, credentialId: 'key' };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=', 'base64');
function serviceAt(directory, overrides = {}) {
  const calls = [], service = createChatService({ directory, credentialStore: { withSecret: async (_id, _conn, run) => run('fixture') }, execute: async (input, messages) => { calls.push({ input, messages }); return { text: '已读取', requestStarted: true, usage: { inputTokens: 1, outputTokens: 2 } }; }, ...overrides });
  services.push(service); return { service, calls };
}
async function settled(service) { for (let n = 0; n < 200; n++) { const record = await service.read(scope); if (!record.turns.some(turn => turn.status === 'running')) return record; await new Promise(resolve => setTimeout(resolve, 10)); } throw Error('not settled'); }
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-chat-migrate-')); owned.push(directory);
  const text = path.join(directory, '原稿.txt'), image = path.join(directory, '参考.png');
  await fs.writeFile(text, '保留原始中文\n第二行\n'); await fs.writeFile(image, png);
  const legacy = createLegacy({ directory }), imported = await legacy.importAttachments(scope, [text, image]), files = await legacy.resolve(scope, imported.map(file => file.id));
  const current = serviceAt(directory); await current.service.start(request); await settled(current.service); await current.service.shutdown();
  const recordFile = path.join(directory, 'chat-v1', scope.workspaceId, `${scope.conversationId}.conversation.json`), record = JSON.parse(await fs.readFile(recordFile, 'utf8'));
  record.turns[0]._attachments = files; record.turns[0].attachments = files.map(attachmentMetadata);
  await fs.writeFile(recordFile, JSON.stringify(record, null, 2) + '\n');
  const indexFile = path.join(directory, 'chat-v1', scope.workspaceId, 'index.json'), index = JSON.parse(await fs.readFile(indexFile, 'utf8'));
  index.items[0].recordHash = hash(JSON.stringify(record)); await fs.writeFile(indexFile, JSON.stringify(index, null, 2) + '\n');
  return { directory, files, imported, record, recordFile, cacheFile: path.join(directory, 'chat-attachments-v1', scope.workspaceId, `${scope.conversationId}.json`) };
}
afterEach(async () => { await Promise.all(services.splice(0).map(service => service.shutdown())); for (const directory of owned.splice(0)) { if (!path.basename(directory).startsWith('xuzuo-chat-migrate-')) throw Error('unowned fixture'); await fs.rm(directory, { recursive: true, force: true }); } });
describe('Mac旧版独立聊天附件的无损升级', () => {
  it('历史与草稿迁移保留ID、哈希与实际字节，读取不修改旧缓存、原记录或费用', async () => {
    const f = await fixture(), oldCache = await fs.readFile(f.cacheFile), oldRecord = await fs.readFile(f.recordFile), migrated = serviceAt(f.directory);
    const record = await migrated.service.read(scope); expect(record.turns[0].attachments.map(file => file.id)).toEqual(f.imported.map(file => file.id));
    expect(record.turns[0]).not.toHaveProperty('_attachments'); expect(record.turns[0].attachments.every(file => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true);
    const store = createChatAttachments({ directory: f.directory });
    for (const file of f.files) expect((await store.read(scope, file.id)).buffer).toEqual(Buffer.from(file.data, 'base64'));
    expect(await fs.readFile(f.cacheFile)).toEqual(oldCache); expect(await fs.readFile(f.recordFile)).toEqual(oldRecord); expect(migrated.calls).toHaveLength(0);
    expect((await migrated.service.ledger()).map(entry => entry.costCents)).toEqual([record.turns[0].costCents]);
  });
  it('迁移历史可以原样重试，后续材料上下文和备份恢复均保留实际图片与文字', async () => {
    const f = await fixture(), migrated = serviceAt(f.directory); await migrated.service.read(scope);
    await migrated.service.start({ ...request, id: 'retry', sourceTurnId: 'first' }); const record = await settled(migrated.service);
    expect(record.turns[1].status).toBe('complete'); expect(record.turns[1].sourceTurnId).toBe('first');
    const sent = migrated.calls[0].messages.flatMap(message => message.attachments || []); expect(sent.map(file => file.id)).toEqual(f.files.map(file => file.id));
    for (const source of f.files) expect(sent.find(file => file.id === source.id).buffer).toEqual(Buffer.from(source.data, 'base64'));
    const snapshot = await migrated.service.exportWorkspace(scope.workspaceId); expect(snapshot.attachmentFiles).toHaveLength(2);
    const target = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-chat-migrate-')); owned.push(target); const restored = serviceAt(target);
    await restored.service.restoreWorkspace(snapshot); const restoredRecord = await restored.service.read(scope); expect(restoredRecord.turns[0].attachments).toEqual(record.turns[0].attachments);
    const copied = createChatAttachments({ directory: target }); for (const source of f.files) expect((await copied.read(scope, source.id)).buffer).toEqual(Buffer.from(source.data, 'base64'));
  });
  it('旧版内嵌附件备份可直接校验并恢复，不依赖原缓存目录', async () => {
    const f = await fixture(), snapshot = validateWorkspaceSnapshot({ version: 1, workspaceId: scope.workspaceId, conversations: [f.record] });
    expect(snapshot.conversations[0].turns[0]).not.toHaveProperty('_attachments'); expect(snapshot.attachmentFiles).toHaveLength(2);
    const target = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-chat-migrate-')); owned.push(target); const restored = serviceAt(target);
    await restored.service.restoreWorkspace({ version: 1, workspaceId: scope.workspaceId, conversations: [f.record] });
    expect((await restored.service.read(scope)).turns[0].attachments).toEqual(snapshot.conversations[0].turns[0].attachments);
  });
  it('并发草稿读取与新导入串行迁移，旧缓存只读取一次且不丢新文件', async () => {
    const f = await fixture(); let oldReads = 0;
    const fileSystem = new Proxy(fs, { get: (target, key) => key === 'readFile' ? async (...args) => { if (args[0] === f.cacheFile) oldReads++; return target.readFile(...args); } : target[key] });
    const store = createChatAttachments({ directory: f.directory, fileSystem });
    await Promise.all([store.list(scope), store.list(scope), store.importBytes(scope, [{ name: '新增.txt', bytes: Buffer.from('新增资料') }])]);
    expect(await store.list(scope)).toHaveLength(3); expect(oldReads).toBe(1);
    const restarted = createChatAttachments({ directory: f.directory }); expect(await restarted.list(scope)).toHaveLength(3);
  });
  it.each(['hash', 'metadata'])('旧缓存%s损坏时拒绝迁移，原缓存与历史保持原样', async kind => {
    const f = await fixture(), cache = JSON.parse(await fs.readFile(f.cacheFile, 'utf8'));
    if (kind === 'hash') cache.files[0].data = Buffer.from('篡改').toString('base64'); else cache.files[0].mimeType = 'image/png';
    await fs.writeFile(f.cacheFile, JSON.stringify(cache)); const oldCache = await fs.readFile(f.cacheFile), oldRecord = await fs.readFile(f.recordFile);
    const migrated = serviceAt(f.directory); await expect(migrated.service.read(scope)).rejects.toThrow(/附件/);
    expect(await fs.readFile(f.cacheFile)).toEqual(oldCache); expect(await fs.readFile(f.recordFile)).toEqual(oldRecord); expect(migrated.calls).toHaveLength(0);
  });
  it('同编号同字节但不同文件名的附件不会覆盖新索引', async () => {
    const f = await fixture(), store = createChatAttachments({ directory: f.directory }), values = await store.list(scope), original = values[0];
    const changed = { ...original, name: '另一个名字.txt' }, before = await store.list(scope);
    await expect(store.restore(scope, [{ attachment: changed, buffer: Buffer.from(f.files[0].data, 'base64') }])).rejects.toThrow(/元数据/);
    expect(await store.list(scope)).toEqual(before);
  });
});
