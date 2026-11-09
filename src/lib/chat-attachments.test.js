import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { createChatService } = require('../../electron/chat-service.cjs');
const { createChatAttachments } = require('../../electron/chat-attachments.cjs');
const { chatBackupFiles, readChatBackups, remapChatBackups, cacheChatReceipt, loadChatReceipt } = require('../../electron/chat-backup.cjs');
const owned = [], services = [], scope = { workspaceId: 'workspace', conversationId: 'conversation' };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const connection = { id: 'connection', name: 'Fixture', providerId: 'openai', protocol: 'openai-responses', baseUrl: 'https://api.openai.com/v1', enabled: true, status: 'configured' };
const model = { id: 'model', name: 'Fixture', modelId: 'gpt-6.1-terra', connectionId: 'connection', enabled: true, capabilities: ['text', 'vision'], pricing: { unit: 'million-tokens', currency: 'CNY', input: '1000', output: '2000' } };
const request = { ...scope, id: 'first', text: '查看资料', connection, model, credentialId: 'key' };
async function setup(options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-chat-attachment-')); owned.push(directory);
  const calls = [], service = createChatService({ directory, credentialStore: { withSecret: async (_id, _conn, fn) => fn('fixture') }, execute: async (input, messages) => { calls.push({ input, messages }); return { text: '附件已读取', usage: { inputTokens: 10, outputTokens: 20 }, requestStarted: true }; }, ...options }); services.push(service);
  async function file(name, bytes = png) { const filename = path.join(directory, name); await fs.writeFile(filename, bytes); return filename; }
  return { directory, service, calls, file };
}
async function settle(service, input = scope) { for (let n = 0; n < 200; n++) { const value = await service.read(input); if (!value.turns.some(turn => turn.status === 'running')) return value; await new Promise(resolve => setTimeout(resolve, 10)); } throw Error('not settled'); }
afterEach(async () => { await Promise.all(services.splice(0).map(service => service.shutdown())); for (const directory of owned.splice(0)) { if (!path.basename(directory).startsWith('xuzuo-chat-attachment-')) throw Error('unowned'); await fs.rm(directory, { recursive: true, force: true }); } });
describe('独立聊天的真实文件附件', () => {
  it('预检只编码一次，真实协议请求收到本地字节且没有创建项目', async () => {
    const { executeChat } = require('../../electron/provider-chat.cjs'); let body;
    const f = await setup({ execute: executeChat, fetchImpl: async (_url, options) => { body = JSON.parse(options.body); return new Response(JSON.stringify({ status: 'completed', output_text: '看到了图片', usage: { input_tokens: 10, output_tokens: 20 } }), { headers: { 'content-type': 'application/json' } }); } });
    const [image] = await f.service.importAttachments({ ...scope, paths: [await f.file('image.png')] }); await f.service.start({ ...request, attachmentIds: [image.id] }); const value = await settle(f.service);
    expect(value.turns[0].status).toBe('complete'); expect(body.input[0].content.find(part => part.type === 'input_image').image_url).toBe(`data:image/png;base64,${png.toString('base64')}`);
  });
  it('先看图再规划时带入原资料，并为制作保存实际材料引用', async () => {
    const plan = { version: 1, name: '图片制作', objective: '参考原图制作宣传图', outputKind: 'image', trigger: { type: 'manual' }, steps: [{ kind: 'image-editing', name: '修改原图', instruction: '保留主体' }], illustrations: { mode: 'none', count: 0 }, acceptance: ['保留主体'], constraints: [], maxRepairs: 0, questions: [], unsupported: [] };
    const calls = [], f = await setup({ execute: async (input, messages) => { calls.push(messages); return { text: input.mode === 'plan' ? JSON.stringify(plan) : '原图主体已确认', requestStarted: true, usage: { inputTokens: 10, outputTokens: 20 } }; } });
    const [image] = await f.service.importAttachments({ ...scope, paths: [await f.file('image.png')] }); await f.service.start({ ...request, attachmentIds: [image.id] }); await settle(f.service);
    await f.service.start({ ...request, id: 'plan', text: '按刚才的图制作', mode: 'plan', outputKind: 'image' }); const value = await settle(f.service);
    expect(value.turns.at(-1).plan.name).toBe(plan.name); expect(value.turns.at(-1).contextAttachments).toEqual([image]); expect(calls[1][0].attachments[0].buffer).toEqual(png);
  });
  it('连续三轮普通聊天均保存真实材料上下文，后续场景或转工具仍有引用', async () => {
    const f = await setup(), [image] = await f.service.importAttachments({ ...scope, paths: [await f.file('image.png')] }); await f.service.start({ ...request, attachmentIds: [image.id] }); await settle(f.service);
    await f.service.start({ ...request, id: 'second', text: '再补充一些细节' }); const second = (await settle(f.service)).turns.at(-1);
    expect(second.attachments).toBeUndefined(); expect(second.contextAttachments).toEqual([image]);
    await f.service.start({ ...request, id: 'third', text: '继续按刚才的图讨论' }); const third = (await settle(f.service)).turns.at(-1);
    expect(third.contextAttachments).toEqual([image]); const transmitted = f.calls[2].messages.flatMap(message => message.attachments || []); expect(transmitted).toHaveLength(1); expect(transmitted[0].buffer).toEqual(png);
    expect(third.contextAttachments[0].id).toBe(image.id); expect((await f.service.ledger()).reduce((sum, entry) => sum + entry.costCents, 0)).toBe(15);
  });
  it('资料超过8份时优先本轮与较新材料，不会永远无法继续聊天', async () => {
    const f = await setup(), paths = []; for (let n = 0; n < 9; n++) paths.push(await f.file(`image-${n}.png`));
    const first = await f.service.importAttachments({ ...scope, paths: paths.slice(0, 8) }), [next] = await f.service.importAttachments({ ...scope, paths: paths.slice(8) });
    await f.service.start({ ...request, attachmentIds: first.map(file => file.id) }); await settle(f.service); await f.service.start({ ...request, id: 'next', attachmentIds: [next.id] }); const value = await settle(f.service);
    const files = f.calls[1].messages.flatMap(message => message.attachments || []); expect(files).toHaveLength(8); expect(files.some(file => file.id === next.id)).toBe(true); expect(value.turns.at(-1).attachmentNotice).toContain('未带入');
  });
  it('导入后发送真实图片字节，不创建项目；历史与显式重试保留资料', async () => {
    const f = await setup(), selected = await f.service.importAttachments({ ...scope, paths: [await f.file('原图.png')] });
    await f.service.start({ ...request, attachmentIds: [selected[0].id] }); const first = await settle(f.service);
    expect(f.calls[0].messages[0].attachments[0].buffer).toEqual(png); expect(first.turns[0].attachments[0].name).toBe('原图.png'); expect(JSON.stringify(first)).not.toContain('filename');
    await f.service.start({ ...request, id: 'followup', text: '再说一遍' }); await settle(f.service); expect(f.calls[1].messages[0].attachments[0].buffer).toEqual(png);
    await f.service.start({ ...request, id: 'retry', sourceTurnId: 'first' }); await settle(f.service); expect(f.calls[2].messages.at(-1).attachments[0].buffer).toEqual(png); expect((await f.service.ledger()).length).toBe(3);
    expect(await fs.readdir(path.join(f.directory, 'chat-v1', scope.workspaceId))).toContain('attachments');
  });
  it('当前不兼容图片、跨会话引用、源文件篡改均在调用前拒绝', async () => {
    const f = await setup(), [image] = await f.service.importAttachments({ ...scope, paths: [await f.file('image.png')] });
    await expect(f.service.start({ ...request, model: { ...model, capabilities: ['text'] }, attachmentIds: [image.id] })).rejects.toThrow(/看图/);
    await expect(f.service.start({ ...request, conversationId: 'other', attachmentIds: [image.id] })).rejects.toThrow(/不属于/);
    await fs.writeFile(path.join(f.directory, 'chat-v1', scope.workspaceId, 'attachments', scope.conversationId, `${image.id}.png`), Buffer.from('bad'));
    await expect(f.service.start({ ...request, attachmentIds: [image.id] })).rejects.toThrow(/变化|校验/); expect(f.calls).toHaveLength(0); expect(await f.service.ledger()).toEqual([]);
  });
  it('当前所选材料被外部删除时，在发请求前拒绝且不新增费用', async () => {
    const f = await setup(), [image] = await f.service.importAttachments({ ...scope, paths: [await f.file('image.png')] });
    await fs.unlink(path.join(f.directory, 'chat-v1', scope.workspaceId, 'attachments', scope.conversationId, `${image.id}.png`));
    await expect(f.service.start({ ...request, attachmentIds: [image.id] })).rejects.toThrow(); expect(f.calls).toHaveLength(0); expect(await f.service.ledger()).toHaveLength(0);
  });
  it('切换到文字模型可继续聊天，不被旧图片困住，明确标记未带入', async () => {
    const f = await setup(), [image] = await f.service.importAttachments({ ...scope, paths: [await f.file('image.png')] }); await f.service.start({ ...request, attachmentIds: [image.id] }); await settle(f.service);
    await f.service.start({ ...request, id: 'text-only', model: { ...model, capabilities: ['text'] }, text: '只谈文案' }); const latest = (await settle(f.service)).turns.at(-1);
    expect(latest.attachmentNotice).toContain('未带入'); expect(f.calls[1].messages.every(message => !message.attachments)).toBe(true);
  });
  it('Office正文在导入时提取并按原图哈希缓存，重试和历史不重复解析', async () => {
    let extracts = 0; const f = await setup({ extractText: async () => { extracts++; return '真实提取的客户目标'; } });
    const [doc] = await f.service.importAttachments({ ...scope, paths: [await f.file('需求.docx', Buffer.from([80, 75, 3, 4, 0, 0]))] }); expect(extracts).toBe(1);
    await f.service.start({ ...request, attachmentIds: [doc.id] }); await settle(f.service); await f.service.start({ ...request, id: 'second' }); await settle(f.service);
    expect(extracts).toBe(1); expect(f.calls[0].messages[0].attachments[0].extractedText).toContain('客户目标');
  });
  it('场景要求真正发送但消息保留用户原文；无附件请求也兼容', async () => {
    const f = await setup(); await f.service.start({ ...request, text: '原话', requestText: '内置看图要求\n原话' }); const value = await settle(f.service);
    expect(value.turns[0].userText).toBe('原话'); expect(f.calls[0].messages[0].content).toBe('内置看图要求\n原话');
  });
  it('复制进项目幂等，部分失败后重试只处理未成功的一份', async () => {
    const copies = []; let fail = true;
    const f = await setup({ attachFiles: async ([file], projectId) => { if (file.name === 'second.txt' && fail) { fail = false; throw Error('disk failure'); } const artifact = { id: `copy-${copies.length}`, projectId, name: file.name, mimeType: file.mimeType, bytes: file.bytes, kind: file.kind, path: '', createdAt: '' }; copies.push(artifact); return [artifact]; } });
    const files = await f.service.importAttachments({ ...scope, paths: [await f.file('first.txt', Buffer.from('one')), await f.file('second.txt', Buffer.from('two'))] });
    const transfer = { ...scope, attachmentIds: files.map(file => file.id), projectId: 'project' }; await expect(f.service.attachToProject(transfer)).rejects.toThrow('disk failure'); expect(copies).toHaveLength(1);
    expect(await f.service.attachToProject(transfer)).toHaveLength(2); expect(copies).toHaveLength(2); await f.service.attachToProject(transfer); expect(copies).toHaveLength(2); expect(f.calls).toHaveLength(0);
  });
  it('备份以独立二进制条目保留材料并重映射归属，恢复后可再次发送', async () => {
    const f = await setup(), [image] = await f.service.importAttachments({ ...scope, paths: [await f.file('image.png')] }); await f.service.start({ ...request, attachmentIds: [image.id] }); await settle(f.service);
    const snapshot = await f.service.exportWorkspace(scope.workspaceId), files = chatBackupFiles(snapshot), bytes = new Map(files.map(file => [file.name, file.buffer]));
    expect(JSON.parse(files[0].buffer.toString()).attachmentFiles[0].data).toBeUndefined(); expect(files[1].buffer).toEqual(png);
    const [loaded] = readChatBackups({ chatWorkspaces: [scope.workspaceId], scope: 'workspaces', locations: { workspaces: [{ workspaceId: scope.workspaceId }] } }, bytes);
    const idMap = { [scope.workspaceId]: 'restored' }, [remapped] = remapChatBackups([loaded], idMap, 'backup-id'), target = await setup(); await target.service.restoreWorkspace(remapped);
    const record = remapped.conversations[0], material = record.turns[0].attachments[0]; await target.service.start({ ...request, workspaceId: 'restored', conversationId: record.id, id: 'restored-next', attachmentIds: [material.id] }); await settle(target.service, { workspaceId: 'restored', conversationId: record.id });
    expect(target.calls[0].messages.at(-1).attachments[0].buffer).toEqual(png); expect((await target.service.ledger()).length).toBe(2);
    bytes.delete(files[1].name); expect(() => readChatBackups({ chatWorkspaces: [scope.workspaceId], scope: 'workspaces', locations: { workspaces: [{ workspaceId: scope.workspaceId }] } }, bytes)).toThrow(/缺失/);
  });
  it.each(['scope', 'reference', 'mime', 'bytes'])('附件备份%s伪造在任何恢复写入之前拒绝', async mode => {
    const f = await setup(), [image] = await f.service.importAttachments({ ...scope, paths: [await f.file('image.png')] }); await f.service.start({ ...request, attachmentIds: [image.id] }); await settle(f.service);
    const packed = chatBackupFiles(await f.service.exportWorkspace(scope.workspaceId)), files = new Map(packed.map(file => [file.name, file.buffer])), source = JSON.parse(packed[0].buffer.toString());
    if (mode === 'scope') source.attachmentFiles[0].conversationId = 'different-conversation';
    if (mode === 'reference') source.conversations[0].turns[0].attachments[0].sha256 = 'b'.repeat(64);
    if (mode === 'mime') { source.attachmentFiles[0].attachment.mimeType = 'text/plain'; source.attachmentFiles[0].attachment.kind = 'text'; }
    if (mode === 'bytes') files.set(packed[1].name, Buffer.from('different bytes'));
    files.set(packed[0].name, Buffer.from(JSON.stringify(source)));
    expect(() => readChatBackups({ chatWorkspaces: [scope.workspaceId], scope: 'workspaces', locations: { workspaces: [{ workspaceId: scope.workspaceId }] } }, files)).toThrow(); expect(f.calls).toHaveLength(1);
  });
  it('恢复凭据只保留材料元数据，实际材料放旁文件，JSON重读后仍能按哈希恢复', async () => {
    const f = await setup(), [image] = await f.service.importAttachments({ ...scope, paths: [await f.file('image.png')] }); await f.service.start({ ...request, attachmentIds: [image.id] }); await settle(f.service);
    const snapshot = await f.service.exportWorkspace(scope.workspaceId), receiptRoot = path.join(f.directory, 'receipts'); await fs.mkdir(receiptRoot);
    const cached = await cacheChatReceipt(fs, receiptRoot, 'backup', [snapshot]), serialized = JSON.stringify(cached);
    expect(cached[0].attachmentFiles[0]).toEqual({ conversationId: scope.conversationId, attachment: image, cached: true }); expect(serialized).not.toContain('"buffer"'); expect(serialized).not.toContain('"data"');
    const restored = await loadChatReceipt(fs, receiptRoot, 'backup', JSON.parse(serialized)); expect(restored[0].attachmentFiles[0].buffer).toEqual(png);
    const filename = path.join(receiptRoot, 'backup-chat-materials', scope.workspaceId, scope.conversationId, image.id); await fs.writeFile(filename, Buffer.alloc(png.length));
    await expect(loadChatReceipt(fs, receiptRoot, 'backup', cached)).rejects.toThrow(/哈希/);
  });
  it('恢复旁文件缓存拒绝路径穿越和junction，不读取不受控文件', async () => {
    const f = await setup(), [image] = await f.service.importAttachments({ ...scope, paths: [await f.file('image.png')] }); await f.service.start({ ...request, attachmentIds: [image.id] }); await settle(f.service);
    const receiptRoot = path.join(f.directory, 'receipts'); await fs.mkdir(receiptRoot); const cached = await cacheChatReceipt(fs, receiptRoot, 'backup', [await f.service.exportWorkspace(scope.workspaceId)]);
    const forged = structuredClone(cached); forged[0].attachmentFiles[0].conversationId = '../outside'; await expect(loadChatReceipt(fs, receiptRoot, 'backup', forged)).rejects.toThrow(/编号/);
    const guardedFs = { ...fs, lstat: async filename => { const stat = await fs.lstat(filename); return filename.endsWith('backup-chat-materials') ? new Proxy(stat, { get(target, key) { if (key === 'isSymbolicLink') return () => true; const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value; } }) : stat; } };
    await expect(loadChatReceipt(guardedFs, receiptRoot, 'backup', cached)).rejects.toThrow(/junction|链接/);
  });
  it('拒绝伪装格式、GIF/SVG和非法文件数量，附件索引不得跨目录', async () => {
    const f = await setup(); await expect(f.service.importAttachments({ ...scope, paths: [await f.file('bad.png', Buffer.from('not png'))] })).rejects.toThrow(/图片/);
    await expect(f.service.importAttachments({ ...scope, paths: [await f.file('animated.gif', Buffer.from('GIF89a'))] })).rejects.toThrow(/GIF/);
    await expect(f.service.importAttachments({ ...scope, paths: Array(9).fill('C:/x') })).rejects.toThrow(/8/);
    const store = createChatAttachments({ directory: f.directory }); await expect(store.list({ workspaceId: '..', conversationId: 'x' })).rejects.toThrow(/编号/);
  });
});
