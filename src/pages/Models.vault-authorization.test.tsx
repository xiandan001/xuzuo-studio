// @vitest-environment jsdom
// All bridge functions are local mocks. This suite never loads Electron or system storage.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageProps } from '../types';
import type { VaultStatus } from '../configuration-types';
import { Models } from './Models';

const mounted: { host: HTMLDivElement; root: Root }[] = [];
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('This fixture must not access the network.'); }));
});
afterEach(async () => {
  for (const { host, root } of mounted.splice(0)) { await act(async () => root.unmount()); host.remove(); }
  localStorage.clear(); vi.unstubAllGlobals();
});

async function mount(vaultStatus: VaultStatus) {
  const refreshCredentials = vi.fn(async () => undefined), saveCredential = vi.fn(), setCredentialEnabled = vi.fn();
  const props = {
    configuration: {
      vaultStatus, connections: [{ id: 'fixture-connection', name: '仅界面测试', providerId: 'custom', protocol: 'openai-chat', baseUrl: 'https://example.invalid/v1', enabled: true, status: 'configured' }],
      models: [], credentials: [], refreshCredentials, saveCredential, setCredentialEnabled,
    },
    workflowRunner: { runtimeStatus: { available: false } }, notify: vi.fn(),
  } as unknown as PageProps;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); mounted.push({ host, root });
  await act(async () => root.render(<Models {...props} />));
  await act(async () => host.querySelector<HTMLButtonElement>('.mdl-tabs button:last-child')!.click());
  return { host, root, props, refreshCredentials, saveCredential, setCredentialEnabled };
}

describe('vault authorization status presentation', () => {
  it('explains deferred macOS authorization without claiming the vault is already authorized', async () => {
    const reason = '保存或使用密钥时，macOS 将按需请求钥匙串授权。';
    const f = await mount({ available: true, requiresAuthorization: true, reason });
    const banner = f.host.querySelector('.mdl-vault-banner')!;
    expect(banner.querySelector('h2')!.textContent).toBe('使用时验证系统加密');
    expect(banner.textContent).toContain(reason); expect(banner.textContent).not.toContain('桌面密钥库可用');
    expect(banner.classList.contains('is-available')).toBe(false);
    await act(async () => banner.querySelector<HTMLButtonElement>('button')!.click());
    expect(f.refreshCredentials).toHaveBeenCalledOnce(); expect(f.saveCredential).not.toHaveBeenCalled(); expect(f.setCredentialEnabled).not.toHaveBeenCalled();
    const add = [...f.host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '添加 API Key')!;
    await act(async () => add.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('保存或使用密钥时由 macOS 按需授权');
    expect(dialog.textContent).toContain('保存时验证系统加密'); expect(dialog.textContent).not.toContain('由操作系统保护');
    expect(dialog.querySelector<HTMLInputElement>('[aria-label="API Key 密钥"]')!.disabled).toBe(false);
    expect(f.saveCredential).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('provides an authorization explanation when the backend omits its optional reason', async () => {
    const f = await mount({ available: true, requiresAuthorization: true });
    expect(f.host.querySelector('.mdl-vault-banner')!.textContent).toContain('macOS 将按需请求钥匙串授权');
  });
  it('retains confirmed vault and unavailable-browser states', async () => {
    const f = await mount({ available: true });
    expect(f.host.querySelector('.mdl-vault-banner h2')!.textContent).toBe('桌面密钥库可用');
    expect(f.host.querySelector('.mdl-vault-banner')!.classList.contains('is-available')).toBe(true);
    await act(async () => f.root.render(<Models {...f.props} configuration={{ ...f.props.configuration, vaultStatus: { available: false, requiresAuthorization: true, reason: '系统加密接口不可用' } }} />));
    expect(f.host.querySelector('.mdl-vault-banner h2')!.textContent).toBe('此预览不接收真实密钥');
    expect(f.host.querySelector('.mdl-vault-banner')!.textContent).toContain('系统加密接口不可用');
    expect(f.host.textContent).not.toContain('使用时验证系统加密'); expect(fetch).not.toHaveBeenCalled();
  });
});
