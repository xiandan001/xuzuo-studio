import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url), { fixture, request, until, PNG } = require('./production-test-fixtures.cjs');
const { createBeadMarketAI, BEAD_MARKET_IMAGE_PROMPT } = require('../../electron/bead-market-ai.cjs');
const { beadMarketAIRows } = require('../../electron/bead-market-ai-rows.cjs');
const { createModelRuntime } = require('../../electron/model-runtime.cjs');
const { createBeadStore } = require('../../electron/bead-store.cjs');
const bead = require('../../electron/bead-pattern.runtime.cjs'), core = require('../../electron/bead-market.runtime.cjs');
const { palette } = require('./bead-native-fixtures.cjs');
const cleanups = [], time = '2026-11-08T03:00:00Z';
const spec = { brand: 'MARD', series: '', diameterMm: '2.6', paletteId: 'mard221', paletteVersion: 'reference', allowCompatible: false };
const quote = () => JSON.stringify({ rows: [{ platform: 'taobao', currency: 'CNY', title: '合成报价，仅本地HTTP测试', brand: 'MARD', diameterMm: '2.6', code: 'H1', packCount: 1000, price: '1.50', priceKind: 'regular' }], missing: ['未显示运费及完整商品链接'] });
async function setup() {
  const f = await fixture(), calls = [], controls = {};
  const server = http.createServer(async (incoming, response) => {
    const bytes = []; for await (const chunk of incoming) bytes.push(chunk); calls.push(JSON.parse(Buffer.concat(bytes).toString('utf8')));
    if (controls.hold) await controls.hold; if (controls.drop) { incoming.socket.destroy(); return; }
    response.writeHead(200, { 'content-type': 'application/json', 'x-request-id': 'market-ai-local-' + calls.length });
    response.end(JSON.stringify({ id: 'market-ai-local-' + calls.length, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: controls.reply || quote() } }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const project = { ...request().project, id: 'market-ai-project', name: '报价识读不覆盖拼豆图纸', kind: 'image', updatedAt: time }, connection = { ...request().connections[0], baseUrl: `http://127.0.0.1:${server.address().port}/v1` }, model = { ...request().models[0], capabilities: ['text', 'vision'] }, credentials = [{ id: 'metadata-only', connectionId: connection.id, name: '合成凭证，无真实Key', enabled: true }], context = { project, models: [model], connections: [connection], credentials };
  await f.workspaceStorage.ensureProject({ projectId: project.id, workspaceId: project.workspaceId, name: project.name });
  const beadStore = createBeadStore({ workspaceStorage: f.workspaceStorage });
  await beadStore.save({ projectId: project.id, expectedRevision: 0, document: { type: 'xuzuo-bead-document', version: 1, id: 'bead-original', projectId: project.id, revision: 0, title: '人工已经编辑的原图纸', settings: { ...bead.DEFAULT_BEAD_SETTINGS, rows: 8, columns: 8 }, pattern: { type: 'xuzuo-bead-pattern', version: 1, columns: 8, rows: 8, palette, cells: Array(64).fill(1) }, procurement: { ...bead.DEFAULT_BEAD_PROCUREMENT, stock: { R1: 17 }, packSizes: {} }, updatedAt: time } });
  const image = await f.artifactStore.write({ projectId: project.id, name: '所选报价截图.png', mimeType: 'image/png', buffer: PNG });
  const runtime = createModelRuntime({ directory: f.directory, artifactStore: f.artifactStore, credentialStore: { withSecret: async (_id, _connection, callback) => callback('synthetic-market-fixture-only') } });
  f.engineOptions.modelRuntime.execute = (...args) => runtime.execute(...args); f.engineOptions.modelRuntime.supports = (...args) => runtime.supports(...args); f.engineOptions.credentials.list = async () => credentials;
  const options = { workspaceStorage: f.workspaceStorage, artifactStore: f.artifactStore, liveEngine: f.engine, getContext: async () => structuredClone(context) }, ai = createBeadMarketAI(options), extras = [];
  cleanups.push(async () => { controls.release?.(); for (const service of [ai, ...extras]) await service.shutdown(); await f.engine.shutdown(); await Promise.all([beadStore.drain(), f.editorStore.drain(), f.spreadsheetStore.drain(), f.artifactStore.drain()]); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); const actual = await fs.realpath(f.directory); if (path.dirname(actual) !== await fs.realpath(os.tmpdir()) || !path.basename(actual).startsWith('xuzuo-production-')) throw Error('Unsafe market fixture cleanup'); await fs.rm(actual, { recursive: true, force: true }); });
  return Object.assign(f, { calls, controls, project, connection, model, context, beadStore, image, options, ai, extras, input: { projectId: project.id, artifactId: image.id, modelConfigId: model.id, credentialId: 'metadata-only' } });
}
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

describe('报价截图识读：真实引擎与明确本地HTTP桩', () => {
  it('一个vision辅助保留人工拼豆、原人工检查任务，正确记一笔费用并发送仅选定图片', async () => {
    const f = await setup(), original = await f.beadStore.read({ projectId: f.project.id });
    const production = await f.engine.start({ ...request(), project: f.project, connections: [f.connection], models: [f.model], workflow: { ...request().workflow, outputKind: 'image', steps: [{ id: 'check-bead', name: '人工核对图纸', kind: 'manual-review', prompt: '', inputSource: 'project', enabled: true }] } });
    await until(() => f.engine.runDetail(production.id), value => value.status === 'waiting-review');
    const result = await f.ai.extract(f.input), run = await f.engine.runDetail(result.runId);
    expect(run.purpose).toBe('business-assist'); expect(run.snapshot.steps).toHaveLength(1); expect(run.snapshot.steps[0]).toMatchObject({ kind: 'vision', role: 'planner', referenceArtifactIds: [f.image.id] });
    expect(f.calls).toHaveLength(1); expect(f.calls[0].messages[0].content.filter(part => part.type === 'image_url').map(part => part.image_url.url)).toEqual(['data:image/png;base64,' + PNG.toString('base64')]);
    expect(await f.beadStore.read({ projectId: f.project.id })).toEqual(original); expect((await f.engine.runDetail(production.id)).status).toBe('waiting-review'); const snapshot = await f.engine.snapshot(); expect(snapshot.ledger).toHaveLength(1); expect(snapshot.ledger[0]).toMatchObject({ workflowRunId: result.runId, costState: 'calculated' }); expect(snapshot.ledger[0].costCents).toBeGreaterThan(0);
    const rows = beadMarketAIRows(result, { core, projectId: f.project.id, spec, artifactId: f.image.id, platform: 'taobao' }); expect(rows.offers[0]).toMatchObject({ priceCents: 150, url: '', brand: 'MARD', code: 'H1', verification: 'candidate' }); expect(rows.offers[0].shippingCents).toBeUndefined();
  });
  it('同图和双击不再次付费，明确重识读恰多一次且旧费用保留', async () => {
    const f = await setup(); const first = f.ai.extract(f.input), duplicate = f.ai.extract(f.input); expect(duplicate).toBe(first); const result = await first, before = structuredClone((await f.engine.snapshot()).ledger);
    const cached = await f.ai.extract(f.input); expect(cached.runId).toBe(result.runId); expect(f.calls).toHaveLength(1); expect((await f.engine.snapshot()).ledger).toEqual(before);
    const retried = await f.ai.extract({ ...f.input, retry: true }); expect(retried.runId).not.toBe(result.runId); expect(f.calls).toHaveLength(2); const ledger = (await f.engine.snapshot()).ledger; expect(ledger).toHaveLength(2); expect(ledger.find(row => row.id === before[0].id)).toEqual(before[0]);
  });
  it('丢失启动回包时持久化未知提交，不自动重发；查询恢复原run和费用', async () => {
    const f = await setup(), lookup = f.engine.lookupStart.bind(f.engine); f.engine.lookupStart = async () => { throw Error('模拟查询暂不可读'); };
    const lost = createBeadMarketAI({ ...f.options, start: async input => { await f.engine.start(input); throw Error('模拟回包丢失'); } }); f.extras.push(lost);
    await expect(lost.extract(f.input)).rejects.toThrow(/不能可靠读取|不能确认|未知|暂不能/); await until(() => f.engine.snapshot(), value => value.runs[0]?.status === 'complete'); const before = structuredClone((await f.engine.snapshot()).ledger);
    await expect(lost.extract({ ...f.input, retry: true })).rejects.toThrow(/未知|查询已有|未重发/); expect(f.calls).toHaveLength(1); f.engine.lookupStart = lookup;
    const recovered = await f.ai.extract(f.input); expect(recovered.runId).toBe(before[0].workflowRunId); expect(f.calls).toHaveLength(1); expect((await f.engine.snapshot()).ledger).toEqual(before);
  });
  it('连接断开不会自动重试，明确取消与完成竞态可及时退出且保留账目', async () => {
    const f = await setup(); let release; f.controls.hold = new Promise(resolve => { release = resolve; }); f.controls.release = release;
    const pending = f.ai.extract(f.input), rejected = expect(pending).rejects.toThrow(); await until(async () => f.calls.length, value => value === 1); await expect(f.ai.cancel({ projectId: f.project.id })).resolves.toBeUndefined(); release(); await rejected;
    expect(f.calls).toHaveLength(1); expect((await f.engine.snapshot()).ledger).toHaveLength(1); await expect(f.ai.prepareClose()).resolves.toBeUndefined(); expect(f.ai.isProjectBusy(f.project.id)).toBe(false);
  });
  it('实际HTTP断流只保留原请求与原费用，再次读取不暗中补发', async () => {
    const f = await setup(); f.controls.drop = true; await expect(f.ai.extract(f.input)).rejects.toThrow(); const before = structuredClone((await f.engine.snapshot()).ledger);
    expect(f.calls).toHaveLength(1); expect(before).toHaveLength(1); await expect(f.ai.extract(f.input)).rejects.toThrow(); expect(f.calls).toHaveLength(1); expect((await f.engine.snapshot()).ledger).toEqual(before);
  });
  it('正在识读时退出会取消且及时落盘，模型先完成时不再次取消complete任务', async () => {
    const f = await setup(); let release; f.controls.hold = new Promise(resolve => { release = resolve; }); f.controls.release = release;
    const pending = f.ai.extract(f.input), rejected = expect(pending).rejects.toThrow(); await until(async () => f.calls.length, value => value === 1); await expect(f.ai.prepareClose()).resolves.toBeUndefined(); release(); await rejected; expect(f.ai.isProjectBusy(f.project.id)).toBe(false); expect((await f.engine.snapshot()).ledger).toHaveLength(1);
    f.controls.hold = undefined; const retry = f.ai.extract({ ...f.input, retry: true }); await until(() => f.engine.snapshot(), value => value.runs.some(run => run.status === 'complete')); await expect(f.ai.prepareClose()).resolves.toBeUndefined(); await expect(retry).resolves.toHaveProperty('runId'); expect(f.calls).toHaveLength(2); expect((await f.engine.snapshot()).ledger).toHaveLength(2);
  });
  it('foreign截图价格和运费清空，只有价格不构造商品链接；中文货币别名也不能绕过', () => {
    const parsed = beadMarketAIRows({ text: JSON.stringify({ rows: [{ platform: 'taobao', currency: 'USD', price: '1.50', shipping: '2', brand: 'MARD', diameterMm: '2.6', code: 'H1', packCount: 1000 }, { platform: 'pdd', currency: 'USD', 单价: '1.50', 价格分: 150, 运费: '2.00', 阶梯价: [{ minPacks: 1, price: '1.50' }], code: 'H1', packCount: 1000 }] }), capturedAt: time }, { core, projectId: 'project', spec, artifactId: 'screenshot', platform: 'taobao' });
    expect(parsed.offers).toHaveLength(2); for (const offer of parsed.offers) { expect(offer.priceCents).toBeUndefined(); expect(offer.shippingCents).toBeUndefined(); expect(offer.tiers).toEqual([]); expect(offer.url).toBe(''); expect(offer.verification).toBe('candidate'); }
    expect(BEAD_MARKET_IMAGE_PROMPT).toMatch(/currency/);
    for (const row of [{ platform: 'taobao', price: '1.50', code: 'H1' }, { platform: 'taobao', currency: 'CNY', priceText: '$1.50', price: '1.50', code: 'H1' }]) {
      const result = beadMarketAIRows({ text: JSON.stringify({ rows: [row] }), capturedAt: time }, { core, projectId: 'project', spec, artifactId: 'screenshot' }); expect(result.offers[0].priceCents).toBeUndefined();
    }
  });
  it('长原文只限制预览，原运行记录仍可读；无法解析报价不编造行或URL', () => {
    const text = JSON.stringify({ rows: [{ platform: 'taobao', currency: 'CNY', price: '1.50', code: 'H1' }], annotation: '说明'.repeat(15000) });
    const result = beadMarketAIRows({ text, capturedAt: time }, { core, projectId: 'project', spec, artifactId: 'screenshot' }); expect(result.rawText.length).toBeLessThanOrEqual(20000); expect(result.offers[0].url).toBe(''); expect(result.offers[0].verification).toBe('candidate'); expect(result.warnings.some(value => /2万/.test(value))).toBe(true);
    const invalid = beadMarketAIRows({ text: '截图只有广告，无法辨认真实规格', capturedAt: time }, { core, projectId: 'project', spec, artifactId: 'screenshot' }); expect(invalid.offers).toEqual([]);
  });
  it('跨项目截图与被禁模型在请求前拒绝，不追加费用', async () => {
    const f = await setup(); await f.workspaceStorage.ensureProject({ projectId: 'foreign-project', workspaceId: f.project.workspaceId, name: '另一个项目' }); const foreign = await f.artifactStore.write({ projectId: 'foreign-project', name: '外项目截图.png', mimeType: 'image/png', buffer: PNG });
    await expect(f.ai.extract({ ...f.input, artifactId: foreign.id })).rejects.toThrow(/本项目/); f.context.models[0].enabled = false; await expect(f.ai.extract(f.input)).rejects.toThrow(/视觉模型/); expect(f.calls).toHaveLength(0); expect((await f.engine.snapshot()).ledger).toEqual([]);
  });
});
