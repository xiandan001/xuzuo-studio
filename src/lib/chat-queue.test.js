import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { chatReferenceRequest } from '../components/ChatPlanReference';
import { availableChatScenarios, chatScenarioInput } from './chat-scenarios';

const load = createRequire(import.meta.url), { createChatService } = load('../../electron/chat-service.cjs'), { ModelRuntimeError } = load('../../electron/provider-http.cjs');
const { safeChatBackup, remapChatBackups } = load('../../electron/chat-backup.cjs');
const profiles = [], services = [], connection = { id: 'connection', name: '本地验收', protocol: 'openai-responses', providerId: 'openai', baseUrl: 'https://api.openai.com/v1', enabled: true };
const model = { id: 'model', name: '排队模型', modelId: 'gpt-6.1-terra', connectionId: connection.id, enabled: true, capabilities: ['text'], pricing: { unit: 'million-tokens', currency: 'CNY', input: '1000', output: '2000' } };
const request = { id: 'first', workspaceId: 'workspace', conversationId: 'conversation', text: '先讨论第一份要求', connection, model, credentialId: 'metadata-only' };
const receipt = { text: '已讨论本轮内容。', usage: { inputTokens: 10, outputTokens: 20 }, requestStarted: true };
const credentials = { withSecret: (_id, _connection, action) => action('FIXTURE_KEY_NOT_A_REAL_ACCOUNT') };
async function until(read, check) { const end = Date.now() + 4000; while (Date.now() < end) { const value = await read(); if (check(value)) return value; await new Promise(resolve => setTimeout(resolve, 5)); } throw Error('Queue fixture did not settle'); }
async function fixture(directory, options = {}) {
  directory ||= await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-chat-queue-'));
  if (!profiles.includes(directory)) profiles.push(directory);
  const calls = [], waiting = new Map(), events = [];
  const service = createChatService({ directory, credentialStore: credentials, onChanged: value => events.push(value), execute: (input, messages, control) => new Promise((resolve, reject) => {
    calls.push({ input: structuredClone(input), messages: structuredClone(messages) }); control.onText('已接收');
    waiting.set(input.id, () => resolve(structuredClone(receipt)));
    control.signal.addEventListener('abort', () => reject(new ModelRuntimeError('CANCELLED', '已停止', { requestStarted: true, partialText: '已接收', usage: receipt.usage })), { once: true });
  }), ...options }); services.push(service);
  return { service, directory, calls, waiting, events };
}
async function complete(f, id, count) { await until(() => f.waiting.has(id), Boolean); f.waiting.get(id)(); return until(() => f.service.read(request), value => value.turns.length >= count && value.turns.some(turn => turn.id === id && turn.status === 'complete')); }
afterEach(async () => {
  for (const service of services.splice(0).reverse()) await service.shutdown();
  for (const directory of profiles.splice(0)) { const real = await fs.realpath(directory); expect(path.dirname(real)).toBe(await fs.realpath(os.tmpdir())); expect(path.basename(real)).toMatch(/^xuzuo-chat-queue-/); await fs.rm(real, { recursive: true, force: true }); }
});
describe('真实聊天待发队列、提交与费用边界', () => {
  it('原回复引用前置且场景要求仍以本轮正文结尾，编辑真实待发可保留引用附件与原费用', async () => {
    const f = await fixture(); await f.service.start(request); const original = await complete(f, 'first', 1), source = original.turns[0], paidSourceFees = await f.service.ledger();
    await f.service.start({ ...request, id: 'held-second', text: '先等待这份当前回复' });
    const [attachment] = await f.service.importBytes({ ...request, files: [{ name: '引用资料.txt', mimeType: 'text/plain', bytes: Buffer.from('QUOTE_REFERENCE_FILE_4826') }] });
    const scene = availableChatScenarios(request.workspaceId, []).find(item => item.id === 'document-word'), originalText = 'QUOTE_INITIAL_4751', editedText = 'QUOTE_EDITED_4751';
    expect(scene).toBeTruthy(); const base = chatScenarioInput(scene, originalText), composed = chatReferenceRequest(base, source, source.text);
    expect(base.endsWith(originalText)).toBe(true); expect(composed.endsWith(originalText)).toBe(true); expect(composed.indexOf(source.text)).toBeLessThan(composed.indexOf(scene.prompt));
    await f.service.enqueue({ ...request, id: 'quoted-plan', text: originalText, requestText: composed, mode: 'plan', outputKind: 'word', sceneName: scene.name, attachmentIds: [attachment.id] });
    const priorFees = await f.service.ledger(); await f.service.manageQueue({ ...request, id: 'quoted-plan', action: 'pause' }); await f.service.manageQueue({ ...request, id: 'quoted-plan', action: 'edit', text: editedText });
    const saved = await f.service.read(request), pending = saved.queue[0]; expect(pending.requestText).toBe(composed.slice(0, -originalText.length) + editedText); expect(pending.attachments).toEqual([attachment]); expect(pending.requestText).toContain(source.text); expect(pending.requestText).toContain(scene.prompt); expect(pending.requestText).not.toContain(originalText); expect(f.calls).toHaveLength(2); expect(await f.service.ledger()).toEqual(priorFees);
    await complete(f, 'held-second', 2); await until(() => f.calls.length, count => count === 3); const dispatched = f.calls[2];
    expect(dispatched.input).toMatchObject({ text: editedText, requestText: pending.requestText, attachmentIds: [attachment.id], mode: 'plan', outputKind: 'word' }); expect(JSON.stringify(dispatched.messages)).toContain('QUOTE_REFERENCE_FILE_4826'); expect(JSON.stringify(dispatched.messages)).toContain(source.text);
    await f.service.cancel({ ...request, turnId: 'quoted-plan' }); const completed = await f.service.read(request); expect(completed.turns[0]).toEqual(source); expect(f.calls).toHaveLength(3); for (const paid of paidSourceFees) expect((await f.service.ledger()).find(item => item.id === paid.id)).toEqual(paid);
  }, 10000);

  it('两次点击同一排队编号只存一条，快照场景模型思考附件，编辑和撤回均未提前收费', async () => {
    const f = await fixture(); await f.service.start(request);
    const [attachment] = await f.service.importBytes({ ...request, files: [{ name: '本轮资料.txt', mimeType: 'text/plain', bytes: Buffer.from('唯一参考资料 ACORN-289') }] });
    const queued = { ...structuredClone(request), id: 'queued-a', text: '第二份要求', requestText: '固定场景要求\n\n第二份要求', sceneName: '资料解读', reasoningEffort: 'high', attachmentIds: [attachment.id] };
    await Promise.all([f.service.enqueue(queued), f.service.enqueue(queued)]);
    await f.service.enqueue({ ...request, id: 'queued-b', text: '这条随后撤回' });
    queued.model.name = '之后改变模型选择'; queued.text = '之后改变草稿';
    let saved = await f.service.read(request);
    expect(saved.queue).toHaveLength(2); expect(saved.queue[0]).toMatchObject({ sceneName: '资料解读', modelName: '排队模型', reasoningEffort: 'high', attachments: [attachment] });
    expect(f.calls).toHaveLength(1); expect(await f.service.ledger()).toHaveLength(1);
    await f.service.manageQueue({ ...request, id: 'queued-a', action: 'pause' });
    await f.service.manageQueue({ ...request, id: 'queued-a', action: 'edit', text: '明确修订后的第二份要求' });
    await f.service.manageQueue({ ...request, id: 'queued-b', action: 'withdraw' });
    await complete(f, 'first', 1);
    await until(() => f.calls.length, count => count === 2);
    expect(f.calls[1].input).toMatchObject({ id: 'queued-a', text: '明确修订后的第二份要求', requestText: '固定场景要求\n\n明确修订后的第二份要求', reasoningEffort: 'high', attachmentIds: [attachment.id], model: { name: '排队模型' } });
    expect(JSON.stringify(f.calls[1].messages)).toContain('唯一参考资料 ACORN-289');
    saved = await complete(f, 'queued-a', 2);
    expect(saved.queue || []).toEqual([]); expect((await f.service.ledger()).reduce((sum, entry) => sum + entry.costCents, 0)).toBe(10);
    await f.service.enqueue({ ...request, id: 'queued-a', text: '明确修订后的第二份要求', requestText: '固定场景要求\n\n明确修订后的第二份要求', reasoningEffort: 'high', attachmentIds: [attachment.id] });
    expect(f.calls).toHaveLength(2);
    expect(f.events.some(event => event.queueChanged && event.historyChanged && !event.ledgerChanged)).toBe(true);
  }, 10000);
  it('编辑先保留待发位置，当前回复完成也不会在保存前执行旧要求', async () => {
    const f = await fixture(); await f.service.start(request); await f.service.enqueue({ ...request, id: 'editing', text: '保存前不发送' });
    await f.service.manageQueue({ ...request, id: 'editing', action: 'pause' });
    await complete(f, 'first', 1);
    for (let n = 0; n < 3; n++) await f.service.read(request);
    expect(f.calls).toHaveLength(1); expect((await f.service.read(request)).queue[0]).toMatchObject({ editing: true, status: 'paused', text: '保存前不发送' });
    await expect(f.service.manageQueue({ ...request, action: 'resume' })).rejects.toThrow(/编辑/);
    await f.service.manageQueue({ ...request, id: 'editing', action: 'edit', text: '用户明确保存的新要求' });
    await until(() => f.calls.length, count => count === 2); expect(f.calls[1].input.text).toBe('用户明确保存的新要求'); await complete(f, 'editing', 2);
  }, 10000);
  it('停止当前回复会暂停后续，明确继续时才运行，旧费用不回退', async () => {
    const f = await fixture(); await f.service.start(request); await f.service.enqueue({ ...request, id: 'after-stop', text: '停止之后的要求' });
    await f.service.manageQueue({ ...request, id: 'after-stop', action: 'pause' });
    await f.service.cancel({ ...request, turnId: request.id });
    await f.service.manageQueue({ ...request, id: 'after-stop', action: 'edit', text: '停止后明确保存的要求' });
    const before = await f.service.ledger(); expect(before).toHaveLength(1); expect(before[0].costCents).toBe(5);
    expect((await f.service.read(request)).queue[0].status).toBe('paused'); expect(f.calls).toHaveLength(1);
    await f.service.manageQueue({ ...request, action: 'resume' }); await until(() => f.calls.length, count => count === 2);
    await complete(f, 'after-stop', 2); expect((await f.service.ledger()).find(entry => entry.id === before[0].id)).toEqual(before[0]);
  }, 10000);
  it('重启只恢复可见待发项，未知提交不自动重发或被取消编辑绕过', async () => {
    const source = await fixture(); await source.service.start(request); await source.service.enqueue({ ...request, id: 'restart-pending', text: '重启后保留' });
    await source.service.shutdown();
    const file = path.join(source.directory, 'chat-v1', request.workspaceId, request.conversationId + '.conversation.json'), indexFile = path.join(source.directory, 'chat-v1', request.workspaceId, 'index.json');
    const record = JSON.parse(await fs.readFile(file, 'utf8')); record.queue[0].status = 'starting';
    await fs.writeFile(file, JSON.stringify(record) + '\n'); const index = JSON.parse(await fs.readFile(indexFile, 'utf8')); index.items.find(item => item.id === request.conversationId).recordHash = createHash('sha256').update(JSON.stringify(record)).digest('hex'); await fs.writeFile(indexFile, JSON.stringify(index) + '\n');
    const reopened = await fixture(source.directory), value = await reopened.service.read(request);
    expect(value.queue[0]).toMatchObject({ id: 'restart-pending', status: 'unknown', text: '重启后保留' }); expect(reopened.calls).toHaveLength(0);
    await expect(reopened.service.manageQueue({ ...request, action: 'resume' })).rejects.toThrow(/确认/);
    await expect(reopened.service.manageQueue({ ...request, id: 'restart-pending', action: 'cancel-edit' })).rejects.toThrow(/确认/);
    await reopened.service.search({ workspaceId: request.workspaceId, query: '重启' }); await reopened.service.ledger(); expect(reopened.calls).toHaveLength(0);
    await reopened.service.manageQueue({ ...request, id: 'restart-pending', action: 'withdraw' }); expect((await reopened.service.read(request)).queue || []).toEqual([]);
  }, 10000);
  it('停机期间不派发新请求，重开待发仍需明确继续且编号保持不变', async () => {
    const first = await fixture(); await first.service.start(request); await first.service.enqueue({ ...request, id: 'pending-after-exit', text: '关闭后不自动收费' });
    await first.service.shutdown(); const before = await first.service.ledger(), reopened = await fixture(first.directory);
    expect((await reopened.service.read(request)).queue[0]).toMatchObject({ id: 'pending-after-exit', status: 'paused' });
    expect(reopened.calls).toHaveLength(0); await reopened.service.manageQueue({ ...request, action: 'resume' });
    await until(() => reopened.calls.length, count => count === 1); await complete(reopened, 'pending-after-exit', 2);
    expect((await reopened.service.ledger()).find(entry => entry.id === before[0].id)).toEqual(before[0]);
  }, 10000);
  it('队列私有快照剥离Key和请求头，备份保留实际附件并恢复为待选账户草稿', async () => {
    const f = await fixture(); await f.service.start(request);
    const [attachment] = await f.service.importBytes({ ...request, files: [{ name: '备份要求.txt', mimeType: 'text/plain', bytes: Buffer.from('实际排队材料') }] });
    await f.service.enqueue({ ...request, id: 'safe-copy', text: '保留原材料', connection: { ...connection, headers: { Authorization: 'NEVER_PERSIST_QUEUE_SECRET' } }, model: { ...model, apiKey: 'NEVER_PERSIST_QUEUE_SECRET' }, attachmentIds: [attachment.id] });
    await f.service.cancel({ ...request, turnId: request.id }); const raw = await f.service.exportWorkspace(request.workspaceId);
    expect(JSON.stringify(raw)).not.toContain('NEVER_PERSIST_QUEUE_SECRET'); expect(raw.attachmentFiles[0].buffer.toString()).toBe('实际排队材料');
    const safe = safeChatBackup(raw); expect(safe.conversations[0].queue[0]).toMatchObject({ _needsAccount: true, status: 'paused' }); expect(JSON.stringify(safe)).not.toContain('metadata-only');
    const map = { workspace: 'restored-workspace' }, [mapped] = remapChatBackups([safe], map, 'backup-queue');
    const restored = await fixture(); await restored.service.restoreWorkspace(mapped);
    const value = await restored.service.read({ workspaceId: mapped.workspaceId, conversationId: mapped.conversations[0].id });
    expect(value.queue[0]).toMatchObject({ needsAccount: true, status: 'paused', text: '保留原材料' }); expect(value.queue[0].credentialId).toBeUndefined();
    await expect(restored.service.manageQueue({ workspaceId: mapped.workspaceId, conversationId: value.id, action: 'resume' })).rejects.toThrow(/账户/); expect(restored.calls).toHaveLength(0);
    const preview = await restored.service.previewAttachment({ workspaceId: mapped.workspaceId, conversationId: value.id, attachmentId: value.queue[0].attachments[0].id }); expect(preview.text).toBe('实际排队材料');
  }, 10000);
  it('聊天正文搜索可取消且返回真实轮次标识，不新增请求或费用', async () => {
    const f = await fixture(); await f.service.start(request); await complete(f, 'first', 1); const fees = await f.service.ledger();
    const searching = f.service.search({ workspaceId: request.workspaceId, requestId: 'cancel-search', query: '本轮' });
    expect(f.service.cancelSearch({ workspaceId: 'other', requestId: 'cancel-search' })).toEqual({ cancelled: false });
    expect(f.service.cancelSearch({ workspaceId: request.workspaceId, requestId: 'cancel-search' })).toEqual({ cancelled: true });
    await expect(searching).rejects.toMatchObject({ name: 'AbortError' });
    const page = await f.service.search({ workspaceId: request.workspaceId, query: '本轮' }); expect(page.items[0].matchTurnId).toBe('first'); expect(await f.service.ledger()).toEqual(fees); expect(f.calls).toHaveLength(1);
  });
});


