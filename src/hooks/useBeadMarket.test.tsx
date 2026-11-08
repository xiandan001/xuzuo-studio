// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBeadMarket } from './useBeadMarket';
import type { BeadMarketBridge, BeadMarketSnapshot } from '../bead-market-types';
import { cleanupMarket, marketBackend, marketDomSetup, mountMarket } from '../components/bead-market/market-test-fixtures';

let api!: ReturnType<typeof useBeadMarket>;
function Harness({ projectId, bridge }: { projectId: string; bridge: BeadMarketBridge }) { api = useBeadMarket(projectId, bridge); return <span>{api.snapshot?.state.projectId} {api.snapshot?.state.spec.diameterMm} {api.error}</span>; }
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
beforeEach(() => { marketDomSetup(); vi.useFakeTimers(); vi.setSystemTime('2026-11-08T00:00:00Z'); });
afterEach(async () => { await cleanupMarket(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('材料报价作用域与持久化', () => {
  it('串行保存最新版本上的修改，发生CAS冲突时只重新读取并重放一次', async () => {
    const b = marketBackend(), original = b.bridge.save; b.bridge.save = vi.fn().mockImplementationOnce(async () => { b.state = { ...b.state, revision: 1, spec: { ...b.state.spec, series: '外部更新' } }; throw Error('BEAD_MARKET_CONFLICT'); }).mockImplementation(original);
    await mountMarket(<Harness projectId={b.document.projectId} bridge={b.bridge} />);
    await act(async () => { await Promise.all([api.commit(state => ({ ...state, spec: { ...state.spec, diameterMm: '2.6' } })), api.commit(state => ({ ...state, spec: { ...state.spec, allowCompatible: true } }))]); });
    expect(b.state.spec).toMatchObject({ diameterMm: '2.6', series: '外部更新', allowCompatible: true }); expect(api.error).toBe(''); expect(b.bridge.save).toHaveBeenCalledTimes(3);
  });
  it('旧项目的迟到读取不会覆盖新项目', async () => {
    const a = marketBackend('a'), b = marketBackend('b'), reply = deferred<BeadMarketSnapshot>(); a.bridge.read = vi.fn(() => reply.promise);
    const { root } = await mountMarket(<Harness projectId="a" bridge={a.bridge} />); await act(async () => root.render(<Harness projectId="b" bridge={b.bridge} />)); expect(api.snapshot?.state.projectId).toBe('b');
    await act(async () => reply.resolve(a.snapshot())); expect(api.snapshot?.state.projectId).toBe('b');
  });
  it('旧项目的迟到保存不会覆盖新项目，也不会触发查询或模型', async () => {
    const a = marketBackend('a'), b = marketBackend('b'), reply = deferred<BeadMarketSnapshot>(); a.bridge.save = vi.fn(() => reply.promise);
    const { root } = await mountMarket(<Harness projectId="a" bridge={a.bridge} />); let writing: Promise<unknown>;
    await act(async () => { writing = api.commit(state => ({ ...state, spec: { ...state.spec, diameterMm: '2.6' } })); });
    await act(async () => root.render(<Harness projectId="b" bridge={b.bridge} />)); await act(async () => { reply.resolve({ ...a.snapshot(), state: { ...a.state, revision: 1 } }); await writing; });
    expect(api.snapshot?.state.projectId).toBe('b'); expect(a.bridge.query).not.toHaveBeenCalled(); expect(a.bridge.extractImage).not.toHaveBeenCalled();
  });
  it('后台事件合并，隐藏页面不读取，无闲时定时轮询', async () => {
    const b = marketBackend(); await mountMarket(<Harness projectId={b.document.projectId} bridge={b.bridge} />); const initial = vi.mocked(b.bridge.read).mock.calls.length;
    await act(async () => vi.advanceTimersByTime(10000)); expect(b.bridge.read).toHaveBeenCalledTimes(initial);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true }); b.state = { ...b.state, revision: 2 };
    await act(async () => { for (const listener of b.listeners) { listener({ projectId: b.document.projectId, revision: 1 }); listener({ projectId: b.document.projectId, revision: 2 }); } vi.advanceTimersByTime(1000); }); expect(b.bridge.read).toHaveBeenCalledTimes(initial);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false }); await act(async () => { document.dispatchEvent(new Event('visibilitychange')); vi.advanceTimersByTime(250); }); expect(b.bridge.read).toHaveBeenCalledTimes(initial + 1);
  });
  it('失败保存保留输入，并允许明确重试保存', async () => {
    const b = marketBackend(), original = b.bridge.save; b.bridge.save = vi.fn().mockRejectedValueOnce(Error('磁盘不可写')).mockImplementation(original); await mountMarket(<Harness projectId={b.document.projectId} bridge={b.bridge} />);
    await act(async () => { await api.commit(state => ({ ...state, spec: { ...state.spec, diameterMm: '5' } })); }); expect(api.error).toContain('磁盘不可写');
    await act(async () => { expect(await api.flush()).toBe(true); }); expect(b.state.spec.diameterMm).toBe('5');
  });
  it('失败输入与后续新输入一起重放，保留后台同时加入的资料', async () => {
    const b = marketBackend(), original = b.bridge.save; b.bridge.save = vi.fn().mockRejectedValueOnce(Error('磁盘不可写')).mockImplementation(original); await mountMarket(<Harness projectId={b.document.projectId} bridge={b.bridge} />);
    await act(async () => { await api.commit(state => ({ ...state, spec: { ...state.spec, series: '尚未保存的系列' } })); });
    b.state = { ...b.state, revision: 1, spec: { ...b.state.spec, allowCompatible: true } };
    await act(async () => { await api.commit(state => ({ ...state, spec: { ...state.spec, diameterMm: '5' } })); });
    expect(b.state.spec).toMatchObject({ series: '尚未保存的系列', diameterMm: '5', allowCompatible: true }); expect(api.error).toBe('');
  });
  it('其它项目的慢保存不会拖住当前项目的首次读取', async () => {
    const a = marketBackend('a'), b = marketBackend('b'), reply = deferred<BeadMarketSnapshot>(); a.bridge.save = vi.fn(() => reply.promise);
    const { root } = await mountMarket(<Harness projectId="a" bridge={a.bridge} />); let writing: Promise<unknown>;
    await act(async () => { writing = api.commit(state => ({ ...state, spec: { ...state.spec, diameterMm: '2.6' } })); });
    await act(async () => root.render(<Harness projectId="b" bridge={b.bridge} />)); expect(api.snapshot?.state.projectId).toBe('b');
    await act(async () => { reply.resolve({ ...a.snapshot(), state: { ...a.state, revision: 1 } }); await writing; }); expect(api.snapshot?.state.projectId).toBe('b');
  });
});
