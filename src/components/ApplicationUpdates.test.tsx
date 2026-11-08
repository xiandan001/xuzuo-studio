import { afterEach, describe, expect, it, vi } from 'vitest';
import { isValidElement } from 'react';
import type { ChangeEvent, InputHTMLAttributes, ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AppUpdateBridge, AppUpdateStatus } from '../update-types';
import { ApplicationUpdates } from './ApplicationUpdates';

const hooks = vi.hoisted(() => {
  const slots: unknown[] = []; let cursor = 0, effect: (() => void | (() => void)) | undefined, cleanup: (() => void) | undefined;
  return {
    reset() { slots.length = 0; cursor = 0; effect = undefined; cleanup = undefined; },
    render() { cursor = 0; },
    useState(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], (value: unknown) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(action: () => void | (() => void)) { effect ||= action; },
    mount() { cleanup = effect?.() || undefined; },
    unmount() { cleanup?.(); cleanup = undefined; },
  };
});
vi.mock('react', async importOriginal => ({ ...await importOriginal<typeof import('react')>(), useState: hooks.useState, useRef: hooks.useRef, useEffect: hooks.useEffect }));

function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const status = (changes: Partial<AppUpdateStatus> = {}): AppUpdateStatus => ({ available: true, enabled: true, phase: 'idle', currentVersion: '1.0.0', ...changes });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function inputIn(node: ReactNode): ReactElement<InputHTMLAttributes<HTMLInputElement>> | undefined {
  if (Array.isArray(node)) return node.map(inputIn).find(Boolean);
  if (!isValidElement<{ children?: ReactNode }>(node)) return undefined;
  return node.type === 'input' ? node as ReactElement<InputHTMLAttributes<HTMLInputElement>> : inputIn(node.props.children);
}
function buttonIn(node: ReactNode): ReactElement<{ onClick: () => void; children?: ReactNode }> | undefined {
  if (Array.isArray(node)) return node.map(buttonIn).find(Boolean);
  if (!isValidElement<{ onClick: () => void; children?: ReactNode }>(node)) return undefined;
  return node.type === 'button' ? node : buttonIn(node.props.children);
}
function fixture(initial: Promise<AppUpdateStatus> = Promise.resolve(status()), platform = 'win32') {
  hooks.reset(); let listener: ((value: AppUpdateStatus) => void) | undefined, tree: ReactElement;
  const unsubscribe = vi.fn(), bridge: AppUpdateBridge = { openDownloads: vi.fn(async () => undefined), status: vi.fn(() => initial), setEnabled: vi.fn(async enabled => status({ enabled, phase: enabled ? 'idle' : 'disabled' })), onStatus: vi.fn(action => { listener = action; return unsubscribe; }) };
  vi.stubGlobal('window', { desktop: { updates: bridge, platform } });
  const render = () => { hooks.render(); tree = ApplicationUpdates(); return renderToStaticMarkup(tree); };
  render(); hooks.mount();
  return { bridge, unsubscribe, render, downloads: () => { render(); buttonIn(tree)!.props.onClick(); }, emit: (value: AppUpdateStatus) => listener!(value), change: (checked: boolean) => { render(); inputIn(tree)!.props.onChange!({ currentTarget: { checked } } as ChangeEvent<HTMLInputElement>); } };
}
afterEach(() => { hooks.unmount(); vi.unstubAllGlobals(); });

describe('应用自动更新设置', () => {
  it('macOS 使用 DMG 更新引导，不展示 Windows 自动更新承诺或开关', async () => {
    const f = fixture(Promise.resolve(status({ available: false, enabled: false, phase: 'unavailable', message: '使用新版 DMG 替换应用。' })), 'darwin');
    await flush(); const html = f.render();
    expect(html).toContain('DMG'); expect(html).toContain('GitHub Releases'); expect(html).toContain('Finder');
    expect(html).not.toContain('type="checkbox"'); expect(html).not.toContain('默认开启'); expect(html).not.toContain('每 2 小时');
    expect(html).toContain('打开下载页面'); f.downloads(); await flush();
    expect(f.bridge.openDownloads).toHaveBeenCalledOnce(); expect(f.bridge.setEnabled).not.toHaveBeenCalled();
  });
  it('使用具名原生勾选框，说明全局即时保存和两小时检查', async () => {
    const f = fixture(); await flush(); const html = f.render();
    expect(html).toContain('type="checkbox"'); expect(html).toContain('自动更新'); expect(html).toContain('checked=""');
    expect(html).toContain('全部工作区'); expect(html).toContain('立即生效'); expect(html).toContain('每 2 小时');
    expect(html).toContain('v1.0.0'); expect(html).not.toContain('<form');
  });
  it('切换时直接保存应用级布尔值，并等待已保存状态', async () => {
    const f = fixture(); await flush(); f.change(false); await flush();
    expect(f.bridge.setEnabled).toHaveBeenCalledExactlyOnceWith(false);
    expect(f.render()).not.toContain('checked=""'); expect(f.render()).toContain('自动更新已关闭');
  });
  it('保存失败后保留最后确认的勾选状态并显示错误', async () => {
    const f = fixture(); await flush(); vi.mocked(f.bridge.setEnabled).mockRejectedValueOnce(new Error('保存失败'));
    f.change(false); await flush(); const html = f.render();
    expect(html).toContain('checked=""'); expect(html).toContain('保存失败'); expect(html).toContain('role="alert"');
  });
  it('先收到的新状态不会被较晚的初始读取覆盖', async () => {
    const pending = deferred<AppUpdateStatus>(), f = fixture(pending.promise);
    f.emit(status({ phase: 'ready', version: '1.0.1' })); pending.resolve(status()); await flush();
    expect(f.render()).toContain('v1.0.1'); expect(f.render()).toContain('退出应用后自动更新');
  });
  it('保存期间的新事件不会被过期的保存响应覆盖', async () => {
    const f = fixture(); await flush(); const saving = deferred<AppUpdateStatus>(); vi.mocked(f.bridge.setEnabled).mockReturnValueOnce(saving.promise);
    f.change(false); f.emit(status({ enabled: false, phase: 'error', message: '下载已停止' }));
    saving.resolve(status({ enabled: false, phase: 'disabled' })); await flush();
    expect(f.render()).toContain('下载已停止');
  });
  it('显示下载进度，卸载组件时取消订阅并忽略迟到回包', async () => {
    const pending = deferred<AppUpdateStatus>(), f = fixture(pending.promise);
    f.emit(status({ phase: 'downloading', version: '1.0.1', progress: 37.4 }));
    const html = f.render(); expect(html).toContain('37%'); expect(html).toContain('value="37"'); expect(html).toContain('max="100"');
    hooks.unmount(); expect(f.unsubscribe).toHaveBeenCalledOnce();
    pending.resolve(status({ enabled: false, phase: 'disabled' })); await flush();
    expect(f.render()).toContain('37%');
  });
  it('浏览器预览禁用更新控件并解释需要正式安装版', () => {
    hooks.reset(); vi.stubGlobal('window', {}); hooks.render(); const html = renderToStaticMarkup(ApplicationUpdates()); hooks.mount();
    expect(html).toContain('disabled=""'); expect(html).toContain('正式安装版'); expect(html).not.toContain('checked=""');
  });
});
