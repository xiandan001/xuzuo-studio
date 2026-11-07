// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WallpaperTargetPicker } from './WallpaperTargetPicker';
import { WALLPAPER_DEVICES } from '../data/wallpaper-devices';
import type { WallpaperTarget } from '../wallpaper-types';

let root: Root | undefined, container: HTMLDivElement;
const phone = WALLPAPER_DEVICES.find(device => device.id === 'iphone-17')!;
const initial: WallpaperTarget = { width: phone.width, height: phone.height, fit: 'cover', deviceId: phone.id, label: phone.name };
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Wallpaper selection must not access a model or network'); }));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 100, y: 100, left: 100, top: 100, right: 400, bottom: 144, width: 300, height: 44, toJSON: () => ({}) });
  container = document.createElement('div'); document.body.append(container);
});
afterEach(async () => { try { if (root) await act(async () => root!.unmount()); expect(fetch).not.toHaveBeenCalled(); } finally { root = undefined; container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); } });
async function fixture(value?: WallpaperTarget) {
  const changed = vi.fn(), issues = vi.fn(); let external: (value?: WallpaperTarget) => void = () => {}, disable: (value: boolean) => void = () => {};
  function Harness() {
    const [target, setTarget] = useState(value), [disabled, setDisabled] = useState(false);
    external = setTarget; disable = setDisabled;
    return <WallpaperTargetPicker value={target} disabled={disabled} onIssueChange={issues} onChange={next => { changed(next); setTarget(next); }} />;
  }
  await act(async () => { root = createRoot(container); root.render(<Harness />); });
  return { changed, issues, external: async (next?: WallpaperTarget) => act(async () => external(next)), disable: async (disabled: boolean) => act(async () => disable(disabled)) };
}
const field = () => container.querySelector<HTMLInputElement>('[role=combobox]')!;
async function focus() { await act(async () => field().focus()); }
async function type(value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field(), value); field().dispatchEvent(new Event('input', { bubbles: true })); }); }
async function key(value: string) { await act(async () => field().dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }))); }
async function click(label: string) { const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label); expect(button, label).toBeDefined(); await act(async () => button!.click()); }