it.each(['connection', 'model', 'credential'])('排队后真正更新%s定义会暂停重绑定，当前选择和显示名变化不替换原快照', async changed => {
  const context = { connections: [structuredClone(connection)], models: [structuredClone(model)], credentials: [{ id: request.credentialId, connectionId: connection.id, enabled: true, updatedAt: '2026-11-17T00:00:00.000Z', lastFour: '1234' }] };
  const f = await fixture(undefined, { getQueuedBindings: async () => structuredClone(context) });
  await f.service.start(request); await f.service.enqueue({ ...request, id: 'bound-pending', text: '必须按明确账户执行' });
  const { queuedBindingFingerprint } = load('../../electron/chat-queue-binding.cjs'), { checkedStart } = load('../../electron/chat-service.cjs');
  const normalized = checkedStart({ ...request, id: 'bound-pending', text: '必须按明确账户执行' }), before = queuedBindingFingerprint(normalized, context, checkedStart);
  context.models.push({ ...model, id: 'another-selected-model' }); context.connections[0].name = '只调整显示名称';
  expect(queuedBindingFingerprint(normalized, context, checkedStart)).toBe(before);
  if (changed === 'connection') context.connections[0].baseUrl = 'https://new-confirmed-endpoint.example/v1';
  if (changed === 'model') context.models[0].modelId = 'gpt-6.1-sol';
  if (changed === 'credential') context.credentials[0].updatedAt = '2026-11-17T00:00:01.000Z';
  await complete(f, 'first', 1);
  const paused = await until(() => f.service.read(request), value => value.queue?.[0]?.needsAccount);
  expect(paused.queue[0]).toMatchObject({ id: 'bound-pending', status: 'paused', needsAccount: true }); expect(f.calls).toHaveLength(1); const originalFees = await f.service.ledger();
  await expect(f.service.manageQueue({ ...request, action: 'resume' })).rejects.toThrow(/更新/); expect(f.calls).toHaveLength(1);
  await f.service.manageQueue({ ...request, id: 'bound-pending', action: 'withdraw' });
  await f.service.enqueue({ ...request, id: 'explicit-new-binding', text: '用户重新确认后的要求', connection: context.connections[0], model: context.models[0] });
  await until(() => f.calls.length, count => count === 2); expect(f.calls[1].input.connection.baseUrl).toBe(context.connections[0].baseUrl); expect(f.calls[1].input.model.modelId).toBe(context.models[0].modelId);
  await complete(f, 'explicit-new-binding', 2); expect((await f.service.ledger()).find(entry => entry.id === originalFees[0].id)).toEqual(originalFees[0]);
}, 10000);
it('准备完成后同credentialId换Key，最后取密钥边界仍阻止把新Key发送至旧快照端点', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-chat-queue-')); profiles.push(directory);
  const context = { connections: [structuredClone(connection)], models: [structuredClone(model)], credentials: [{ id: request.credentialId, connectionId: connection.id, enabled: true, updatedAt: '2026-11-17T00:00:00.000Z', lastFour: '1234' }] };
  let posts = 0, secretReads = 0;
  const service = createChatService({ directory, credentialStore: { withSecret: async (_id, _connection, action) => { secretReads++; context.credentials[0].updatedAt = '2026-11-17T00:00:02.000Z'; return action('NEW_KEY_MUST_NOT_REACH_OLD_URL'); } }, getQueuedBindings: async () => structuredClone(context), fetchImpl: async () => { posts++; throw Error('No HTTP request is permitted after credential revision changes'); } }); services.push(service);
  const [material] = await service.importBytes({ ...request, files: [{ name: '窗口验收资料.txt', mimeType: 'text/plain', bytes: Buffer.from('真实等待材料') }] });
  await service.enqueue({ ...request, id: 'captured-secret-race', text: '先验证再读取Key的时间窗口', attachmentIds: [material.id] });
  const stopped = await until(() => service.read(request), value => value.turns.some(turn => turn.id === 'captured-secret-race' && turn.status === 'failed') && !!value.queue?.some(item => item.needsAccount));
  expect(secretReads).toBe(1); expect(posts).toBe(0); expect(stopped.turns[0]).toMatchObject({ costCents: 0, costState: 'not-incurred', status: 'failed' });
  expect(stopped.queue[0]).toMatchObject({ status: 'paused', needsAccount: true, text: '先验证再读取Key的时间窗口' }); expect(stopped.queue[0].id).not.toBe('captured-secret-race');
  expect(JSON.stringify(stopped)).not.toContain('NEW_KEY_MUST_NOT_REACH_OLD_URL'); expect(JSON.stringify(await service.exportWorkspace(request.workspaceId))).not.toContain('NEW_KEY_MUST_NOT_REACH_OLD_URL');
});
