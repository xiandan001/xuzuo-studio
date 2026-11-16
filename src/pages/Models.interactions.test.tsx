// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CredentialMetadata, ModelConfiguration, ModelConnection } from '../configuration-types';
import type { PageProps } from '../types';
import { catalogModelDraft } from '../model-catalog';
import { quickSetupConnections, quickSetupEntries } from '../lib/quick-model-setup';
import { Models } from './Models';

let root: Root | undefined, host: HTMLDivElement;
beforeEach(() => { localStorage.clear(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', vi.fn(() => { throw Error('No network in model UI tests'); })); host = document.createElement('div'); document.body.append(host); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.replaceChildren(); expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function mounted(ready = true) {
  const entry = quickSetupEntries('openai').find(item => item.capabilities.includes('text'))!;
  const connection = { ...quickSetupConnections([entry], [])[0].connection, id: 'connection', name: '已有账户连接' } as ModelConnection;
  const calls = { connection: vi.fn(), model: vi.fn(), credential: vi.fn(), check: vi.fn(), notify: vi.fn() };
  function Harness({ workspaceId }: { workspaceId: string }) {
    const [connections, setConnections] = useState<ModelConnection[]>([connection]);
    const [models, setModels] = useState<ModelConfiguration[]>(ready ? [{ ...catalogModelDraft(entry, connection), id: 'model', name: '已有文字模型' }] : []);
    const [credentials] = useState<CredentialMetadata[]>([{ id: 'key', connectionId: connection.id, name: '已有账户', enabled: true, lastFour: '1234', updatedAt: '' }]);
    const configuration = { connections, models, credentials, vaultStatus: { available: true },
      saveConnection(draft: Omit<ModelConnection, 'id' | 'status'>, id?: string) { calls.connection(draft, id); setConnections(old => [...old.filter(item => item.id !== id), { ...draft, id: id || 'new-connection', status: 'configured' }]); return true; },
      saveModel(draft: Omit<ModelConfiguration, 'id'>, id?: string) { calls.model(draft, id); setModels(old => [...old.filter(item => item.id !== id), { ...draft, id: id || 'new-model' }]); return true; },
      saveCredential: calls.credential, checkConnection: calls.check, setModelEnabled: vi.fn(), setConnectionEnabled: vi.fn(), setCredentialEnabled: vi.fn(), refreshCredentials: vi.fn(async () => {}) };
    return <Models {...{ workspaceId, configuration, workflowRunner: { runtimeStatus: { available: true } }, notify: calls.notify } as unknown as PageProps} />;
  }
  root = createRoot(host); const render = async (workspaceId = 'models-workspace') => act(async () => root!.render(<Harness workspaceId={workspaceId} />)); await render();
  return { calls, render };
}
function button(scope: ParentNode, label: string) { const value = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(node => node.getAttribute('aria-label') === label || node.textContent?.trim() === label); if (!value) throw Error('Missing button ' + label); return value; }
async function click(scope: ParentNode, label: string) { await act(async () => button(scope, label).click()); }
async function fill(label: string, value: string) { const input = document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!; expect(input).toBeTruthy(); await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }); }
const management = () => host.querySelector('[aria-label="高级模型管理内容"]');

it('首屏只保留接入主操作，高级列表真正折叠并按工作区记忆', async () => {
  const ui = await mounted(); expect(host.querySelector('h1')?.textContent).toBe('模型与账户');
  expect([...host.querySelectorAll('.btn-primary')].map(node => node.textContent?.trim())).toEqual(['接入新模型']);
  expect(management()).toBeNull(); expect(host.querySelector('[aria-label="搜索模型与连接"]')).toBeNull();
  await click(host, '高级模型管理'); expect(management()).not.toBeNull(); expect(host.querySelector('[aria-label="搜索模型与连接"]')).not.toBeNull();
  expect([...host.querySelectorAll('.btn-primary')].map(node => node.textContent?.trim())).toEqual(['接入新模型']);
  await ui.render('another-model-workspace'); expect(management()).toBeNull();
  await ui.render(); expect(management()).not.toBeNull();
  expect(ui.calls.connection).not.toHaveBeenCalled(); expect(ui.calls.credential).not.toHaveBeenCalled(); expect(ui.calls.model).not.toHaveBeenCalled(); expect(ui.calls.check).not.toHaveBeenCalled();
});

it('收起高级列表不会卸载已打开的连接弹窗或丢掉输入，保存后显示对应列表', async () => {
  const ui = await mounted(); await click(host, '高级模型管理'); await click(host.querySelector('.mdl-management-heading')!, '添加连接');
  await fill('连接名称', '保留的连接草稿');
  await click(host, '高级模型管理'); expect(management()).toBeNull();
  const dialog = document.querySelector('[aria-label="添加服务连接"]')!; expect(dialog).toBeTruthy(); expect(dialog.querySelector<HTMLInputElement>('[aria-label="连接名称"]')!.value).toBe('保留的连接草稿');
  await act(async () => document.querySelector<HTMLFormElement>('#mdl-connection-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(ui.calls.connection).toHaveBeenCalledWith(expect.objectContaining({ name: '保留的连接草稿' }), undefined);
  expect(document.querySelector('[aria-label="添加服务连接"]')).toBeNull(); expect(management()).not.toBeNull(); expect(host.querySelector('.mdl-card-grid')?.textContent).toContain('保留的连接草稿');
  expect(ui.calls.check).not.toHaveBeenCalled(); expect(ui.calls.credential).not.toHaveBeenCalled();
});

it('目录和手动型号弹窗在折叠区外，选择手动填写后展开模型管理且不自动保存', async () => {
  const ui = await mounted(); await click(host, '浏览模型目录'); expect(management()).toBeNull();
  const catalog = document.querySelector('[aria-label="选择官方模型"]')!; expect(catalog).toBeTruthy(); await click(catalog, '手动填写');
  expect(management()).not.toBeNull(); expect(host.querySelector('.mdl-tabs .active')?.textContent).toContain('模型配置'); expect(document.querySelector('[aria-label="添加模型配置"]')).not.toBeNull();
  await click(host, '高级模型管理'); expect(document.querySelector('[aria-label="添加模型配置"]')).not.toBeNull();
  expect(ui.calls.model).not.toHaveBeenCalled(); expect(ui.calls.check).not.toHaveBeenCalled();
});

it('真实快速接入组件复用已有Key，完成后自动展开模型列表', async () => {
  const ui = await mounted(false); await click(host, '快速接入'); await click(document, '下一步'); await click(document, '下一步'); await click(document, '保存并完成接入');
  expect(document.body.textContent).toContain('已接入，可以开始使用'); await click(document, '开始使用');
  expect(management()).not.toBeNull(); expect(host.querySelector('.mdl-tabs .active')?.textContent).toContain('模型配置'); expect(host.querySelector('.mdl-model-list')).not.toBeNull();
  expect(ui.calls.model).toHaveBeenCalledTimes(1); expect(ui.calls.connection).not.toHaveBeenCalled(); expect(ui.calls.credential).not.toHaveBeenCalled(); expect(ui.calls.check).not.toHaveBeenCalled();
  expect(document.querySelector('input[type="password"]')).toBeNull();
});
