// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PageProps } from './types';
import { INITIAL_PREFERENCES } from './data';
import { emptyWorkspaceState, WORKSPACE_STORAGE_KEY } from './lib/workspace-persistence';
import { guardedEditorSessions } from './lib/editor-session-guard';
import App from './App';

vi.mock('./pages/Overview', () => ({ Overview: (props: PageProps) => <button type="button" onClick={() => props.navigate('settings')}>打开设置验收</button> }));
let root: Root | undefined, host: HTMLDivElement, failWrites = false;
const nativeSetItem = Storage.prototype.setItem;
beforeEach(() => {
  localStorage.clear(); failWrites = false;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Settings test must not make network requests'); }));
  Object.defineProperty(Element.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
  const state = emptyWorkspaceState(); state.workspaces = [{ id: 'settings-a', name: '客户甲', description: '', createdAt: new Date().toISOString() }, { id: 'settings-b', name: '客户乙', description: '', createdAt: new Date().toISOString() }];
  state.activeWorkspaceId = 'settings-a'; state.preferencesByWorkspace = { 'settings-a': { ...INITIAL_PREFERENCES, studioName: '客户甲' }, 'settings-b': { ...INITIAL_PREFERENCES, studioName: '客户乙' } };
  localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(state));
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) { if (failWrites && key === WORKSPACE_STORAGE_KEY) throw Error('QuotaExceededError'); nativeSetItem.call(this, key, value); });
  host = document.createElement('div'); document.body.append(host);
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function paint() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); }); }
async function click(label: string) {
  for (let i = 0; i < 30; i++) {
    const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.getAttribute('aria-label') === label || item.textContent?.trim() === label);
    if (button) { await act(async () => button.click()); await paint(); return; }
    await paint();
  }
  throw Error('Missing action: ' + label);
}
async function open() { await act(async () => { root = createRoot(host); root.render(<App />); }); await click('打开设置验收'); const deadline = Date.now() + 5000; while (!document.querySelector('input[aria-label="工作区名称"]') && Date.now() < deadline) await paint(); expect(document.querySelector('input[aria-label="工作区名称"]')).toBeTruthy(); }
async function name(value: string) { const field = document.querySelector<HTMLInputElement>('input[aria-label="工作区名称"]'); expect(field).toBeTruthy(); await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value); field!.dispatchEvent(new Event('input', { bubbles: true })); }); }
const stored = () => JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY)!);
it('实际App持久化失败不谎报已保存，成功重试后名称和偏好同时落盘', async () => {
  await open(); const before = localStorage.getItem(WORKSPACE_STORAGE_KEY); await name('新客户名称'); failWrites = true;
  await click('保存设置'); expect(document.body.textContent).toContain('未能保存'); expect(guardedEditorSessions().some(session => session.kind === 'preferences' && session.getState().dirty)).toBe(true);
  expect(localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(before); expect(document.querySelector<HTMLInputElement>('[aria-label="工作区名称"]')?.value).toBe('新客户名称');
  failWrites = false; await click('重试保存'); expect(stored().workspaces.find((row: { id: string }) => row.id === 'settings-a').name).toBe('新客户名称'); expect(stored().preferencesByWorkspace['settings-a'].studioName).toBe('新客户名称');
  expect(guardedEditorSessions().filter(session => session.kind === 'preferences')).toEqual([]); expect(stored().preferencesByWorkspace['settings-b'].studioName).toBe('客户乙');
});
it('移除当前工作区前保护未保存设置，取消不切区，保存后才移除', async () => {
  await open(); await name('先保留这个名称');
  await click('切换工作区：客户甲'); await click('移除工作区：客户甲'); await click('移除工作区');
  expect(document.querySelector('[aria-label="设置尚未保存"]')).toBeTruthy(); expect(stored().activeWorkspaceId).toBe('settings-a');
  await click('返回设置'); expect(stored().workspaces.find((row: { id: string }) => row.id === 'settings-a').removedAt).toBeUndefined();
  await click('移除工作区'); await click('保存并继续');
  for (let i = 0; i < 30 && stored().activeWorkspaceId === 'settings-a'; i++) await paint();
  const value = stored(); expect(value.activeWorkspaceId).toBe('settings-b'); expect(value.workspaces.find((row: { id: string }) => row.id === 'settings-a')).toMatchObject({ name: '先保留这个名称', removedAt: expect.any(String) }); expect(value.preferencesByWorkspace['settings-a'].studioName).toBe('先保留这个名称');
});
