// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BeadMarketPlatform, BeadMarketPlatformSession } from '../../bead-market-types';
import { BeadMarketSessions } from './BeadMarketSessions';
import { BeadMarketPanel } from './BeadMarketPanel';
import { Settings } from '../../pages/Settings';
import { INITIAL_PREFERENCES } from '../../data';
import { cleanupMarket, marketBackend, marketButton, marketClick, marketDomSetup, marketStamp, mountMarket } from './market-test-fixtures';

function sessionBackend(initial: BeadMarketPlatformSession[] = []) {
  let entries = structuredClone(initial); const listeners = new Set<() => void>(); const changed = () => { for (const listener of listeners) listener(); };
  const bridge = {
    sessions: vi.fn(async () => structuredClone(entries)), onSessionChanged: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    login: vi.fn(async ({ platform }: { platform: BeadMarketPlatform }) => { entries = [...entries.filter(entry => entry.platform !== platform), { platform, status: 'opened', openedAt: marketStamp }]; changed(); return { opened: true }; }),
    confirmLogin: vi.fn(async ({ platform }: { platform: BeadMarketPlatform }) => { entries = [...entries.filter(entry => entry.platform !== platform), { platform, status: 'confirmed', userConfirmedAt: marketStamp }]; changed(); return structuredClone(entries); }),
  };
  return { bridge, listeners, changed, get entries() { return entries; }, set entries(value: BeadMarketPlatformSession[]) { entries = value; } };
}
beforeEach(() => { marketDomSetup(); vi.useFakeTimers(); vi.setSystemTime(marketStamp); });
afterEach(async () => { await cleanupMarket(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(window, 'desktop'); });
describe('全应用采购平台登录卡（本机元数据桥模拟）', () => {
  it('不依赖项目，初载只读本机metadata，不联网、不打开平台、不读Cookie', async () => {
    const b = sessionBackend(); const cookie = vi.spyOn(document, 'cookie', 'get'); const { host } = await mountMarket(<BeadMarketSessions bridge={b.bridge} />);
    expect(b.bridge.sessions).toHaveBeenCalledTimes(1); expect(b.bridge.login).not.toHaveBeenCalled(); expect(cookie).not.toHaveBeenCalled();
    expect(host.querySelectorAll('.bm-session-card')).toHaveLength(3); expect(host.textContent).toContain('全应用共用'); expect(host.textContent).toContain('未打开'); expect(host.textContent).not.toContain('已授权');
  });
  it('提前登录打开相应平台，只在用户确认后显示上次确认时间，不假保证有效', async () => {
    const b = sessionBackend(); const { host } = await mountMarket(<StrictMode><BeadMarketSessions bridge={b.bridge} /></StrictMode>);
    await marketClick(host.querySelector<HTMLButtonElement>('[aria-label="提前登录淘宝／天猫"]')!); expect(b.bridge.login).toHaveBeenCalledWith({ platform: 'taobao' });
    expect(host.querySelector('[aria-label="淘宝／天猫网页登录记录"]')?.textContent).toContain('待确认登录');
    await marketClick(host.querySelector<HTMLButtonElement>('[aria-label="确认淘宝／天猫已完成网页登录"]')!); expect(b.bridge.confirmLogin).toHaveBeenCalledWith({ platform: 'taobao' });
    const card = host.querySelector('[aria-label="淘宝／天猫网页登录记录"]')!; expect(card.textContent).toContain('上次已确认登录'); expect(card.textContent).toContain('2026');
    expect(host.textContent).toContain('登录状态以平台实际页面为准'); expect(host.textContent).toContain('API 授权需平台另行批准'); expect(host.textContent).not.toContain('登录始终有效');
  });
  it('平台窗口的确认事件能更新卡片，闲时无轮询，隐藏时延后本机读取', async () => {
    const b = sessionBackend(); const { host } = await mountMarket(<BeadMarketSessions bridge={b.bridge} />); const before = b.bridge.sessions.mock.calls.length;
    await act(async () => vi.advanceTimersByTime(10000)); expect(b.bridge.sessions).toHaveBeenCalledTimes(before);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true }); b.entries = [{ platform: 'pdd', status: 'confirmed', userConfirmedAt: marketStamp }];
    await act(async () => { b.changed(); b.changed(); vi.advanceTimersByTime(1000); }); expect(b.bridge.sessions).toHaveBeenCalledTimes(before);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false }); await act(async () => { document.dispatchEvent(new Event('visibilitychange')); vi.advanceTimersByTime(250); });
    expect(b.bridge.sessions).toHaveBeenCalledTimes(before + 1); expect(host.querySelector('[aria-label="拼多多网页登录记录"]')?.textContent).toContain('上次已确认登录');
  });
  it('上次确认也可显示需重新登录，元数据不会冒充认证检查', async () => {
    const b = sessionBackend([{ platform: '1688', status: 'needs-login', userConfirmedAt: marketStamp }]); const { host } = await mountMarket(<BeadMarketSessions bridge={b.bridge} />);
    const card = host.querySelector('[aria-label="1688网页登录记录"]')!; expect(card.textContent).toContain('需重新登录'); expect(card.textContent).toContain('上次确认'); expect(card.textContent).not.toContain('认证通过');
  });
  it('设置页已有模型与连接分区可提前登录，不需要新建项目或改动偏好', async () => {
    const b = sessionBackend(), market = marketBackend(); Object.defineProperty(window, 'desktop', { configurable: true, value: { beadMarket: { ...market.bridge, ...b.bridge } } });
    const save = vi.fn(); const props = { ...market.props, preferences: INITIAL_PREFERENCES, workspace: { id: 'workspace', name: '设置测试' }, configuration: { ...market.props.configuration, vaultStatus: { available: false } }, onUpdatePreferences: save } as unknown as Parameters<typeof Settings>[0];
    const { host } = await mountMarket(<Settings {...props} />); await marketClick(marketButton('模型与连接', host)); expect(host.querySelector('[aria-label="采购平台提前登录"]')).not.toBeNull();
    await marketClick(host.querySelector<HTMLButtonElement>('[aria-label="提前登录1688"]')!); expect(b.bridge.login).toHaveBeenCalledWith({ platform: '1688' }); expect(market.bridge.read).not.toHaveBeenCalled(); expect(market.bridge.query).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
  });
  it('采购页登录折叠默认收起并记住选择，仍复用全局metadata接口', async () => {
    const b = sessionBackend(), market = marketBackend(); Object.defineProperty(window, 'desktop', { configurable: true, value: { beadMarket: { ...market.bridge, ...b.bridge } } });
    const { host, root } = await mountMarket(<BeadMarketPanel props={market.props} projectId={market.document.projectId} document={market.document} />); const fold = host.querySelector<HTMLDetailsElement>('.bm-login-fold')!; expect(fold.open).toBe(false);
    await marketClick(fold.querySelector('summary')!); expect(fold.open).toBe(true); await act(async () => root.render(<span>暂离</span>)); await act(async () => root.render(<BeadMarketPanel props={market.props} projectId={market.document.projectId} document={market.document} />));
    expect(host.querySelector<HTMLDetailsElement>('.bm-login-fold')?.open).toBe(true); expect(market.bridge.query).not.toHaveBeenCalled(); expect(b.bridge.login).not.toHaveBeenCalled();
  });
  it('确认记录保存失败会保留明确错误，不由一次元数据读取掩盖', async () => {
    const b = sessionBackend([{ platform: 'taobao', status: 'opened', openedAt: marketStamp }]); b.bridge.confirmLogin = vi.fn(async () => { throw Error('登录确认记录尚未保存，请重试。'); });
    const { host } = await mountMarket(<BeadMarketSessions bridge={b.bridge} />); await marketClick(host.querySelector<HTMLButtonElement>('[aria-label="确认淘宝／天猫已完成网页登录"]')!);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('登录确认记录尚未保存'); expect(host.querySelector('[aria-label="淘宝／天猫网页登录记录"]')?.textContent).toContain('待确认登录');
  });
});
