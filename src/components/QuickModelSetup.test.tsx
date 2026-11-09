// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CredentialMetadata, ModelConfiguration, ModelConnection, StudioConfiguration } from '../configuration-types';
import { quickSetupConnections, quickSetupEntries } from '../lib/quick-model-setup';
import { QuickModelSetup } from './QuickModelSetup';

let root: Root | undefined, host: HTMLDivElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); vi.stubGlobal('fetch', vi.fn(() => { throw Error('No network in quick setup'); })); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host.remove(); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
async function click(label: string) { const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.includes(label)); expect(button).toBeTruthy(); await act(async () => button!.click()); }
async function input(label: string, text: string) { const field = document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!; expect(field).toBeTruthy(); await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, text); field.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function render(options: { existing?: boolean; failKey?: boolean } = {}) {
  const text = quickSetupEntries('openai').find(entry => entry.capabilities.includes('text'))!;
  const connection = { ...quickSetupConnections([text], [])[0].connection, id: 'connection' };
  const savedConnections = vi.fn(), savedKeys = vi.fn(), savedModels = vi.fn(), complete = vi.fn();
  let snapshot: Pick<StudioConfiguration, 'connections' | 'models' | 'credentials'>;
  function Harness() {
    const [connections, setConnections] = useState<ModelConnection[]>(options.existing ? [connection] : []), [models, setModels] = useState<ModelConfiguration[]>([]), [credentials, setCredentials] = useState<CredentialMetadata[]>(options.existing ? [{ id: 'key', name: '已有 Key', connectionId: connection.id, lastFour: '1234', enabled: true, updatedAt: '' }] : []);
    snapshot = { connections, models, credentials };
    const config = { ...snapshot, vaultStatus: { available: true }, saveConnection(draft) { savedConnections(draft); setConnections(old => [...old, { ...draft, id: `connection-${old.length}`, status: 'configured' }]); return true; }, async saveCredential(draft) { savedKeys(draft); if (options.failKey) return false; setCredentials(old => [...old, { id: `key-${old.length}`, name: draft.name, connectionId: draft.connectionId, enabled: true, lastFour: '1234', updatedAt: '' }]); return true; }, saveModel(draft) { savedModels(draft); setModels(old => [...old, { ...draft, id: `model-${old.length}` }]); return true; } } as StudioConfiguration;
    return <QuickModelSetup configuration={config} onClose={vi.fn()} onComplete={complete} />;
  }
  await act(async () => { root = createRoot(host); root.render(<Harness />); });
  return { savedConnections, savedKeys, savedModels, complete, current: () => snapshot! };
}
describe('快速接入真实操作路径', () => {
  it('没有Key时不能跳过；文字和图片一次接入复用连接，完成后清空明文输入', async () => {
    const f = await render(); await click('下一步');
    expect([...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('下一步'))?.disabled).toBe(true);
    await input('快速接入API Key', 'fixture-secret-do-not-display'); await click('下一步');
    const image = [...document.querySelectorAll('label')].find(label => label.textContent?.includes('图片生成与编辑'))!.querySelector<HTMLInputElement>('input')!;
    await act(async () => image.click()); await click('保存并完成接入');
    await vi.waitFor(() => expect(document.body.textContent).toContain('已接入，可以开始使用'));
    expect(f.savedConnections).toHaveBeenCalledTimes(1); expect(f.savedKeys).toHaveBeenCalledTimes(1); expect(f.savedModels).toHaveBeenCalledTimes(2);
    expect(document.querySelector('input[type=password]')).toBeNull(); expect(document.body.textContent).not.toContain('fixture-secret-do-not-display');
    expect(f.current().credentials).toHaveLength(1); expect(localStorage.getItem('fixture-secret-do-not-display')).toBeNull();
  });
  it('已有同站点Key时直接复用，保持原连接和Key，不要求再次填写', async () => {
    const f = await render({ existing: true }); await click('下一步');
    expect(document.querySelector('input[type=password]')).toBeNull(); await click('下一步'); await click('保存并完成接入');
    await vi.waitFor(() => expect(document.body.textContent).toContain('已接入，可以开始使用'));
    expect(f.savedConnections).not.toHaveBeenCalled(); expect(f.savedKeys).not.toHaveBeenCalled(); expect(f.savedModels).toHaveBeenCalledTimes(1);
  });
  it('Key保存失败时保留已建连接和输入，不假报完成，重试不重复建连接', async () => {
    const f = await render({ failKey: true }); await click('下一步'); await input('快速接入API Key', 'fixture-secret'); await click('下一步'); await click('保存并完成接入');
    await vi.waitFor(() => expect(document.querySelector('[role=alert]')?.textContent).toContain('未能加密保存'));
    expect(f.savedModels).not.toHaveBeenCalled(); expect(document.body.textContent).not.toContain('已接入，可以开始使用');
    await click('保存并完成接入'); await vi.waitFor(() => expect(f.savedKeys).toHaveBeenCalledTimes(2));
    expect(f.savedConnections).toHaveBeenCalledTimes(1); expect(f.current().connections).toHaveLength(1);
  });
});