describe('壁纸设备选择的实际DOM交互', () => {
  it('本地搜索设备、按品牌显示并一次选定，无模型或网络调用', async () => {
    const f = await fixture(); await focus(); await type('iPhone 17');
    expect(field().getAttribute('aria-expanded')).toBe('true');
    const option = [...document.querySelectorAll<HTMLButtonElement>('[role=option]')].find(item => item.querySelector('strong')?.textContent === phone.name)!;
    expect(option).toBeDefined(); expect(document.querySelector('.wallpaper-device-group')?.textContent).toContain('苹果');
    expect(f.changed).not.toHaveBeenCalled(); expect(f.issues).toHaveBeenLastCalledWith('请应用输入的设备或尺寸后再生成。');
    await act(async () => option.click());
    expect(f.changed).toHaveBeenCalledExactlyOnceWith(initial); expect(field().value).toBe(phone.name); expect(field().getAttribute('aria-expanded')).toBe('false');
    expect(container.textContent).toContain(`最终尺寸 ${phone.width} × ${phone.height} px · PNG`);
  });
  it('自定义像素按Enter提交，不需要另一个应用弹窗', async () => {
    const f = await fixture(); await focus(); await type('1170×2532');
    expect(document.querySelector('[role=option]')?.textContent).toContain('使用 1170 × 2532');
    await key('Enter'); expect(f.changed).toHaveBeenCalledTimes(1); expect(f.changed.mock.calls[0][0]).toMatchObject({ width: 1170, height: 2532, fit: 'cover' }); expect(f.issues).toHaveBeenLastCalledWith('');
  });
  it('完整口语识别的型号仍有可点击候选，换机型保留已选横屏方向', async () => {
    const f = await fixture({ ...initial, width: initial.height, height: initial.width }); await focus(); await type('帮我做 iPhone 17 壁纸');
    const option = [...document.querySelectorAll<HTMLButtonElement>('[role=option]')].find(item => item.querySelector('strong')?.textContent === phone.name)!; expect(option).toBeDefined();
    await act(async () => option.click()); expect(f.changed).toHaveBeenCalledTimes(1);
    await focus(); await type('iPhone 18 Pro'); const next = [...document.querySelectorAll<HTMLButtonElement>('[role=option]')].find(item => item.querySelector('strong')?.textContent === 'iPhone 18 Pro')!;
    await act(async () => next.click()); const target = f.changed.mock.calls.at(-1)![0]; expect(target.width).toBeGreaterThan(target.height);
  });
  it('Tab提交完整像素，但不替模糊折叠屏选择内屏或外屏', async () => {
    const f = await fixture(); await focus(); await type('1080x2400'); await key('Tab'); expect(f.changed.mock.calls[0][0]).toMatchObject({ width: 1080, height: 2400 });
    f.changed.mockClear(); await focus(); await type('Galaxy Z Fold7'); await key('Tab');
    expect(f.changed).not.toHaveBeenCalled(); expect(f.issues.mock.calls.at(-1)?.[0]).toMatch(/内屏|外屏|具体|选择/);
  });
  it('未知机型、英寸和过大像素只给内联说明，不提交旧目标', async () => {
    const f = await fixture(initial);
    for (const text of ['未来手机 999', '6.7英寸', '99999x99999']) { await focus(); await type(text); await key('Enter'); expect(f.changed).not.toHaveBeenCalled(); expect(container.querySelector('.wallpaper-target-issue')).not.toBeNull(); }
    expect(field().value).toBe('99999x99999');
  });
  it('方向和铺满/完整保留直接改已选目标，保持设备归属', async () => {
    const f = await fixture(initial); await click('横屏'); expect(f.changed.mock.calls.at(-1)?.[0]).toEqual({ ...initial, width: initial.height, height: initial.width });
    await click('完整保留'); expect(f.changed.mock.calls.at(-1)?.[0]).toMatchObject({ deviceId: initial.deviceId, width: initial.height, height: initial.width, fit: 'contain' });
    await click('竖屏'); expect(f.changed.mock.calls.at(-1)?.[0]).toMatchObject({ width: initial.width, height: initial.height, fit: 'contain' });
  });
  it('Esc取消本地搜索，恢复原设备且不制造一次选择或费用操作', async () => {
    const f = await fixture(initial); await focus(); await type('1080x2400'); await key('Escape');
    expect(field().value).toBe(phone.name); expect(field().getAttribute('aria-expanded')).toBe('false'); expect(f.changed).not.toHaveBeenCalled(); expect(f.issues).toHaveBeenLastCalledWith('');
  });
  it('键盘上下与Home/End可选定候选，ARIA指向真实选项', async () => {
    const f = await fixture(); await focus(); await key('ArrowUp');
    const last = document.querySelectorAll('[role=option]').length - 1;
    expect(field().getAttribute('aria-activedescendant')).toBe(document.querySelectorAll('[role=option]')[last].id);
    await key('Home'); const first = document.querySelector('[role=option]')!; expect(field().getAttribute('aria-activedescendant')).toBe(first.id);
    await key('End'); await key('Enter'); expect(f.changed).toHaveBeenCalledTimes(1); expect(field().getAttribute('aria-expanded')).toBe('false');
  });
  it('撤销或外部恢复目标同步显示，禁用时关闭候选且不能继续修改', async () => {
    const f = await fixture(initial); await focus(); await type('1080x2400'); await f.external({ width: 2048, height: 2732, fit: 'contain' });
    expect(field().value).toBe('2048 × 2732'); expect(container.textContent).toContain('2048 × 2732');
    await f.disable(true); expect(field().disabled).toBe(true); expect(document.querySelector('[role=listbox]')).toBeNull();
    await key('Enter'); expect(f.changed).not.toHaveBeenCalled();
  });
  it('候选在视口内定位，设备输入被工作台滚动区遮住时关闭浮层', async () => {
    await fixture(); await focus(); const popup = document.querySelector<HTMLElement>('.wallpaper-device-popup')!;
    expect(Number.parseFloat(popup.style.left)).toBeGreaterThanOrEqual(8); expect(Number.parseFloat(popup.style.maxHeight)).toBeLessThanOrEqual(360);
    const section = container.querySelector<HTMLElement>('.wallpaper-target-picker')!; section.style.overflowY = 'auto';
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) { const top = this.classList.contains('wallpaper-device-search') ? 500 : 100; return { x: 100, y: top, left: 100, top, right: 400, bottom: top + 44, width: 300, height: 44, toJSON: () => ({}) }; });
    await act(async () => window.dispatchEvent(new Event('scroll'))); expect(field().getAttribute('aria-expanded')).toBe('false'); expect(document.querySelector('[role=listbox]')).toBeNull();
  });
});
