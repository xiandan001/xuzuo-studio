// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PerformanceSettings } from './PerformanceSettings';
import type { ApplicationPerformanceSnapshot } from '../performance-types';
let root: Root, host: HTMLDivElement;
const snapshot = (lowResource = false): ApplicationPerformanceSnapshot => ({ lowResource, pending: 0, recent: [], measuredAt: '2026-11-17T10:00:00Z' });
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); delete window.desktop; vi.unstubAllGlobals(); });
it('只在进入或明确刷新时读取，切换成功即时保存无需第二个保存步骤', async () => {
  const read = vi.fn(async () => snapshot()), save = vi.fn(async ({ lowResource }: { lowResource: boolean }) => snapshot(lowResource)); window.desktop = { performance: { read, save } } as unknown as typeof window.desktop;
  await act(async () => root.render(<PerformanceSettings />)); expect(read).toHaveBeenCalledTimes(1);
  const toggle = host.querySelector<HTMLButtonElement>('[role="switch"]')!; await act(async () => toggle.click()); expect(save).toHaveBeenCalledWith({ lowResource: true }); expect(toggle.getAttribute('aria-checked')).toBe('true'); expect(read).toHaveBeenCalledTimes(1);
  await act(async () => new Promise(resolve => setTimeout(resolve, 30))); expect(read).toHaveBeenCalledTimes(1);
});
it('写入失败保留真实旧状态，重试沿用用户选择而非误存回原状态', async () => {
  const save = vi.fn().mockRejectedValueOnce(Error('磁盘暂不可写')).mockResolvedValueOnce(snapshot(true)); window.desktop = { performance: { read: async () => snapshot(), save } } as unknown as typeof window.desktop;
  await act(async () => root.render(<PerformanceSettings />)); const toggle = host.querySelector<HTMLButtonElement>('[role="switch"]')!;
  await act(async () => toggle.click()); expect(toggle.getAttribute('aria-checked')).toBe('false'); expect(host.textContent).toContain('磁盘暂不可写');
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '重试')!.click()); expect(save.mock.calls.map(call => call[0])).toEqual([{ lowResource: true }, { lowResource: true }]); expect(toggle.getAttribute('aria-checked')).toBe('true');
});
it('缺少桌面桥时不假装开启性能模式', async () => {
  delete window.desktop; await act(async () => root.render(<PerformanceSettings />)); expect(host.querySelector<HTMLButtonElement>('[role="switch"]')!.disabled).toBe(true); expect(host.textContent).toContain('最新版桌面应用');
});
