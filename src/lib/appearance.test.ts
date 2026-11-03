import { afterEach, describe, expect, it, vi } from 'vitest';
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
async function fixture(raw: string | null = null, initialDark = false, blocked = false) {
  vi.resetModules(); let dark = initialDark; const mediaListeners = new Set<() => void>(), storageListeners = new Set<(event: { key: string; newValue: string }) => void>();
  const values = new Map(raw ? [['xuzuo-appearance-v1', raw]] : []);
  const storage = { getItem: (key: string) => { if (blocked) throw Error('blocked'); return values.get(key) || null; }, setItem: (key: string, value: string) => { if (blocked) throw Error('blocked'); values.set(key, value); } };
  const media = { get matches() { return dark; }, addEventListener: (_: string, listener: () => void) => mediaListeners.add(listener), removeEventListener: (_: string, listener: () => void) => mediaListeners.delete(listener) };
  const element = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
  vi.stubGlobal('localStorage', storage); vi.stubGlobal('document', { documentElement: element });
  vi.stubGlobal('window', { matchMedia: () => media, addEventListener: (_: string, listener: (event: { key: string; newValue: string }) => void) => storageListeners.add(listener), removeEventListener: (_: string, listener: (event: { key: string; newValue: string }) => void) => storageListeners.delete(listener) });
  const appearance = await import('./appearance');
  return { appearance, values, element, mediaListeners, storageListeners, systemChange(value: boolean) { dark = value; for (const listener of mediaListeners) listener(); } };
}
describe('全应用外观', () => {
  it('首屏读取已保存模式，默认跟随系统，写入独立外观键', async () => {
    const f = await fixture('{"version":1,"mode":"dark"}', false);
    expect(f.appearance.initializeAppearance()).toEqual({ mode: 'dark', resolved: 'dark', palette: 'violet', layout: 'simple' }); expect(f.element.dataset.appTheme).toBe('dark');
    expect(f.appearance.setAppearanceMode('light')).toBe(true); expect(JSON.parse(f.values.get('xuzuo-appearance-v1')!)).toEqual({ version: 1, mode: 'light', palette: 'violet', layout: 'simple' }); expect(f.values.size).toBe(1);
  });
  it('只在系统模式响应变化，明确选择不被系统覆盖，订阅可清理', async () => {
    const f = await fixture(); let changes = 0;
    const stop = f.appearance.subscribeAppearance(() => changes++);
    f.systemChange(true); expect(f.appearance.appearanceSnapshot().resolved).toBe('dark');
    f.appearance.setAppearanceMode('light'); f.systemChange(false); f.systemChange(true); expect(f.appearance.appearanceSnapshot()).toEqual({ mode: 'light', resolved: 'light', palette: 'violet', layout: 'simple' });
    f.appearance.setAppearanceMode('system'); expect(f.appearance.appearanceSnapshot().resolved).toBe('dark'); expect(changes).toBeGreaterThan(0);
    stop(); expect(f.mediaListeners.size).toBe(0); expect(f.storageListeners.size).toBe(0);
  });
  it('默认偏紫配色，配色独立于明暗并与模式一同持久保存', async () => {
    const f = await fixture(); expect(f.appearance.initializeAppearance().palette).toBe('violet');
    f.appearance.setAppearancePalette('blue'); f.appearance.setAppearanceMode('dark');
    expect(f.appearance.appearanceSnapshot()).toEqual({ mode: 'dark', resolved: 'dark', palette: 'blue', layout: 'simple' });
    expect(f.element.dataset.appPalette).toBe('blue'); expect(JSON.parse(f.values.get('xuzuo-appearance-v1')!)).toEqual({ version: 1, mode: 'dark', palette: 'blue', layout: 'simple' });
    f.appearance.setAppearancePalette('warm'); expect(f.appearance.appearanceSnapshot().resolved).toBe('dark');
  });
  it('两套界面默认简洁且独立切换，不改配色和明暗，重读偏好可恢复', async () => {
    const f = await fixture(); expect(f.appearance.initializeAppearance().layout).toBe('simple');
    f.appearance.setAppearancePalette('warm'); f.appearance.setAppearanceMode('dark'); f.appearance.setInterfaceLayout('professional');
    expect(f.appearance.appearanceSnapshot()).toEqual({ mode: 'dark', resolved: 'dark', palette: 'warm', layout: 'professional' });
    expect(f.element.dataset.appLayout).toBe('professional');
    const saved = f.values.get('xuzuo-appearance-v1')!; expect(f.appearance.readInterfaceLayout(saved)).toBe('professional');
    expect(f.appearance.readInterfaceLayout('{"version":1,"mode":"dark"}')).toBe('simple');
    f.appearance.setInterfaceLayout('simple'); expect(f.appearance.appearanceSnapshot().palette).toBe('warm');
  });
  it('非法或不可保存偏好仍可使用系统与手动主题，不修改工作区数据', async () => {
    const f = await fixture('invalid', true, true); expect(f.appearance.initializeAppearance()).toEqual({ mode: 'system', resolved: 'dark', palette: 'violet', layout: 'simple' });
    expect(f.appearance.setAppearanceMode('light')).toBe(false); expect(f.element.dataset.appTheme).toBe('light'); expect(f.values.size).toBe(1);
  });
});
