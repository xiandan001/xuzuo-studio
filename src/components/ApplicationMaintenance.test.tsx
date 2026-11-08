// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { DesktopBridge } from '../types';
import { ApplicationMaintenance } from './ApplicationMaintenance';

afterEach(() => { delete window.desktop; document.body.replaceChildren(); vi.unstubAllGlobals(); });
it('shows Finder guidance on macOS and never offers the Windows maintenance executable', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const openUninstall = vi.fn(), status = vi.fn(async () => ({ available: false, reason: 'macOS 使用 DMG 安装。' }));
  window.desktop = { platform: 'darwin', maintenance: { status, openUninstall } } as unknown as DesktopBridge;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => { root.render(<ApplicationMaintenance />); });
    expect(status).toHaveBeenCalledOnce(); expect(host.textContent).toContain('Finder'); expect(host.textContent).toContain('废纸篓');
    expect(host.textContent).toContain('本地加密密钥会保留'); expect(host.querySelector('button')).toBeNull(); expect(openUninstall).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); }
});
