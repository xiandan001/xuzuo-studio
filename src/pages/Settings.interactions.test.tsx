// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageProps, Preferences } from '../types';
import { INITIAL_PREFERENCES } from '../data';
import { APPEARANCE_KEY, setAppearanceMode } from '../lib/appearance';
import { guardedEditorSessions } from '../lib/editor-session-guard';
import { Settings } from './Settings';

let root: Root | undefined, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Settings interactions must remain local'); }));
  host = document.createElement('div'); document.body.append(host);
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount()); root = undefined; host.remove();
  expect(guardedEditorSessions().filter(session => session.kind === 'preferences')).toEqual([]);
  expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
});
async function fixture(initial: Partial<Preferences> = {}) {
  const persist = vi.fn((_value: Partial<Preferences>): boolean | void => true), notify = vi.fn();
  function Screen() {
    const [preferences, setPreferences] = useState({ ...INITIAL_PREFERENCES, studioName: '隔离设置', ...initial });
    const props = { preferences, workspace: { id: 'settings-interaction', name: preferences.studioName }, configuration: { connections: [], models: [], vaultStatus: { available: false } }, navigate: vi.fn(), notify,
      onUpdatePreferences: (changes: Partial<Preferences>) => { const saved = persist(changes); if (saved === true) setPreferences(current => ({ ...current, ...changes })); return saved; },
    } as unknown as PageProps;
    return <Settings {...props} />;
  }
  await act(async () => { root = createRoot(host); root.render(<Screen />); }); return { persist, notify };
}
function field(label: string) { const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`); expect(input).toBeTruthy(); return input!; }
async function input(label: string, value: string) { await act(async () => { const element = field(label); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function click(label: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.getAttribute('aria-label') === label || item.textContent?.trim() === label || item.querySelector('b')?.textContent?.trim() === label);
  expect(button).toBeTruthy(); await act(async () => button!.click());
}
function session() { const value = guardedEditorSessions().find(item => item.id === 'settings-settings-interaction'); expect(value).toBeTruthy(); return value!; }

describe('设置保存卡与真实编辑交互', () => {
  it('无修改时只显示轻量状态，改动后清楚列出作用域与字段', async () => {
    const f = await fixture(); expect(host.querySelector('.op-settings-save-bar')).toBeNull(); expect(host.querySelector('.op-settings-saved-note')).toBeTruthy();
    expect(host.textContent).toContain('外观与布局即时保存'); expect(f.persist).not.toHaveBeenCalled();
    await input('工作区名称', '新的工作区'); await click('减少界面动效');
    const bar = host.querySelector('.op-settings-save-bar')!; expect(bar.textContent).toContain('2 项修改待保存'); expect(bar.textContent).toContain('当前工作区 · 隔离设置');
    expect(bar.querySelectorAll('.op-settings-change-chip')).toHaveLength(2); expect(bar.textContent).toContain('工作区名称'); expect(bar.textContent).toContain('界面动效'); expect(session().getState().dirty).toBe(true);
  });
  it('false或未收到写入确认时保留原输入与离开保护，可明确重试', async () => {
    const f = await fixture(); f.persist.mockReturnValue(false); await input('工作区名称', '尚未落盘的名称'); await click('保存设置');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('写入确认'); expect(field('工作区名称').value).toBe('尚未落盘的名称'); expect(session().getState().dirty).toBe(true);
    f.persist.mockReturnValue(undefined); let saved: boolean | undefined;
    await act(async () => { saved = await session().save(); });
    expect(saved).toBe(false); expect(session().getState().persistenceError).toContain('写入确认'); expect(f.persist).toHaveBeenCalledTimes(2); expect(f.notify).not.toHaveBeenCalledWith('当前工作区的名称与偏好已保存');
    expect([...host.querySelectorAll('button')].some(button => button.textContent?.trim() === '重试保存')).toBe(true);
  });
  it('实际保存错误清楚展示，重试成功后才清除脏状态', async () => {
    const f = await fixture(); f.persist.mockImplementationOnce(() => { throw Error('本机存储空间不足，请保留当前输入。'); });
    await input('工作区名称', '恢复后保存'); await click('保存设置');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('存储空间不足'); expect(session().getState().dirty).toBe(true);
    await click('重试保存'); expect(f.persist).toHaveBeenCalledTimes(2); expect(host.querySelector('.op-settings-save-bar')).toBeNull(); expect(field('工作区名称').value).toBe('恢复后保存');
    expect(guardedEditorSessions().filter(item => item.kind === 'preferences')).toEqual([]); expect(f.notify).toHaveBeenCalledWith('当前工作区的名称与偏好已保存');
  });
  it('同一批连续提交只写入一次，保存成功后重复快捷键不再写入', async () => {
    const f = await fixture(); await input('工作区名称', '一次保存');
    await act(async () => { const form = host.querySelector('form')!; form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    const shortcut = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }); await act(async () => field('工作区名称').dispatchEvent(shortcut));
    expect(shortcut.defaultPrevented).toBe(true); expect(f.persist).toHaveBeenCalledTimes(1); expect(host.querySelector('.op-settings-save-bar')).toBeNull();
  });
  it('跨设置分组保留草稿，点击改动项可回到对应字段', async () => {
    await fixture(); await input('工作区名称', '跨分组草稿'); await click('成本与报价'); await input('每小时人工成本', '123'); await click('常规设置');
    expect(field('工作区名称').value).toBe('跨分组草稿'); expect(host.querySelector('.op-settings-save-heading')?.textContent).toContain('2 项修改待保存');
    await click('人工时薪'); await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
    expect(field('每小时人工成本').value).toBe('123'); expect(document.activeElement).toBe(field('每小时人工成本')); expect(session().getState().dirty).toBe(true);
  });
  it('放弃工作区草稿不会撤销已经即时保存的全局外观', async () => {
    const f = await fixture(); await act(async () => { setAppearanceMode('dark'); }); const appearance = localStorage.getItem(APPEARANCE_KEY);
    expect(guardedEditorSessions().filter(item => item.kind === 'preferences')).toEqual([]);
    await input('工作区名称', '待放弃'); await click('成本与报价'); await input('目标利润金额', '888'); await click('放弃修改');
    expect(field('目标利润金额').value).toBe(String(INITIAL_PREFERENCES.targetProfit)); await click('常规设置'); expect(field('工作区名称').value).toBe('隔离设置');
    expect(localStorage.getItem(APPEARANCE_KEY)).toBe(appearance); expect(f.persist).not.toHaveBeenCalled(); expect(guardedEditorSessions().filter(item => item.kind === 'preferences')).toEqual([]);
  });
  it('恢复默认仅填草稿，能够放弃，也能明确保存且保留工作区名称', async () => {
    const f = await fixture({ hourlyRate: 99, targetProfit: 123, monthlyBudget: 40 }); await click('数据与版本'); await click('填入本区默认偏好');
    expect(f.persist).not.toHaveBeenCalled(); expect(session().getState().dirty).toBe(true); await click('放弃修改'); await click('成本与报价'); expect(field('每小时人工成本').value).toBe('99');
    await click('数据与版本'); await click('填入本区默认偏好'); await click('保存设置');
    expect(f.persist).toHaveBeenCalledExactlyOnceWith({ ...INITIAL_PREFERENCES, studioName: '隔离设置' }); expect(host.querySelector('.op-settings-save-bar')).toBeNull(); expect(guardedEditorSessions().filter(item => item.kind === 'preferences')).toEqual([]);
  });
  it('表单快捷键先校验，空名称保留错误和输入；Meta+S可保存有效设置', async () => {
    const f = await fixture(); await input('工作区名称', ''); const invalid = new KeyboardEvent('keydown', { key: 'S', ctrlKey: true, bubbles: true, cancelable: true });
    await act(async () => field('工作区名称').dispatchEvent(invalid)); expect(invalid.defaultPrevented).toBe(true); expect(f.persist).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]')?.textContent).toContain('工作区名称'); expect(session().getState().dirty).toBe(true);
    await input('工作区名称', '有效设置'); const valid = new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true }); await act(async () => field('工作区名称').dispatchEvent(valid));
    expect(valid.defaultPrevented).toBe(true); expect(f.persist).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ studioName: '有效设置' })); expect(host.querySelector('.op-settings-save-bar')).toBeNull();
  });
});
