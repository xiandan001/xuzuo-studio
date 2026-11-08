import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { beadUiDocument } from './bead-ui-fixtures';
const require = createRequire(import.meta.url), { dependencies, until } = require('./production-test-fixtures.cjs');
const { createWorkspaceStorage } = require('../../electron/workspace-storage.cjs'), { createArtifactStore } = require('../../electron/artifact-store.cjs'), { createBeadMarket } = require('../../electron/bead-market.cjs');
const owned = [];
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-market-service-')), workspace = path.join(directory, 'workspace'); await fs.mkdir(workspace);
  const workspaceStorage = createWorkspaceStorage({ directory: path.join(directory, 'profile') }), artifactStore = createArtifactStore({ directory: path.join(directory, 'artifacts'), workspaceStorage, loadModule: dependencies }); workspaceStorage.setArtifactMigrator((id, target) => artifactStore.migrateProject(id, target));
  await workspaceStorage.bindRoot({ workspaceId: 'workspace', name: '合成采购测试', directory: workspace }); await workspaceStorage.ensureProject({ workspaceId: 'workspace', projectId: 'project', name: '无外网采购测试' });
  let document = beadUiDocument('project'), block;
  const calls = [], events = [], sources = {
    async search(input) { calls.push(input); if (block) await Promise.race([block.promise, new Promise((_, reject) => input.signal.addEventListener('abort', () => reject(Object.assign(Error('cancelled'), { name: 'AbortError' })), { once: true }))]);
      const url = input.platform === '1688' ? 'https://detail.1688.com/offer/123456789.html' : input.platform === 'taobao' ? 'https://item.taobao.com/item.htm?id=123456789' : 'https://mobile.yangkeduo.com/goods.html?goods_id=123456789';
      return { platform: input.platform, status: 'complete', message: 'Synthetic source fixture; not a marketplace quotation', capturedAt: new Date().toISOString(), offers: [{ id: crypto.randomUUID(), platform: input.platform, url, title: '合成测试报价，不是真实平台价格', sellerId: 'synthetic-seller', sellerName: '测试商家', brand: 'Fixture', series: '', diameterMm: '2.6', code: 'W1', beadKind: 'solid', packCount: 1000, priceCents: 129, minPacks: 1, tiers: [], shippingCents: 0, priceKind: 'regular', conditions: [], conditionsAccepted: false, verification: 'candidate', evidence: { kind: 'page', capturedAt: new Date().toISOString(), url } }] };
    }, details(input) { return this.search({ ...input, platform: 'taobao' }); }, async drain() {}, async prepareClose() {}, async shutdown() {},
  };
  const ai = { async cancel() {}, async drain() {}, async prepareClose() {}, async shutdown() {}, isProjectBusy: () => false };
  const service = createBeadMarket({ workspaceStorage, artifactStore, readDocument: async () => structuredClone(document), sources, ai, dialog: {}, loadModule: dependencies, onChanged: event => events.push(event) });
  const state = (await service.read({ projectId: 'project' })).state; state.spec.diameterMm = '2.6'; await service.save({ projectId: 'project', expectedRevision: state.revision, state });
  const value = { directory, service, workspaceStorage, artifactStore, calls, events, sources, ai, input: { projectId: 'project' }, document: () => document, change: () => { document = { ...document, revision: document.revision + 1, procurement: { ...document.procurement, copies: 2 } }; }, block: () => { block = deferred(); return block; } }; owned.push(value); return value;
}
afterEach(async () => { for (const value of owned.splice(0)) { await value.service.shutdown(); await value.artifactStore.drain(); const target = await fs.realpath(value.directory); expect(path.dirname(target)).toBe(await fs.realpath(os.tmpdir())); expect(path.basename(target)).toMatch(/^xuzuo-market-service-/); await fs.rm(target, { recursive: true, force: true }); } });
describe('三平台报价真实本地状态与后台任务组合（合成来源，零外网）', () => {
  it('一次后台查询三来源、候选不当实价、缓存和读取不重复联网', async () => {
    const f = await fixture(), original = JSON.stringify(f.document()), first = await f.service.query(f.input); const result = await until(() => f.service.read(f.input), value => value.state.lastQuery.status === 'complete');
    expect(f.calls).toHaveLength(3); expect(result.state.offers).toHaveLength(3); expect(result.prices.every(row => !row.eligible)).toBe(true); expect(result.cart.complete).toBe(false);
    expect(await f.service.query(f.input)).toEqual(first); for (let at = 0; at < 5; at++) await f.service.read(f.input); expect(f.calls).toHaveLength(3); expect(JSON.stringify(f.document())).toBe(original); expect(f.service.isWorkspaceBusy('workspace')).toBe(false);
  });
  it('查询中改库存/图纸后晚到结果不进入新清单，状态明确取消', async () => {
    const f = await fixture(), waiting = f.block(); await f.service.query(f.input); f.change(); waiting.resolve(); const result = await until(() => f.service.read(f.input), value => value.state.lastQuery.status !== 'querying');
    expect(result.state.lastQuery.status).toBe('cancelled'); expect(result.state.offers).toHaveLength(0); expect(result.demand.documentRevision).toBe(2);
  });
  it('取消会中止查询且已有报价不被清空，没有新模型费用', async () => {
    const f = await fixture(); await f.service.query(f.input); await until(() => f.service.read(f.input), value => value.state.lastQuery.status === 'complete'); const previous = (await f.service.read(f.input)).state.offers.map(row => row.id); f.block(); await f.service.query({ ...f.input, force: true }); expect(f.service.isProjectBusy('project')).toBe(true); await f.service.cancel(f.input);
    const result = await f.service.read(f.input); expect(result.state.lastQuery.status).toBe('cancelled'); expect(result.state.offers.map(row => row.id)).toEqual(previous); expect(f.service.isProjectBusy('project')).toBe(false);
  });
  it('同时双击只启动一套来源，真正force重查生成新任务；部分失败不会被完整完成缓存吞掉', async () => {
    const f = await fixture(), waiting = f.block(), [first, second] = await Promise.all([f.service.query(f.input), f.service.query(f.input)]);
    expect(first).toEqual(second); expect(f.calls).toHaveLength(3); waiting.resolve(); await until(() => f.service.read(f.input), value => value.state.lastQuery.status === 'complete');
    const forced = await f.service.query({ ...f.input, force: true }); expect(forced.jobId).not.toBe(first.jobId); await until(() => f.service.read(f.input), value => value.state.lastQuery.status === 'complete'); expect(f.calls).toHaveLength(6);
    const search = f.sources.search.bind(f.sources); f.sources.search = async input => input.platform === 'pdd' ? { platform: 'pdd', status: 'needs-login', message: '需要登录，本用例为合成状态', capturedAt: new Date().toISOString(), offers: [] } : search(input);
    await f.service.query({ ...f.input, force: true }); const partial = await until(() => f.service.read(f.input), value => value.state.lastQuery.status !== 'querying'); expect(partial.state.lastQuery.status).toBe('needs-login'); const count = f.calls.length; await f.service.query(f.input); await until(() => f.service.read(f.input), value => value.state.lastQuery.status !== 'querying'); expect(f.calls.length).toBeGreaterThan(count);
  });
  it('初始查询状态保存尚未结束时，取消和退出会等安全保存完且不发送来源请求', async () => {
    const f = await fixture(), original = f.service.store.mutate.bind(f.service.store), entered = deferred(), release = deferred(); let block = true;
    f.service.store.mutate = async (...args) => { if (block) { block = false; entered.resolve(); await release.promise; } return original(...args); };
    const start = f.service.query(f.input), rejected = expect(start).rejects.toThrow('查询已变化'); await entered.promise; let finished = false; const cancelled = f.service.cancel(f.input).then(() => { finished = true; }); await Promise.resolve(); expect(finished).toBe(false); release.resolve(); await cancelled; await rejected;
    expect(f.calls).toHaveLength(0); expect(f.service.isProjectBusy('project')).toBe(false); await f.service.prepareClose();
  });
  it('启动时的文件写失败明确拒绝且不发请求，未被成功写回前drain不会把失败吞掉', async () => {
    const f = await fixture(), original = f.service.store.mutate.bind(f.service.store); f.service.store.mutate = async () => { throw Object.assign(Error('Synthetic disk failure'), { code: 'ENOSPC' }); };
    await expect(f.service.query(f.input)).rejects.toHaveProperty('code', 'ENOSPC'); expect(f.calls).toHaveLength(0); await expect(f.service.drain()).rejects.toThrow('尚未完整保存');
    f.service.store.mutate = original; await f.service.query(f.input); await until(() => f.service.read(f.input), value => value.state.lastQuery.status === 'complete'); await expect(f.service.drain()).resolves.toBeUndefined();
  });
  it('已开始查询后的落盘失败保留旧报价且不宣称全部完成，恢复目录后可明确重新查询', async () => {
    const f = await fixture(); await f.service.query(f.input); await until(() => f.service.read(f.input), value => value.state.lastQuery.status === 'complete'); const old = (await f.service.read(f.input)).state.offers;
    const waiting = f.block(), original = f.service.store.mutate.bind(f.service.store); await f.service.query({ ...f.input, force: true }); f.service.store.mutate = async () => { throw Error('Synthetic write failure after source response'); }; waiting.resolve();
    await until(async () => f.service.isProjectBusy('project'), value => !value); await expect(f.service.drain()).rejects.toThrow('尚未完整保存'); f.service.store.mutate = original; const stopped = await f.service.read(f.input); expect(stopped.state.lastQuery.status).toBe('failed'); expect(stopped.state.offers).toEqual(old); await expect(f.service.drain()).resolves.toBeUndefined();
  });
  it('新运费/阶梯/条件与证据一起形成新记录，自动查询不能偷换已保存报价或用户核对状态', async () => {
    const f = await fixture(); await f.service.query(f.input); await until(() => f.service.read(f.input), value => value.state.lastQuery.status === 'complete'); const state = (await f.service.read(f.input)).state, first = state.offers.find(row => row.platform === 'taobao'); first.verification = 'reviewed'; first.reviewedAt = new Date().toISOString(); state.selections.W1 = first.id; await f.service.save({ ...f.input, expectedRevision: state.revision, state });
    const before = structuredClone(first), search = f.sources.search.bind(f.sources); f.sources.search = async input => { const result = await search(input); for (const offer of result.offers) { offer.shippingCents = 800; offer.minPacks = 3; offer.tiers = [{ minPacks: 3, priceCents: 100 }]; offer.priceKind = 'conditional'; offer.conditions = ['需满足店铺条件']; } return result; };
    await f.service.query({ ...f.input, force: true }); const fresh = await until(() => f.service.read(f.input), value => value.state.lastQuery.status === 'complete'); expect(fresh.state.offers.find(row => row.id === first.id)).toEqual(before); expect(fresh.state.selections.W1).toBe(first.id); expect(fresh.state.offers.find(row => row.platform === 'taobao' && row.id !== first.id)).toMatchObject({ shippingCents: 800, minPacks: 3, priceKind: 'conditional', verification: 'candidate' });
  });
  it('页面采集的浏览器回调与显式读取幂等，跨项目/跨平台来源拒绝且不重复报价', async () => {
    const f = await fixture(), result = await f.sources.search({ platform: 'taobao', signal: new AbortController().signal }), browser = { isProjectBusy: id => id === 'project', async capture(input) { await f.service.acceptCapture({ ...input, result }); return result; }, async drain() {}, async prepareClose() {}, async shutdown() {} }; f.service.setBrowser(browser);
    const captured = await f.service.captureSource({ ...f.input, platform: 'taobao' }); expect(captured.state.offers).toHaveLength(1); const version = captured.state.revision; await f.service.acceptCapture({ ...f.input, platform: 'taobao', result }); expect((await f.service.read(f.input)).state.revision).toBe(version);
    await expect(f.service.acceptCapture({ projectId: 'other', platform: 'taobao', result })).rejects.toThrow('当前项目'); await expect(f.service.acceptCapture({ ...f.input, platform: 'pdd', result: { ...result, platform: 'pdd' } })).rejects.toThrow('平台不一致'); expect((await f.service.read(f.input)).state.offers).toHaveLength(1);
  });
  it('手工采集会停止旧后台查询，晚回包不会改掉已采集的价格和来源状态', async () => {
    const f = await fixture(), result = await f.sources.search({ platform: 'taobao', signal: new AbortController().signal }), waiting = f.block(), browser = { isProjectBusy: id => id === 'project', async capture() { return result; }, async drain() {}, async prepareClose() {}, async shutdown() {} }; f.service.setBrowser(browser); await f.service.query(f.input);
    const captured = await f.service.captureSource({ ...f.input, platform: 'taobao' }); waiting.resolve(); await f.service.drain(); const final = await f.service.read(f.input); expect(final.state.lastQuery.id).toBe(captured.state.lastQuery.id); expect(final.state.lastQuery.sources.taobao.status).toBe('complete'); expect(final.state.lastQuery.platforms).toEqual(['taobao']); expect(final.state.offers).toHaveLength(1);
  });
  it('退出覆盖整个OCR/开窗前置读取阶段，读取晚完成后不新增AI调用或重新打开窗口', async () => {
    for (const action of ['ocr', 'browser']) {
      const f = await fixture(), read = f.service.store.read.bind(f.service.store), entered = deferred(), release = deferred(); let once = true, modelCalls = 0, windowsOpened = 0;
      f.service.store.read = async (...args) => { if (once) { once = false; entered.resolve(); await release.promise; } return read(...args); };
      f.ai.extract = async () => { modelCalls++; throw Error('The model must not start while the app is closing'); }; f.service.setBrowser({ isProjectBusy: () => false, async open() { windowsOpened++; return { opened: true }; }, async drain() {}, async prepareClose() {}, async shutdown() {} });
      const running = action === 'ocr' ? f.service.extractImage({ ...f.input, artifactId: 'not-read' }) : f.service.openSource({ ...f.input, platform: 'taobao' }), rejected = expect(running).rejects.toHaveProperty('name', 'AbortError'); await entered.promise;
      let stopped = false; const closing = f.service.prepareClose().then(() => { stopped = true; }); await Promise.resolve(); expect(stopped).toBe(false); release.resolve(); await rejected; await closing; expect(modelCalls).toBe(0); expect(windowsOpened).toBe(0);
    }
  });
});
