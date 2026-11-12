import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url), { fixture, request, word, until, PNG } = require('./production-test-fixtures.cjs');
const { createBusinessAssist } = require('../../electron/business-assist.cjs');
const { createBusinessStore } = require('../../electron/business-store.cjs');
const { createModelRuntime } = require('../../electron/model-runtime.cjs');
const cleanups = [], time = '2026-11-08T00:00:00Z';

async function setup() {
  const f = await fixture(), calls = [], replies = [], httpServer = http.createServer(async (incoming, response) => {
    const bytes = []; for await (const piece of incoming) bytes.push(piece);
    calls.push({ path: incoming.url, body: JSON.parse(Buffer.concat(bytes).toString('utf8')) });
    if (f.hold) await f.hold;
    if (f.drop) { incoming.socket.destroy(); return; }
    const text = JSON.stringify({ title: '本地桩的真实返回', description: '测试资料', instructions: '核对后使用', changes: ['把第二页标题改为确认名称'] }); replies.push(text);
    response.writeHead(200, { 'content-type': 'application/json', 'x-request-id': 'local-fixture-' + calls.length });
    response.end(JSON.stringify({ id: 'chat-local-' + calls.length, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: text } }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } }));
  });
  await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  const project = { ...request().project, id: 'assist-project', name: '生产与辅助隔离', description: '真实确认资料', updatedAt: time };
  await f.workspaceStorage.ensureProject({ projectId: project.id, workspaceId: project.workspaceId, name: project.name });
  const connection = { ...request().connections[0], baseUrl: `http://127.0.0.1:${httpServer.address().port}/v1` }, model = { ...request().models[0], capabilities: ['text', 'vision'] };
  const credentials = [{ id: 'metadata-only', connectionId: connection.id, enabled: true }], context = { project, connections: [connection], models: [model], credentials };
  const runtime = createModelRuntime({ directory: f.directory, artifactStore: f.artifactStore, credentialStore: { withSecret: async (_id, _connection, consume) => consume('synthetic-local-fixture-only') } });
  f.engineOptions.modelRuntime.execute = (...args) => runtime.execute(...args); f.engineOptions.modelRuntime.supports = (...args) => runtime.supports(...args); f.engineOptions.credentials.list = async () => credentials;
  const store = createBusinessStore({ workspaceStorage: f.workspaceStorage, artifactStore: f.artifactStore }), order = { id: 'order', name: '实际业务资料', recipe: 'documents', sourceProjectId: project.id, brief: '客户需求', productIds: [], projectIds: [project.id], runIds: [], outputIds: [], includedRevisions: 2, status: 'draft', factsRevision: 1, facts: { 公司: '已确认客户名' }, factsConfirmedAt: time, outputKinds: ['word'], imageCount: 1, sizes: [], tasks: [], bindings: { text: { modelConfigId: model.id, credentialId: 'metadata-only' }, vision: { modelConfigId: model.id, credentialId: 'metadata-only' } }, createdAt: time, updatedAt: time };
  await store.save({ workspaceId: project.workspaceId, expectedRevision: 0, state: { version: 1, workspaceId: project.workspaceId, revision: 0, brands: [], products: [], orders: [order], feedback: [], transactions: [], metrics: [] } });
  const options = { workspaceStorage: f.workspaceStorage, artifactStore: f.artifactStore, liveEngine: f.engine, businessStore: store, getContext: async () => structuredClone(context), loadModule: f.loadModule }, assist = createBusinessAssist(options);
  cleanups.push(async () => { await assist.shutdown(); await f.engine.shutdown(); await Promise.all([store.drain(), f.editorStore.drain(), f.spreadsheetStore.drain(), f.artifactStore.drain()]); httpServer.closeAllConnections(); await new Promise(resolve => httpServer.close(resolve)); const directory = await fs.realpath(f.directory); if (path.dirname(directory) !== await fs.realpath(os.tmpdir()) || !path.basename(directory).startsWith('xuzuo-production-')) throw Error('Unsafe assist fixture cleanup'); await fs.rm(directory, { recursive: true, force: true }); });
  return Object.assign(f, { calls, replies, project, connection, model, context, store, options, assist, input: { workspaceId: project.workspaceId, orderId: order.id, purpose: 'listing', text: '按确认资料整理描述' } });
}
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

