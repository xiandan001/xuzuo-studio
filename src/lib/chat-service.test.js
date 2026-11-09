import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createChatService, contextMessages } = require('../../electron/chat-service.cjs');
const { ModelRuntimeError } = require('../../electron/provider-http.cjs');
const registry = require('../../electron/billing-rules.json');
const owned = [], services = [];
const connection = { id: 'connection', name: 'Fixture', providerId: 'openai', protocol: 'openai-responses', baseUrl: 'https://api.openai.com/v1', enabled: true, status: 'configured' };
const model = { id: 'model', name: '测试模型', modelId: 'gpt-6.1-terra', connectionId: 'connection', enabled: true, capabilities: ['text'], pricing: { unit: 'million-tokens', currency: 'CNY', input: '1000', output: '2000' } };
const base = { id: 'turn-1', workspaceId: 'workspace-1', conversationId: 'conversation-1', text: '你好，我们正常聊聊。', connection, model, credentialId: 'credential' };
const credentials = { withSecret: async (_id, _connection, action) => action('fixture-only') };
const receipt = { text: '你好，有什么想讨论的？', usage: { inputTokens: 10, outputTokens: 20 }, requestStarted: true };
const plan = { version: 1, name: '测试制作', objective: '制作一张海报', outputKind: 'image', trigger: { type: 'manual' }, steps: [{ kind: 'image-generation', name: '生成海报', instruction: '制作完整海报' }], illustrations: { mode: 'none', count: 0 }, acceptance: ['内容完整'], constraints: [], maxRepairs: 0, questions: [], unsupported: [] };
async function setup(options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-chat-test-')); owned.push(directory);
  const calls = [], events = [];
  const service = createChatService({ directory, credentialStore: credentials, onChanged: value => events.push(value), execute: async (input, messages, control) => { calls.push({ input, messages, control }); control.onText('你好'); return structuredClone(receipt); }, ...options }); services.push(service);
  return { service, directory, calls, events };
}
async function settled(service, request = base) {
  for (let attempt = 0; attempt < 200; attempt++) { const value = await service.read(request); if (!value.turns.some(turn => turn.status === 'running')) return value; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw Error('Test chat failed to settle');
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(services.splice(0).map(service => service.shutdown()));
  for (const directory of owned.splice(0)) { if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep + 'xuzuo-chat-test-')) throw Error('Unowned cleanup'); await fs.rm(directory, { recursive: true, force: true }); }
});
describe('无需项目的普通聊天持久化与计费', () => {
  it('无项目附件真实进入本轮和后续上下文，公开消息仅包含元数据', async () => {
    const f = await setup(), selected = path.join(f.directory, '品牌.txt'); await fs.writeFile(selected, '蓝色小熊品牌资料');
    const attachments = await f.service.importAttachments(base, [selected]), request = { ...base, attachmentIds: attachments.map(file => file.id) };
    await f.service.start(request); let value = await settled(f.service);
    expect(value.turns[0].attachments).toEqual(attachments); expect(JSON.stringify(value)).not.toContain('蓝色小熊品牌资料'); expect(JSON.stringify(value)).not.toContain(f.directory);
    expect(f.calls[0].messages[0].attachments).toMatchObject([{ text: '蓝色小熊品牌资料' }]);
    await f.service.start({ ...base, id: 'followup-with-file', text: '请再说明品牌资料' }); value = await settled(f.service);
    expect(f.calls[1].messages[0].attachments).toMatchObject([{ text: '蓝色小熊品牌资料' }]); expect(value.turns).toHaveLength(2);
    expect((await f.service.attachmentFiles(base, base.id))[0].buffer.toString()).toBe('蓝色小熊品牌资料');
  });
  it('带附件请求编号仍幂等，重新回答继承原附件且不依赖已删除的选择缓存', async () => {
    const f = await setup(), selected = path.join(f.directory, '资料.txt'); await fs.writeFile(selected, '原始资料');
    const [attachment] = await f.service.importAttachments(base, [selected]), request = { ...base, attachmentIds: [attachment.id] };
    await f.service.start(request); await settled(f.service); await fs.rm(path.join(f.directory, 'chat-attachments-v1'), { recursive: true }); await fs.unlink(selected);
    await f.service.start(request); expect(f.calls).toHaveLength(1);
    await expect(f.service.start({ ...request, attachmentIds: ['another-file'] })).rejects.toThrow(/编号已用于不同内容/);
    await f.service.start({ ...base, id: 'retry-with-file', sourceTurnId: base.id }); const value = await settled(f.service);
    expect(value.turns[1].attachments).toEqual([attachment]); expect(f.calls[1].messages.at(-1).attachments[0].text).toBe('原始资料');
    expect(await f.service.ledger()).toHaveLength(2);
  });
  it('跨对话附件和不支持视觉的模型在发送前阻止，不新增账本记录', async () => {
    const f = await setup(), text = path.join(f.directory, '资料.txt'); await fs.writeFile(text, '正文');
    const [attachment] = await f.service.importAttachments(base, [text]);
    await expect(f.service.start({ ...base, conversationId: 'other-chat', attachmentIds: [attachment.id] })).rejects.toThrow(/不属于当前对话/);
    const pdf = path.join(f.directory, '参考.pdf'); await fs.writeFile(pdf, '%PDF-1.4\n1 0 obj <<>> endobj\n%%EOF');
    const [document] = await f.service.importAttachments(base, [pdf]);
    await expect(f.service.start({ ...base, attachmentIds: [document.id] })).rejects.toMatchObject({ code: 'UNSUPPORTED_ATTACHMENT', requestStarted: false });
    expect(f.calls).toHaveLength(0); expect(await f.service.ledger()).toHaveLength(0);
    await f.service.start({ ...base, attachmentIds: [document.id], model: { ...model, capabilities: ['text', 'vision'] } }); await settled(f.service);
    await expect(f.service.start({ ...base, id: 'followup-text-model' })).rejects.toMatchObject({ code: 'UNSUPPORTED_ATTACHMENT', requestStarted: false });
    expect(f.calls).toHaveLength(1); expect(await f.service.ledger()).toHaveLength(1);
  });
  it('聊天备份自包含附件正文与原文件，恢复后可继续读取和制作引用', async () => {
    const f = await setup(), selected = path.join(f.directory, '资料.txt'); await fs.writeFile(selected, '备份应保留的正文');
    const attachments = await f.service.importAttachments(base, [selected]);
    await f.service.start({ ...base, attachmentIds: attachments.map(file => file.id) }); await settled(f.service);
    const snapshot = await f.service.exportWorkspace(base.workspaceId), restored = await setup();
    await restored.service.restoreWorkspace(snapshot);
    expect((await restored.service.attachmentFiles(base, base.id))[0].buffer.toString()).toBe('备份应保留的正文');
    await restored.service.start({ ...base, id: 'after-restore', text: '继续讨论附件' }); await settled(restored.service);
    expect(restored.calls[0].messages[0].attachments[0].text).toBe('备份应保留的正文');
    const damaged = structuredClone(snapshot); damaged.conversations[0].turns[0]._attachments[0].data = 'AAAA';
    await expect(f.service.validateWorkspaceSnapshot(damaged)).rejects.toThrow(/聊天备份/);
  });
  it('未发送附件可供专属制作工作台使用，只允许当前对话的有效编号', async () => {
    const f = await setup(), selected = path.join(f.directory, '原始参考.txt'); await fs.writeFile(selected, '待制作资料');
    const [attachment] = await f.service.importAttachments(base, [selected]);
    const files = await f.service.attachmentFiles(base, undefined, [attachment.id]); expect(files[0].buffer.toString()).toBe('待制作资料');
    await expect(f.service.attachmentFiles({ ...base, conversationId: 'other' }, undefined, [attachment.id])).rejects.toThrow(/不属于当前对话/);
    await expect(f.service.attachmentFiles(base, undefined, ['../escape'])).rejects.toThrow(/选择无效/);
    await expect(f.service.attachmentFiles(base, undefined, [])).rejects.toThrow(/请选择/);
    await expect(f.service.attachmentFiles(base, 'turn-id', [attachment.id])).rejects.toThrow(/选择方式无效/);
    expect(f.calls).toHaveLength(0); expect(await f.service.ledger()).toHaveLength(0);
  });
  it('直接发送首条消息，不创建Project或工作区文件夹，仅写应用会话目录', async () => {
    const f = await setup(); const started = await f.service.start(base); expect(started.turns[0].status).toBe('running');
    const conversation = await settled(f.service); expect(conversation.turns[0]).toMatchObject({ userText: base.text, text: receipt.text, status: 'complete', costState: 'calculated', costCents: 5 });
    expect(await fs.readdir(f.directory)).toEqual(['chat-v1']); expect(f.calls).toHaveLength(1); expect(f.calls[0].messages).toEqual([{ role: 'user', content: base.text }]);
    const entries = await f.service.ledger(); expect(entries).toHaveLength(1); expect(entries[0]).toMatchObject({ scope: 'chat', workspaceId: base.workspaceId, conversationId: base.conversationId, projectId: 'chat-conversation-1', costCents: 5, billingMode: 'live' });
    expect(JSON.stringify(conversation)).not.toContain('_billing'); expect(JSON.stringify(conversation)).not.toContain('fixture-only');
  });
  it('发送后续消息保留真实role上下文，读取和切换不新增调用', async () => {
    const f = await setup(); await f.service.start(base); await settled(f.service); await f.service.start({ ...base, id: 'turn-2', text: '你记得上一句吗？', reasoningEffort: 'high' }); await settled(f.service);
    expect(f.calls[1].messages).toEqual([{ role: 'user', content: base.text }, { role: 'assistant', content: receipt.text }, { role: 'user', content: '你记得上一句吗？' }]);
    const stored = await f.service.read(base); expect(stored.turns[1].reasoningEffort).toBe('high'); await f.service.list(base.workspaceId); await f.service.ledger(base.workspaceId); expect(f.calls).toHaveLength(2);
  });
  it('重复请求编号幂等返回，改写内容的相同编号被拒绝且不重复扣费', async () => {
    const f = await setup(); const [first, second] = await Promise.all([f.service.start(base), f.service.start(base)]); expect(first.id).toBe(second.id); await settled(f.service);
    await f.service.start(base); await expect(f.service.start({ ...base, text: 'changed' })).rejects.toThrow(/编号已用于不同内容/);
    expect(f.calls).toHaveLength(1); expect(await f.service.ledger()).toHaveLength(1);
  });
  it('工作区隔离且同名conversation不会串历史或账本', async () => {
    const f = await setup(); await f.service.start(base); await settled(f.service);
    const other = { ...base, id: 'other-turn', workspaceId: 'workspace-2', text: '第二工作区' }; await f.service.start(other); await settled(f.service, other);
    expect(f.calls[1].messages).toEqual([{ role: 'user', content: '第二工作区' }]); expect(await f.service.ledger('workspace-1')).toHaveLength(1); expect(await f.service.ledger('workspace-2')).toHaveLength(1); expect(await f.service.ledger()).toHaveLength(2);
  });
  it('显式重试新建计费记录，原答案和原费用不会被覆盖', async () => {
    const f = await setup(); await f.service.start(base); await settled(f.service);
    await f.service.start({ ...base, id: 'retry-turn', sourceTurnId: base.id }); const value = await settled(f.service);
    expect(value.turns).toHaveLength(2); const ledger = await f.service.ledger(); expect(ledger.reduce((sum, entry) => sum + entry.costCents, 0)).toBe(10); expect(ledger.find(entry => entry.action === '重新生成')).toBeTruthy();
    await expect(f.service.start({ ...base, id: 'wrong-retry', sourceTurnId: 'not-found' })).rejects.toThrow(/原消息/); expect(f.calls).toHaveLength(2);
  });
  it('取消正在回答的一轮保留返回片段和供应商已有用量', async () => {
    const f = await setup({ execute: async (_input, _messages, control) => new Promise((_resolve, reject) => { control.onText('已生成的片段'); control.signal.addEventListener('abort', () => reject(new ModelRuntimeError('CANCELLED', '已停止', { requestStarted: true, partialText: '已生成的片段', usage: receipt.usage })), { once: true }); }) });
    await f.service.start(base); const cancelled = await f.service.cancel({ ...base, turnId: base.id }); expect(cancelled.turns[0]).toMatchObject({ text: '已生成的片段', status: 'cancelled', costCents: 5 });
    expect((await f.service.ledger())[0]).toMatchObject({ status: 'cancelled', costState: 'calculated', costCents: 5 });
  });
  it('网络中断且没有用量时明确未知，不把已发送调用冒充免费', async () => {
    const f = await setup({ execute: async () => { throw new ModelRuntimeError('NETWORK_ERROR', '连接中断', { requestStarted: true, partialText: '片段' }); } });
    await f.service.start(base); const value = await settled(f.service); expect(value.turns[0]).toMatchObject({ status: 'failed', text: '片段', costState: 'unknown' }); expect((await f.service.ledger())[0].costState).toBe('unknown');
  });
  it('发送前拒绝无效Key和不支持推理等级，不产生请求或收费', async () => {
    const f = await setup({ execute: async () => { throw new ModelRuntimeError('INVALID_CREDENTIAL', 'Key不可用', { requestStarted: false }); } });
    await expect(f.service.start({ ...base, reasoningEffort: 'imaginary-level' })).rejects.toThrow(/推理强度/);
    await expect(f.service.start({ ...base, text: 1 })).rejects.toThrow(/10000/);
    await f.service.start(base); expect((await settled(f.service)).turns[0]).toMatchObject({ status: 'failed', costState: 'not-incurred', costCents: 0 });
  });
  it('同会话不能并发重复回答，全局限制两段且停止后释放名额', async () => {
    const f = await setup({ execute: async (_input, _messages, control) => new Promise((_resolve, reject) => control.signal.addEventListener('abort', () => reject(new ModelRuntimeError('CANCELLED', '停止', { requestStarted: false })), { once: true })) });
    await f.service.start(base); await expect(f.service.start({ ...base, id: 'next' })).rejects.toThrow(/正在回答/);
    const second = { ...base, id: 'second', conversationId: 'conversation-2' }; await f.service.start(second);
    await expect(f.service.start({ ...base, id: 'third', conversationId: 'conversation-3' })).rejects.toThrow(/两段/);
    await f.service.cancel({ ...base, turnId: base.id }); await f.service.cancel({ ...second, turnId: second.id }); expect(f.service.status().running).toBe(0);
  });
  it('流式通知节流，不能每个token触发费用总览刷新', async () => {
    const f = await setup({ execute: async (_input, _messages, control) => { for (let n = 0; n < 1000; n++) control.onText(`片段${n}`); return receipt; } });
    await f.service.start(base); await settled(f.service);
    expect(f.events.filter(event => !event.ledgerChanged).length).toBeLessThanOrEqual(2); expect(f.events.filter(event => event.ledgerChanged)).toHaveLength(2);
  });
  it('关闭服务取消请求并等保存完成，重新打开能继续读且不会重新收费请求', async () => {
    const f = await setup({ execute: async (_input, _messages, control) => new Promise((_resolve, reject) => control.signal.addEventListener('abort', () => reject(new ModelRuntimeError('CANCELLED', '关闭', { requestStarted: true, partialText: '保留回答', usage: receipt.usage })), { once: true })) });
    await f.service.start(base); await f.service.shutdown(); expect(f.service.status().running).toBe(0);
    const reopened = createChatService({ directory: f.directory, credentialStore: credentials }); services.push(reopened);
    expect((await reopened.read(base)).turns[0]).toMatchObject({ text: '保留回答', status: 'cancelled', costCents: 5 }); expect(await reopened.list(base.workspaceId)).toHaveLength(1);
    await expect(f.service.start({ ...base, id: 'after-close' })).rejects.toThrow(/退出/);
  });
  it('重启时恢复未正常结束的会话，保留账本且绝不自动重发', async () => {
    const f = await setup(); await f.service.start(base); await settled(f.service); await f.service.shutdown();
    const filename = path.join(f.directory, 'chat-v1', base.workspaceId, `${base.conversationId}.conversation.json`), indexFile = path.join(f.directory, 'chat-v1', base.workspaceId, 'index.json');
    const data = JSON.parse(await fs.readFile(filename, 'utf8')), index = JSON.parse(await fs.readFile(indexFile, 'utf8'));
    data.turns[0].status = 'running'; data.turns[0].text = '断电前片段'; index.items[0].activeTurnId = base.id;
    await fs.writeFile(filename, JSON.stringify(data)); await fs.writeFile(indexFile, JSON.stringify(index));
    const reopened = createChatService({ directory: f.directory, credentialStore: credentials, execute: async () => { throw Error('must not send'); } }); services.push(reopened);
    expect((await reopened.read(base)).turns[0]).toMatchObject({ status: 'interrupted', text: '断电前片段', costState: 'unknown' }); expect((await reopened.ledger())[0].status).toBe('failed');
  });
  it('人工校正保留原费用审计，自动重算不会抹掉校正值', async () => {
    const f = await setup(); await f.service.start(base); await settled(f.service); const [entry] = await f.service.ledger();
    await f.service.reconcile({ entryId: entry.id, costCents: 12 }); await f.service.recalculateCosts(); expect((await f.service.ledger())[0]).toMatchObject({ costState: 'manual', costCents: 12 });
    const data = JSON.parse(await fs.readFile(path.join(f.directory, 'chat-v1', base.workspaceId, `${base.conversationId}.conversation.json`), 'utf8')); expect(data.turns[0]._costRevisions[0]).toMatchObject({ before: 5, amount: 12 });
  });
  it('官方费用冻结规则和返回用量，后续自动补齐人民币汇率不重复调用', async () => {
    const rule = registry.rules.find(item => item.modelId === 'gpt-6.1-terra' && item.protocols.includes('openai-responses'));
    expect(rule).toBeTruthy(); let availableFx;
    const billingModel = { ...model, pricing: { ...rule.expectedPricing, officialUrl: rule.officialUrl, verifiedAt: rule.verifiedAt } };
    const f = await setup({ fxRates: { get: async () => availableFx }, execute: async () => ({ ...receipt, usage: { inputTokens: 10, outputTokens: 20, cachedInputTokens: 0, cacheWriteInputTokens: 0 }, billingRequestSnapshot: { version: 1, adapter: 'xuzuo-openai-responses-v1', source: 'adapter-request', providerId: 'openai', protocol: 'openai-responses', modelId: model.modelId, operation: 'text', cache: { ttl: '30m', source: 'documented-default', breakpoints: false } } }) });
    await f.service.start({ ...base, model: billingModel }); await settled(f.service); const before = (await f.service.ledger())[0]; expect(before.calculation.nativeCurrency).toBe('USD'); expect(before.calculation.cnyAmount).toBeUndefined();
    availableFx = { base: 'USD', quote: 'CNY', rate: '7.2', date: '2026-11-09', source: 'fixture', kind: 'reference' };
    expect((await f.service.recalculateCosts()).updated).toBe(1); expect((await f.service.ledger())[0].calculation.cnyAmount).toBeDefined();
  });
  it('普通聊天不受JSON方案污染，制作模式保留聊天需求，过长历史只发送最近可容纳的完整轮次', () => {
    const turns = Array.from({ length: 35 }, (_, index) => ({ id: String(index), userText: `问题${index}${'文'.repeat(1800)}`, text: `回答${index}${'答'.repeat(1800)}`, status: 'complete', mode: index === 34 ? 'plan' : 'chat' }));
    const chat = contextMessages({ turns }, { text: '下一问', mode: 'chat' }); expect(chat.truncated).toBe(true); expect(chat.messages.length).toBeLessThan(49); expect(chat.messages.every(message => !message.content.includes('问题34'))).toBe(true);
    const plan = contextMessages({ turns }, { text: '修改方案', mode: 'plan' }); expect(plan.messages.some(message => message.content.includes('问题34'))).toBe(true); expect(plan.messages.some(message => message.content.includes('问题33'))).toBe(true);
  });
  it('首次落盘期间退出会等待请求入场结束，绝不在关闭后启动模型', async () => {
    let entered, release, closed = false, calls = 0;
    const pause = new Promise(resolve => { release = resolve; }), reached = new Promise(resolve => { entered = resolve; }); let blocked = false;
    const f = await setup({ fileSystem: { ...fs, rename: async (from, to) => { if (!blocked && to.endsWith('.conversation.json')) { blocked = true; entered(); await pause; } return fs.rename(from, to); } }, execute: async () => { calls++; return receipt; } });
    const start = f.service.start(base); await reached;
    const stop = f.service.shutdown().then(() => { closed = true; }); await Promise.resolve(); expect(closed).toBe(false); release();
    await start; await stop; expect(calls).toBe(0); expect(f.service.status().running).toBe(0); expect((await f.service.read(base)).turns[0]).toMatchObject({ status: 'cancelled', costState: 'not-incurred' });
  });
  it('首次落盘期间点击停止也能阻止尚未发送的请求', async () => {
    let entered, release, calls = 0;
    const pause = new Promise(resolve => { release = resolve; }), reached = new Promise(resolve => { entered = resolve; }); let blocked = false;
    const f = await setup({ fileSystem: { ...fs, rename: async (from, to) => { if (!blocked && to.endsWith('.conversation.json')) { blocked = true; entered(); await pause; } return fs.rename(from, to); } }, execute: async () => { calls++; return receipt; } });
    const start = f.service.start(base); await reached; const cancel = f.service.cancel({ ...base, turnId: base.id }); release(); await start;
    expect((await cancel).turns[0]).toMatchObject({ status: 'cancelled', costState: 'not-incurred' }); expect(calls).toBe(0);
  });
  it('制作模式也不需要项目，只有通过完整结构验证的方案才可执行', async () => {
    let valid = true;
    const f = await setup({ execute: async () => ({ ...receipt, text: valid ? JSON.stringify(plan) : '{"partial":true}' }) });
    const request = { ...base, mode: 'plan', outputKind: 'image' }; await f.service.start(request);
    const value = await settled(f.service); expect(value.turns[0]).toMatchObject({ mode: 'plan', status: 'complete', plan: { name: plan.name, outputKind: 'image' } });
    expect(await fs.readdir(f.directory)).toEqual(['chat-v1']);
    valid = false; await f.service.start({ ...request, id: 'invalid-plan', text: '再来一版' });
    const invalid = (await settled(f.service)).turns[1]; expect(invalid.status).toBe('failed'); expect(invalid.plan).toBeUndefined(); expect(invalid.costCents).toBe(5); expect((await f.service.ledger()).reduce((sum, entry) => sum + entry.costCents, 0)).toBe(10);
  });
  it('路径穿越和损坏索引不会被空白内容覆盖', async () => {
    const f = await setup(); await expect(f.service.read({ ...base, workspaceId: '../outside' })).rejects.toThrow(/编号/);
    const directory = path.join(f.directory, 'chat-v1', base.workspaceId); await fs.mkdir(directory, { recursive: true }); const index = path.join(directory, 'index.json'); await fs.writeFile(index, 'not-json');
    await expect(f.service.list(base.workspaceId)).rejects.toThrow(/索引无法读取/); expect(await fs.readFile(index, 'utf8')).toBe('not-json');
  });
  it('外部删除会话文件后拒绝覆写，重启仍保留原费用账本', async () => {
    const f = await setup(); await f.service.start(base); await settled(f.service); const before = await f.service.ledger();
    await fs.unlink(path.join(f.directory, 'chat-v1', base.workspaceId, `${base.conversationId}.conversation.json`));
    await expect(f.service.start({ ...base, id: 'after-delete' })).rejects.toThrow(/原记录文件已丢失/); expect(await f.service.ledger()).toEqual(before);
    const reopened = createChatService({ directory: f.directory, credentialStore: credentials }); services.push(reopened);
    await expect(reopened.read(base)).rejects.toThrow(/原记录文件已丢失/); await expect(reopened.start({ ...base, id: 'after-reopen' })).rejects.toThrow(/原记录文件已丢失/); expect(await reopened.ledger()).toEqual(before); expect(f.calls).toHaveLength(1);
  });
  it('终态写入失败必须阻止退出，恢复磁盘后可保存且不会重复追加错误或收费', async () => {
    let fail = true, conversationWrites = 0;
    const f = await setup({ fileSystem: { ...fs, rename: async (from, to) => { if (to.endsWith('.conversation.json')) conversationWrites++; if (fail && conversationWrites >= 2 && to.endsWith('index.json')) { const error = Error('fixture disk failure'); error.code = 'EIO'; throw error; } return fs.rename(from, to); } } });
    await f.service.start(base); const result = await settled(f.service); expect(result.turns[0].saveIssue).toMatch(/保存失败/); expect(f.service.status().unsaved).toBe(1); expect((await f.service.ledger())[0].costCents).toBe(5);
    await expect(f.service.shutdown()).rejects.toThrow(/未能保存/); await expect(f.service.shutdown()).rejects.toThrow(/未能保存/); expect((await f.service.read(base)).turns[0].saveIssue.match(/保存失败/g)).toHaveLength(1);
    fail = false; await f.service.shutdown(); expect(f.service.status().unsaved).toBe(0); expect((await f.service.read(base)).turns[0].saveIssue).toBeUndefined(); expect(f.calls).toHaveLength(1);
    const reopened = createChatService({ directory: f.directory, credentialStore: credentials }); services.push(reopened); expect((await reopened.ledger())[0].costCents).toBe(5); expect((await reopened.read(base)).turns[0].text).toBe(receipt.text);
  });
  it('会话已写入但索引未提交时，journal可在硬重启后恢复回答与真实费用', async () => {
    let conversationWrites = 0;
    const f = await setup({ fileSystem: { ...fs, rename: async (from, to) => { if (to.endsWith('.conversation.json')) conversationWrites++; if (conversationWrites >= 2 && to.endsWith('index.json')) { const error = Error('fixture crash'); error.code = 'EIO'; throw error; } return fs.rename(from, to); } } });
    await f.service.start(base); await settled(f.service); expect(f.service.status().unsaved).toBe(1);
    services.splice(services.indexOf(f.service), 1);
    const reopened = createChatService({ directory: f.directory, credentialStore: credentials }); services.push(reopened);
    expect((await reopened.read(base)).turns[0]).toMatchObject({ status: 'complete', text: receipt.text, costCents: 5 }); expect((await reopened.ledger())[0]).toMatchObject({ costCents: 5, status: 'complete' });
    await expect(fs.stat(path.join(f.directory, 'chat-v1', base.workspaceId, 'pending.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('index写前检查32MB边界，超限时不改旧回答或旧账本，也不发送请求', async () => {
    const f = await setup(); await f.service.start(base); await settled(f.service); const index = path.join(f.directory, 'chat-v1', base.workspaceId, 'index.json'), oldIndex = await fs.readFile(index, 'utf8');
    const original = Buffer.byteLength; const mock = vi.spyOn(Buffer, 'byteLength').mockImplementation((value, ...args) => typeof value === 'string' && value.startsWith('{"version":1,"workspaceId"') && value.includes('"items":') ? 32 * 1024 * 1024 + 1 : original(value, ...args));
    await expect(f.service.start({ ...base, id: 'too-big' })).rejects.toThrow(/32MB/); mock.mockRestore();
    expect(await fs.readFile(index, 'utf8')).toBe(oldIndex); expect((await f.service.ledger())[0].costCents).toBe(5); expect(f.calls).toHaveLength(1);
  });
  it('工作区聊天备份可离线验证并恢复，不包含Key，不调用模型且费用不丢', async () => {
    const f = await setup(); await f.service.start(base); await settled(f.service); const snapshot = await f.service.exportWorkspace(base.workspaceId);
    expect(snapshot.conversations[0].turns[0]._billing.modelId).toBe(model.modelId); expect(JSON.stringify(snapshot)).not.toContain('fixture-only');
    const target = await setup(); expect(await target.service.validateWorkspaceSnapshot(snapshot)).toEqual(snapshot); expect(await target.service.restoreWorkspace(snapshot)).toEqual({ restored: 1, skipped: 0 }); expect(await target.service.restoreWorkspace(snapshot)).toEqual({ restored: 0, skipped: 1 });
    expect((await target.service.read(base)).turns[0].text).toBe(receipt.text); expect((await target.service.ledger())[0].costCents).toBe(5); expect(target.calls).toHaveLength(0);
  });
  it('备份预检在任何写入前拒绝跨工作区、路径穿越、密钥字段和同ID冲突', async () => {
    const f = await setup(); await f.service.start(base); await settled(f.service); const original = await f.service.exportWorkspace(base.workspaceId), target = await setup();
    const outside = structuredClone(original); outside.conversations[0].id = '../outside'; await expect(target.service.restoreWorkspace(outside)).rejects.toThrow(/无效/);
    const wrong = structuredClone(original); wrong.conversations[0].workspaceId = 'other'; await expect(target.service.restoreWorkspace(wrong)).rejects.toThrow(/本工作区/);
    const secret = structuredClone(original); secret.conversations[0].turns[0]._billing.secret = 'do-not-import'; await expect(target.service.restoreWorkspace(secret)).rejects.toThrow(/无效/);
    expect(await target.service.ledger()).toEqual([]); await target.service.restoreWorkspace(original);
    const conflict = structuredClone(original); conflict.conversations[0].turns[0].text = '不同内容'; await expect(target.service.validateWorkspaceSnapshot(conflict)).rejects.toThrow(/不同内容/); expect((await target.service.ledger())[0].costCents).toBe(5);
  });
  it('同备份来源的恢复可幂等重试，并保留恢复之后的费用校正', async () => {
    const f = await setup(); await f.service.start(base); await settled(f.service); const snapshot = await f.service.exportWorkspace(base.workspaceId);
    snapshot.conversations[0]._importOrigin = { backupId: 'backup-1', sourceWorkspaceId: base.workspaceId, sourceConversationId: base.conversationId, sourceHash: 'a'.repeat(64) };
    const target = await setup(); await target.service.restoreWorkspace(snapshot); const [entry] = await target.service.ledger(); await target.service.reconcile({ entryId: entry.id, costCents: 99 });
    expect(await target.service.restoreWorkspace(snapshot)).toEqual({ restored: 0, skipped: 1 }); expect((await target.service.ledger())[0].costCents).toBe(99);
  });
  it('免费重试保存能清除未保存状态，失败时不允许下一轮调用制造新费用', async () => {
    let fail = true, conversationWrites = 0;
    const f = await setup({ fileSystem: { ...fs, rename: async (from, to) => { if (to.endsWith('.conversation.json')) conversationWrites++; if (fail && conversationWrites >= 2 && to.endsWith('index.json')) throw Error('fixture disk failure'); return fs.rename(from, to); } } });
    await f.service.start(base); await settled(f.service); await expect(f.service.flush(base)).rejects.toThrow(); await expect(f.service.start({ ...base, id: 'unpaid-next' })).rejects.toThrow(); expect(f.calls).toHaveLength(1);
    fail = false; const flushed = await f.service.flush(base); expect(flushed.turns[0].saveIssue).toBeUndefined(); expect(f.service.status().unsaved).toBe(0); expect(f.calls).toHaveLength(1);
    await f.service.start({ ...base, id: 'paid-next' }); await settled(f.service); expect(f.calls).toHaveLength(2);
  });
  it('首次入场记录已写但index失败时可在同一实例免费保存解锁，不要求重启', async () => {
    let fail = true, conversationWrites = 0;
    const f = await setup({ fileSystem: { ...fs, rename: async (from, to) => { if (fail && conversationWrites >= 1 && to.endsWith('index.json')) { const error = Error('fixture admission index failure'); error.code = 'EIO'; throw error; } await fs.rename(from, to); if (to.endsWith('.conversation.json')) conversationWrites++; } } });
    await expect(f.service.start(base)).rejects.toThrow(/本轮没有调用模型/);
    const failed = await f.service.read(base); expect(failed.turns[0]).toMatchObject({ status: 'cancelled', costState: 'not-incurred', costCents: 0 }); expect(failed.turns[0].saveIssue).toMatch(/重试保存/); expect(f.service.status()).toMatchObject({ running: 0, unsaved: 1 }); expect(f.calls).toHaveLength(0);
    fail = false; const flushed = await f.service.flush(base); expect(flushed.turns[0].saveIssue).toBeUndefined(); expect(f.service.status().unsaved).toBe(0);
    await f.service.start({ ...base, id: 'after-admission-recovery' }); const completed = await settled(f.service); expect(completed.turns[1].status).toBe('complete'); expect(completed.turns[0]).toMatchObject({ status: 'cancelled', costState: 'not-incurred' }); expect(f.calls).toHaveLength(1);
    const ledger = await f.service.ledger(); expect(ledger).toHaveLength(2); expect(ledger.reduce((sum, entry) => sum + entry.costCents, 0)).toBe(5); expect(ledger.find(entry => entry.status === 'cancelled').costState).toBe('not-incurred');
  });
  it('长回答最多每两秒保存检查点，不回退界面里更新的文本', async () => {
    let clock = Date.now(), push, entered, release, conversationWrites = 0, blocked = false; const writes = [];
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const reached = new Promise(resolve => { entered = resolve; }), pause = new Promise(resolve => { release = resolve; });
    const f = await setup({ fileSystem: { ...fs, rename: async (from, to) => { if (to.endsWith('.conversation.json')) { const value = JSON.parse(await fs.readFile(from, 'utf8')); if (!blocked && conversationWrites === 1) { blocked = true; entered(); await pause; } await fs.rename(from, to); conversationWrites++; writes.push(value.turns[0].status + ':' + value.turns[0].text); return; } return fs.rename(from, to); } }, execute: async (_input, _messages, control) => new Promise((_resolve, reject) => { push = control.onText; control.signal.addEventListener('abort', () => reject(new ModelRuntimeError('CANCELLED', '停止', { requestStarted: true, partialText: '更新后的正文', usage: receipt.usage })), { once: true }); }) });
    await f.service.start(base); for (let n = 0; n < 1000; n++) push(`片段${n}`); expect(conversationWrites).toBe(1);
    clock += 2500; push('已保存检查点'); await reached; push('更新后的正文'); release();
    const filename = path.join(f.directory, 'chat-v1', base.workspaceId, `${base.conversationId}.conversation.json`);
    for (let attempt = 0; attempt < 200; attempt++) { const record = JSON.parse(await fs.readFile(filename, 'utf8')); if (record.turns[0].text === '已保存检查点') break; await new Promise(resolve => setTimeout(resolve, 10)); }
    expect(JSON.parse(await fs.readFile(filename, 'utf8')).turns[0].text).toBe('已保存检查点'); expect((await f.service.read(base)).turns[0].text).toBe('更新后的正文');
    await f.service.cancel({ ...base, turnId: base.id }); expect(writes).toEqual(['running:', 'running:已保存检查点', 'cancelled:更新后的正文']); expect((await f.service.ledger())[0].costCents).toBe(5);
  });
  it('聊天缓存同时受条数和总文本内存预算约束，释放后仍可从磁盘读取', async () => {
    const f = await setup({ cacheBudgetBytes: 48000, execute: async () => ({ ...receipt, text: '正文'.repeat(7000) }) });
    await f.service.start(base); await settled(f.service);
    const second = { ...base, conversationId: 'cache-two', id: 'cache-turn-two' }; await f.service.start(second); await settled(f.service, second);
    expect(f.service.status().cachedBytes).toBeLessThanOrEqual(48000); expect(f.service.status().cachedCount).toBeLessThan(2);
    expect((await f.service.read(base)).turns[0].text).toBe('正文'.repeat(7000)); expect(f.service.status().cachedBytes).toBeLessThanOrEqual(48000);
  });
});
