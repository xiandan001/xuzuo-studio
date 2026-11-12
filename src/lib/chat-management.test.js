import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
const load = createRequire(import.meta.url), { createChatService, entriesFor, validateWorkspaceSnapshot, contextMessages } = load('../../electron/chat-service.cjs'), { remapChatBackups } = load('../../electron/chat-backup.cjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const profiles = [], services = [];
const connection = { id: 'connection', providerId: 'openai', protocol: 'openai-responses', baseUrl: 'https://api.openai.com/v1', enabled: true };
const model = { id: 'model', name: '固定模型', modelId: 'gpt-6.1-terra', connectionId: connection.id, enabled: true, capabilities: ['text', 'vision'], pricing: { unit: 'million-tokens', currency: 'CNY', input: '1000', output: '2000' } };
const base = { id: 'turn-first', workspaceId: 'workspace', conversationId: 'conversation', text: '请讨论海报内容', connection, model, credentialId: 'credential' };
const result = { text: '这是一份客户校样说明，含独特码 ACORN-9281。', usage: { inputTokens: 10, outputTokens: 20 }, requestStarted: true };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
async function fixture(options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-chat-manage-')); profiles.push(directory); const events = [], calls = [];
  const service = createChatService({ directory, credentialStore: { withSecret: (_id, _connection, callback) => callback('test-only') }, execute: async (input, messages) => { calls.push({ input, messages }); return structuredClone(result); }, onChanged: event => events.push(event), ...options }); services.push(service);
  return { directory, service, events, calls };
}
async function done(service, input = base) { for (let n = 0; n < 200; n++) { const value = await service.read(input); if (!value.turns.some(turn => turn.status === 'running') && service.status().running === 0) return value; await new Promise(resolve => setTimeout(resolve, 5)); } throw Error('Fixture did not complete'); }
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(services.splice(0).map(service => service.shutdown())); for (const directory of profiles.splice(0)) { if (!directory.startsWith(path.join(os.tmpdir(), 'xuzuo-chat-manage-'))) throw Error('Unexpected fixture cleanup'); await fs.rm(directory, { recursive: true, force: true }); } });
describe('聊天历史整理和材料入口', () => {
  it('全文搜索、重命名、置顶、归档、回收与恢复不丢实际费用', async () => {
    const f = await fixture(); await f.service.start(base); await done(f.service); const original = await f.service.ledger(base.workspaceId);
    const found = await f.service.search({ workspaceId: base.workspaceId, query: 'ACORN-9281' }); expect(found.items[0].id).toBe(base.conversationId); expect(found.items[0].matchSnippet).toContain('ACORN-9281');
    for (const [action, extra] of [['rename', { title: '客户甲 · 海报' }], ['pin', {}], ['archive', {}], ['trash', {}], ['restore', {}]]) await f.service.manage({ ...base, action, ...extra });
    const current = await f.service.read(base); expect(current).toMatchObject({ title: '客户甲 · 海报', pinned: true }); expect(current.trashedAt).toBeUndefined(); expect(current.archivedAt).toBeUndefined();
    expect((await f.service.ledger(base.workspaceId)).map(entry => [entry.id, entry.costCents, entry.calculation])).toEqual(original.map(entry => [entry.id, entry.costCents, entry.calculation])); expect(f.calls).toHaveLength(1);
    await f.service.manage({ ...base, action: 'trash' }); await expect(f.service.start({ ...base, id: 'blocked' })).rejects.toThrow(/回收站/); expect((await f.service.search({ workspaceId: base.workspaceId, scope: 'trash' })).items).toHaveLength(1);
  });
  it('超过200段仍可恢复和分页查找，正文搜索分批且缓存有界', async () => {
    const f = await fixture(); const stamp = new Date().toISOString();
    const conversations = Array.from({ length: 205 }, (_, n) => ({ version: 1, id: `record-${String(n).padStart(3, '0')}`, workspaceId: 'bulk', title: n === 204 ? '搜索末尾目标' : `普通记录 ${n}`, turns: [], createdAt: stamp, updatedAt: stamp }));
    expect(validateWorkspaceSnapshot({ version: 1, workspaceId: 'bulk', conversations }).conversations).toHaveLength(205);
    const folder = path.join(f.directory, 'chat-v1', 'bulk'); await fs.mkdir(folder, { recursive: true }); const summaries = [];
    for (let offset = 0; offset < conversations.length; offset += 8) await Promise.all(conversations.slice(offset, offset + 8).map(async record => {
      const fees = { version: 1, workspaceId: 'bulk', conversationId: record.id, entries: [] }, ledgerKey = hash(JSON.stringify(fees)), feesFolder = path.join(folder, 'fees', record.id);
      await fs.mkdir(feesFolder, { recursive: true }); await fs.writeFile(path.join(feesFolder, ledgerKey + '.json'), JSON.stringify(fees)); await fs.writeFile(path.join(folder, record.id + '.conversation.json'), JSON.stringify(record));
      summaries.push({ id: record.id, workspaceId: record.workspaceId, title: record.title, createdAt: stamp, updatedAt: stamp, turnCount: 0, ledgerKey, recordHash: hash(JSON.stringify(record)) });
    }));
    await fs.writeFile(path.join(folder, 'index.json'), JSON.stringify({ version: 2, workspaceId: 'bulk', revision: 1, items: summaries }));
    const first = await f.service.search({ workspaceId: 'bulk', limit: 30 }); expect(first.items).toHaveLength(30); expect(first.total).toBe(205); expect(first.nextCursor).toBe(30);
    let page = await f.service.search({ workspaceId: 'bulk', query: '搜索末尾目标' }); expect(page.scanned).toBeLessThanOrEqual(100); expect(page.items).toHaveLength(0);
    page = await f.service.search({ workspaceId: 'bulk', query: '搜索末尾目标', cursor: page.nextCursor });
    page = await f.service.search({ workspaceId: 'bulk', query: '搜索末尾目标', cursor: page.nextCursor }); expect(page.items[0].id).toBe('record-204'); expect(f.service.status().cachedCount).toBeLessThanOrEqual(12); expect(f.calls).toHaveLength(0);
    await f.service.manage({ workspaceId: 'bulk', conversationId: 'record-000', action: 'archive' }); await f.service.manage({ workspaceId: 'bulk', conversationId: 'record-001', action: 'trash' });
    const next = { ...base, workspaceId: 'bulk', conversationId: 'new-after-200' }; await f.service.start(next); await done(f.service, next); expect((await f.service.search({ workspaceId: 'bulk' })).total).toBe(204); expect(f.calls).toHaveLength(1);
    const index = JSON.parse(await fs.readFile(path.join(f.directory, 'chat-v1', 'bulk', 'index.json'), 'utf8')); expect(index.version).toBe(2); expect(index.items.every(item => !item.ledger && item.ledgerKey)).toBe(true);
  });
  it('旧版嵌入账本超过小容量阈值仍能整理，并迁移为轻索引后继续聊天', async () => {
    const f = await fixture(); await f.service.start(base); await done(f.service); const saved = (await f.service.exportWorkspace(base.workspaceId)).conversations[0]; await f.service.shutdown();
    const records = Array.from({ length: 4 }, (_, n) => ({ ...structuredClone(saved), id: n ? `legacy-${n}` : saved.id }));
    const root = path.join(f.directory, 'chat-v1', base.workspaceId), legacy = { version: 1, workspaceId: base.workspaceId, revision: 2, items: records.map(record => ({ id: record.id, workspaceId: record.workspaceId, title: record.title, createdAt: record.createdAt, updatedAt: record.updatedAt, turnCount: record.turns.length, ledger: entriesFor(record) })) };
    for (const record of records) await fs.writeFile(path.join(root, `${record.id}.conversation.json`), JSON.stringify(record));
    const legacyBytes = Buffer.byteLength(JSON.stringify(legacy, null, 2) + '\n'); await fs.writeFile(path.join(root, 'index.json'), JSON.stringify(legacy));
    const reopened = createChatService({ directory: f.directory, credentialStore: { withSecret: (_id, _connection, callback) => callback('test-only') }, execute: async () => structuredClone(result), indexLimitBytes: legacyBytes - 1 }); services.push(reopened);
    const before = await reopened.ledger(base.workspaceId); await reopened.manage({ ...base, action: 'archive' });
    const index = JSON.parse(await fs.readFile(path.join(root, 'index.json'), 'utf8')); expect(index.version).toBe(2); expect(Buffer.byteLength(JSON.stringify(index, null, 2) + '\n')).toBeLessThan(legacyBytes / 2); expect(index.items.every(info => info.ledger === undefined && info.ledgerKey)).toBe(true);
    expect(await reopened.ledger(base.workspaceId)).toEqual(before); const next = { ...base, conversationId: 'after-migration', id: 'after-migration-turn' }; await reopened.start(next); await done(reopened, next); expect(await reopened.ledger(base.workspaceId)).toHaveLength(5);
  });
  it('终态索引提交前崩溃并丢失正文时，journal仍恢复实际费用且允许整理', async () => {
    let writes = 0; const f = await fixture({ fileSystem: { ...fs, rename: async (from, to) => { if (to.endsWith('.conversation.json')) writes++; if (to.endsWith('index.json') && writes >= 2) { const error = Error('fixture index failure'); error.code = 'EIO'; throw error; } return fs.rename(from, to); } } });
    await f.service.start(base); await done(f.service); const before = await f.service.ledger(base.workspaceId); expect(f.service.status().unsaved).toBe(1); services.splice(services.indexOf(f.service), 1);
    await fs.unlink(path.join(f.directory, 'chat-v1', base.workspaceId, `${base.conversationId}.conversation.json`));
    const reopened = createChatService({ directory: f.directory, credentialStore: { withSecret() {} } }); services.push(reopened);
    expect(await reopened.ledger(base.workspaceId)).toEqual(before); await reopened.manage({ ...base, action: 'trash' }); expect((await reopened.search({ workspaceId: base.workspaceId, scope: 'trash' })).items[0].id).toBe(base.conversationId); expect(await reopened.ledger(base.workspaceId)).toEqual(before);
  });
  it('原会话源文件被外部删掉时仍可回收索引，旧账本不被空会话覆盖', async () => {
    const f = await fixture(); await f.service.start(base); await done(f.service); const original = await f.service.ledger(base.workspaceId); await f.service.shutdown();
    await fs.unlink(path.join(f.directory, 'chat-v1', base.workspaceId, `${base.conversationId}.conversation.json`));
    const reopened = createChatService({ directory: f.directory, credentialStore: { withSecret() {} } }); services.push(reopened);
    const moved = await reopened.manage({ ...base, action: 'trash' }); expect(moved.unavailableReason).toContain('丢失'); expect((await reopened.search({ workspaceId: base.workspaceId, scope: 'trash' })).items[0].id).toBe(base.conversationId); expect(await reopened.ledger(base.workspaceId)).toEqual(original);
  });
  it('粘贴字节、内置素材和项目成品按真实字节导入，许可信息可随备份保留', async () => {
    const provenance = { builtinId: 'builtin-picture', packId: 'pack', origin: 'open-source', author: 'Example author', licenseId: 'CC0', licenseName: 'CC0', licenseUrl: 'https://example.com/license', sourceUrl: 'https://example.com/source', usageNote: '可使用', licenseNotice: '原作者许可说明' };
    const assetRead = vi.fn(async () => ({ name: '纹理', mimeType: 'image/png', buffer: png, provenance }));
    const artifactRead = vi.fn(async input => ({ id: input.artifactId, projectId: input.projectId, name: 'output.png', mimeType: 'image/png', bytes: png.length, buffer: png, kind: 'image', createdAt: new Date().toISOString() }));
    const f = await fixture({ readAsset: assetRead, readArtifact: artifactRead });
    const pasted = await f.service.importBytes({ ...base, files: [{ name: '截图.png', mimeType: 'image/png', bytes: new Uint8Array(png) }] }); expect(pasted[0].sha256).toBe(hash(png));
    const assets = await f.service.importAsset({ ...base, assetId: 'builtin-picture', builtin: true }); expect(assets[0].name).toBe('纹理.png'); expect(assets[0].provenance).toEqual(provenance); expect(assetRead).toHaveBeenCalledWith({ workspaceId: base.workspaceId, assetId: 'builtin-picture', builtin: true });
    const artifact = await f.service.importProjectArtifact({ ...base, projectId: 'project', artifactId: 'output' }); expect(artifact[0].sha256).toBe(hash(png));
    await f.service.start({ ...base, attachmentIds: [assets[0].id] }); await done(f.service); expect(f.calls[0].messages[0].attachments[0].buffer).toEqual(png);
    const backup = await f.service.exportWorkspace(base.workspaceId); expect(backup.attachmentFiles.find(file => file.attachment.id === assets[0].id).attachment.provenance).toEqual(provenance); expect(backup.conversations[0].turns[0].attachments[0].provenance).toEqual(provenance);
  });
  it('虚假MIME、跨项目原文件和变化目标在发送前拒绝，不产生费用', async () => {
    const f = await fixture({ readArtifact: async () => ({ id: 'other', projectId: 'another', mimeType: 'image/png', buffer: png }) });
    await expect(f.service.importBytes({ ...base, files: [{ name: 'picture.png', mimeType: 'text/plain', bytes: png }] })).rejects.toThrow(/格式/);
    await expect(f.service.importProjectArtifact({ ...base, projectId: 'project', artifactId: 'target' })).rejects.toThrow(/不可用/);
    await expect(f.service.start({ ...base, target: { projectId: 'project', artifactId: 'target', kind: 'image', sha256: hash(png) } })).rejects.toThrow(/不可用/); expect(f.calls).toHaveLength(0); expect(await f.service.ledger()).toHaveLength(0);
  });
  it('初选成品由后台计算哈希，后续不静默切到已变化的成品', async () => {
    let buffer = png; const f = await fixture({ readArtifact: async input => ({ id: input.artifactId, projectId: input.projectId, name: 'selected.png', mimeType: 'image/png', buffer, bytes: buffer.length, kind: 'image' }) });
    const selected = await f.service.selectTarget({ workspaceId: base.workspaceId, projectId: 'project', artifactId: 'selected', kind: 'image' }); expect(selected.target).toEqual({ projectId: 'project', artifactId: 'selected', kind: 'image', sha256: hash(png) }); expect(selected.inspection.artifact.bytes).toBe(png.length);
    buffer = Buffer.concat([png, Buffer.from('changed')]); await expect(f.service.start({ ...base, target: selected.target })).rejects.toThrow(/文件已变化/); expect(f.calls).toHaveLength(0); expect(await f.service.ledger()).toHaveLength(0);
  });
  it('制作关联按runId幂等，只引用真实锁定目标而不复制工作流费用', async () => {
    const target = { projectId: 'project', artifactId: 'source', kind: 'image', sha256: hash(png) }, run = { id: 'run', projectId: 'project', workspaceId: base.workspaceId, mode: 'live', snapshot: { steps: [{ enabled: true, referenceArtifactIds: ['source'] }] } };
    const f = await fixture({ readRun: vi.fn(async () => structuredClone(run)), readArtifact: async input => ({ id: input.artifactId, projectId: input.projectId, mimeType: 'image/png', buffer: png, bytes: png.length, name: 'source.png', kind: 'image' }) });
    const linked = await f.service.linkProduction({ ...base, target, runId: run.id, instruction: '把背景换为浅灰' }); expect(linked.productions).toHaveLength(1); expect(linked.title).toContain('浅灰');
    const context = contextMessages({ ...linked, turns: [] }, { text: '刚才提交了什么？' }); expect(context.messages[0].content).toContain('已提交制作'); expect(context.messages[0].content).toContain('完成状态请查看任务卡'); expect(context.messages[0].content).toContain('把背景换为浅灰'); expect(context.messages[0].content).toContain('刚才提交了什么'); expect(context.messages[0].content).not.toContain('已生成');
    expect((await f.service.linkProduction({ ...base, target, runId: run.id, instruction: '把背景换为浅灰' })).productions).toHaveLength(1); expect(await f.service.ledger()).toHaveLength(0); expect(f.calls).toHaveLength(0);
    const ids = { workspace: 'restored-workspace', conversation: 'restored-conversation', project: 'restored-project', source: 'restored-source', run: 'restored-run' };
    const remapped = remapChatBackups([await f.service.exportWorkspace(base.workspaceId)], ids, 'backup'); expect(remapped[0].conversations[0].productions[0]).toMatchObject({ runId: 'restored-run', target: { projectId: 'restored-project', artifactId: 'restored-source' } });
    run.id = 'bad-run'; run.snapshot.steps[0].referenceArtifactIds = ['different']; await expect(f.service.linkProduction({ ...base, target, runId: 'bad-run', instruction: '新要求' })).rejects.toThrow(/没有绑定/);
  });
  it('长回复流式传新增字而非每次克隆完整正文，终态完整且费用通知不增加', async () => {
    let clock = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const text = '长内容'.repeat(12000);
    const f = await fixture({ execute: async (_input, _messages, control) => { for (let index = 1; index <= 40; index++) { clock += 101; control.onText(text.slice(0, Math.ceil(text.length * index / 40))); } return { ...result, text }; } });
    await f.service.start(base); const value = await done(f.service); await vi.waitFor(() => expect(f.events.some(event => event.ledgerChanged && event.turn?.status === 'complete')).toBe(true));
    const deltas = f.events.filter(event => event.stream); expect(deltas).toHaveLength(40); expect(deltas.every(event => !event.turn)).toBe(true); expect(deltas.map(event => event.stream.textDelta).join('')).toBe(text); expect(deltas.map(event => event.stream.sequence)).toEqual(Array.from({ length: 40 }, (_, index) => index + 1));
    expect(value.turns[0].text).toBe(text); expect(value.turns[0].streamSequence).toBe(40); expect(f.events.filter(event => event.ledgerChanged)).toHaveLength(2);
  });
});