describe('业务辅助：真实引擎与仅本地HTTP适配器', () => {
  it('需求卡请求身份固定，重试或重启读取已发生结果，不再次HTTP计费', async () => {
    const f = await setup(), input = { ...f.input, purpose: 'intake', requestId: 'intake-request', text: JSON.stringify({ sources: [] }) };
    const first = await f.assist.assist(input); expect(f.calls).toHaveLength(1);
    f.context.project.budgetCents = 0;
    const second = await f.assist.assist(input); expect(second).toEqual(first); expect(f.calls).toHaveLength(1);
    const restarted = createBusinessAssist(f.options), third = await restarted.assist(input); expect(third).toEqual(first); expect(f.calls).toHaveLength(1); await restarted.shutdown();
    expect((await f.engine.snapshot()).ledger.filter(row => row.workflowRunId === first.runId)).toHaveLength(1);
  });
  it('生产等待人工检查时可辅助，保留原生产任务、人工文稿、正式输出与一次费用归集', async () => {
    const f = await setup(), production = await f.engine.start({ ...request(), project: f.project, connections: [f.connection], models: [f.model] });
    await until(() => f.engine.runDetail(production.id), run => run.status === 'waiting-review');
    await f.editorStore.save({ projectId: f.project.id, expectedRevision: 0, document: word('人工已确认正文，辅助不得覆盖') });
    const before = await f.editorStore.load({ projectId: f.project.id, kind: 'word' }), result = await f.assist.assist(f.input);
    expect(JSON.parse(result.text).title).toBe('本地桩的真实返回'); expect(f.calls).toHaveLength(2);
    const run = await f.engine.runDetail(result.runId); expect(run.purpose).toBe('business-assist'); expect(run.status).toBe('complete'); expect(run.snapshot.steps).toHaveLength(1); expect(run.snapshot.steps[0].role).toBe('planner');
    expect((await f.engine.runDetail(production.id)).status).toBe('waiting-review'); expect(await f.editorStore.load({ projectId: f.project.id, kind: 'word' })).toEqual(before);
    const order = (await f.store.snapshot(f.project.workspaceId)).orders[0]; expect(order.runIds).toEqual([result.runId]); expect(order.outputIds).toEqual([]); expect(order.tasks).toEqual([]);
    const entry = (await f.engine.snapshot()).ledger.find(row => row.workflowRunId === result.runId); expect(entry.usage.inputTokens).toBe(100); expect(entry.costState).not.toBe('unknown');
  });
  it('双击同一请求只发一次HTTP，不同请求在进行中保留输入并阻断', async () => {
    const f = await setup(); let release; f.hold = new Promise(resolve => { release = resolve; });
    try { const first = f.assist.assist(f.input), second = f.assist.assist(f.input); expect(second).toBe(first); await until(async () => f.calls.length, count => count === 1); await expect(f.assist.assist({ ...f.input, text: '另一次请求' })).rejects.toThrow('仍在处理中'); release(); expect(await second).toEqual(await first); expect(f.calls).toHaveLength(1); expect((await f.store.snapshot(f.project.workspaceId)).orders[0].runIds).toHaveLength(1); }
    finally { release(); }
  });
  it('明确选择的跨项目静态图复制后仅送本次vision，文字与Office正文实际提取', async () => {
    const f = await setup(); await f.workspaceStorage.ensureProject({ projectId: 'evidence-project', workspaceId: f.project.workspaceId, name: '用户选取资料' });
    const image = await f.artifactStore.write({ projectId: 'evidence-project', name: '所选截图.png', mimeType: 'image/png', buffer: PNG }), text = await f.artifactStore.write({ projectId: 'evidence-project', name: '确认文字.txt', mimeType: 'text/plain', text: '独有字段：实际编号SKU-987' });
    const document = await f.editorStore.export({ projectId: 'evidence-project', expectedRevision: 0, document: word('Office唯一内容ABC-456') }), docx = document.artifacts.find(file => file.mimeType.endsWith('wordprocessingml.document'));
    const result = await f.assist.assist({ ...f.input, purpose: 'performance', attachmentIds: [image.id, text.id, docx.id] }), run = await f.engine.runDetail(result.runId), ids = run.snapshot.steps[0].referenceArtifactIds;
    expect(run.snapshot.steps[0].kind).toBe('vision'); expect(ids).toHaveLength(1); expect(ids[0]).not.toBe(image.id); expect((await f.artifactStore.read(ids[0])).projectId).toBe(f.project.id);
    const content = f.calls[0].body.messages[0].content; expect(content.filter(part => part.type === 'image_url').map(part => part.image_url.url)).toEqual(['data:image/png;base64,' + PNG.toString('base64')]); expect(content[0].text).toContain('SKU-987'); expect(content[0].text).toContain('ABC-456');
  });
  it('启动响应丢失且即时查询失败时不重发，重启恢复只补费用关联且不再调用HTTP', async () => {
    const f = await setup(), originalLookup = f.engine.lookupStart.bind(f.engine); f.engine.lookupStart = async () => { throw Error('本地模拟暂不可读'); };
    const lost = createBusinessAssist({ ...f.options, start: async request => { await f.engine.start(request); throw Error('模拟启动响应丢失'); } });
    try { await expect(lost.assist(f.input)).rejects.toThrow('不能可靠读取'); await until(() => f.engine.snapshot(), value => value.runs[0]?.status === 'complete'); f.engine.lookupStart = originalLookup; const before = structuredClone((await f.engine.snapshot()).ledger), recovered = createBusinessAssist(f.options); try { const state = await recovered.recover(f.project.workspaceId); expect(state.orders[0].runIds).toHaveLength(1); expect(f.calls).toHaveLength(1); expect((await f.engine.snapshot()).ledger).toEqual(before); await recovered.recover(f.project.workspaceId); expect((await f.store.snapshot(f.project.workspaceId)).orders[0].runIds).toHaveLength(1); } finally { await recovered.shutdown(); } }
    finally { f.engine.lookupStart = originalLookup; await lost.shutdown(); }
  });
  it('HTTP连接断开保留原运行与费用，不自动重试模型', async () => {
    const f = await setup(); f.drop = true; await expect(f.assist.assist(f.input)).rejects.toThrow(); const snapshot = await f.engine.snapshot(); expect(f.calls).toHaveLength(1); expect(snapshot.runs).toHaveLength(1); expect(snapshot.runs[0].status).toBe('failed'); expect(snapshot.ledger).toHaveLength(1); expect((await f.store.snapshot(f.project.workspaceId)).orders[0].runIds).toEqual([snapshot.runs[0].id]);
  });
  it('项目准入false、错误工作区、重复附件在发送请求前阻断', async () => {
    const f = await setup(), denied = createBusinessAssist({ ...f.options, assertAdmission: async () => false }); try { await expect(denied.assist(f.input)).rejects.toThrow('正在保存或移动'); } finally { await denied.shutdown(); }
    f.context.project.workspaceId = 'other-workspace'; await expect(f.assist.assist(f.input)).rejects.toThrow('源项目不可用'); await expect(f.assist.assist({ ...f.input, attachmentIds: ['same', 'same'] })).rejects.toThrow('输入无效'); expect(f.calls).toHaveLength(0); expect((await f.engine.snapshot()).ledger).toEqual([]);
  });
  it('填写的总金额上限聚合已关联子项目费用，未到新模型前阻断', async () => {
    const f = await setup(); await f.workspaceStorage.ensureProject({ projectId: 'paid-child', workspaceId: f.project.workspaceId, name: '已完成资料套件' });
    const model = { ...f.model, pricing: { unit: 'million-tokens', currency: 'CNY', input: '10000', output: '10000' } }, paid = await f.engine.start({ ...request(), project: { ...f.project, id: 'paid-child' }, connections: [f.connection], models: [model] });
    await until(() => f.engine.runDetail(paid.id), run => run.status === 'waiting-review'); const entry = (await f.engine.snapshot()).ledger.find(row => row.workflowRunId === paid.id); expect(entry.costCents).toBeGreaterThan(0);
    await f.store.mutate(f.project.workspaceId, state => { state.orders[0].runIds.push(paid.id); state.orders[0].projectIds.push('paid-child'); return state; }); f.context.project.budgetCents = entry.costCents;
    await expect(f.assist.assist(f.input)).rejects.toThrow('总调用上限'); expect(f.calls).toHaveLength(1); expect((await f.engine.snapshot()).ledger).toHaveLength(1);
  });
  it('模型先完成而辅助轮询尚未结束时可安全退出，不再次取消complete运行', async () => {
    const f = await setup(); let release; f.hold = new Promise(resolve => { release = resolve; });
    try { const pending = f.assist.assist(f.input); await until(async () => f.calls.length, count => count === 1); release(); await until(() => f.engine.snapshot(), snapshot => snapshot.runs[0]?.status === 'complete'); await expect(f.assist.prepareClose()).resolves.toBeUndefined(); expect((await pending).runId).toBeTruthy(); expect(f.calls).toHaveLength(1); expect((await f.engine.snapshot()).ledger).toHaveLength(1); }
    finally { release(); }
  });
  it('只把主动退出取消的需求识读标为AbortError，供应商失败仍是实际失败', async () => {
    const f = await setup(); let release; f.hold = new Promise(resolve => { release = resolve; });
    try {
      const pending = f.assist.assist({ ...f.input, purpose: 'intake', requestId: 'close-request' }).then(() => undefined, error => error);
      await until(async () => f.calls.length, count => count === 1);
      const close = f.assist.prepareClose(); await until(() => f.engine.snapshot(), snapshot => snapshot.runs[0]?.status === 'cancelled'); release(); await close;
      expect(await pending).toMatchObject({ name: 'AbortError', code: 'BUSINESS_ASSIST_CANCELLED_ON_CLOSE' });
      f.hold = undefined; f.drop = true;
      const providerError = await f.assist.assist({ ...f.input, purpose: 'intake', requestId: 'provider-failure' }).then(() => undefined, error => error);
      expect(providerError).toBeInstanceOf(Error); expect(providerError.name).not.toBe('AbortError'); expect(f.calls).toHaveLength(2);
    } finally { release(); }
  });
});
