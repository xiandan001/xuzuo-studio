// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CredentialMetadata, StudioConfiguration } from '../configuration-types';
import type { PageProps } from '../types';
import { MODEL_CATALOG, MODEL_CATALOG_DATE } from '../model-catalog';
import catalogSnapshot from '../model-catalog-data.json';
import { useStudioConfiguration } from '../hooks/useStudioConfiguration';
import { CONFIGURATION_KEY, loadStoredConfiguration } from '../lib/configuration-storage';
import { studioCredential, studioModel } from '../lib/studio-run';
import { quickSetupEntries } from '../lib/quick-model-setup';
import { Models } from '../pages/Models';
import { QuickModelSetup } from './QuickModelSetup';

let root: Root | undefined, host: HTMLDivElement, current: StudioConfiguration;
const legacy = {
  connections: [{ id: 'legacy-openai', name: '旧版官方连接', providerId: 'openai', protocol: 'openai-responses', baseUrl: 'https://api.openai.com/v1', enabled: true, status: 'configured' }],
  models: [
    { id: 'legacy-sol', name: '保留原常用型号', modelId: 'gpt-6.1-sol', connectionId: 'legacy-openai', capabilities: ['text', 'vision'], enabled: true, pricing: { unit: 'million-tokens', currency: 'USD', input: '2', output: '8' } },
    { id: 'legacy-disabled', name: '保留原停用型号', modelId: 'gpt-6-luna', connectionId: 'legacy-openai', capabilities: ['text'], enabled: false, pricing: { unit: 'million-tokens', currency: 'USD', input: '0.5', output: '2' } },
  ],
  categories: [], workflows: [{ id: 'legacy-flow', workspaceId: 'legacy-workspace', name: '原工作流', description: '', outputKind: 'word', updatedAt: '2026-11-01T00:00:00Z', steps: [{ id: 'legacy-step', name: '原正文步骤', kind: 'text', prompt: '原要求', inputSource: 'project', enabled: true, modelConfigId: 'legacy-sol', credentialId: 'legacy-key' }] }], studioActions: [], useTemplates: [],
};
const legacyKeys: CredentialMetadata[] = [{ id: 'legacy-key', connectionId: 'legacy-openai', name: '旧版本机加密账户', lastFour: '1234', enabled: true, updatedAt: '2026-11-01T00:00:00Z' }];
const secretSave = vi.fn(async () => { throw Error('This upgrade must reuse credential metadata without reading or rewriting a secret'); });
let originalDesktop: typeof window.desktop;
beforeEach(() => {
  localStorage.clear(); localStorage.setItem(CONFIGURATION_KEY, JSON.stringify(legacy)); host = document.createElement('div'); document.body.append(host);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', vi.fn(() => { throw Error('No provider or network calls in model upgrade integration'); })); secretSave.mockClear();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  originalDesktop = window.desktop;
  Object.defineProperty(window, 'desktop', { configurable: true, value: { credentials: { status: async () => ({ available: true }), list: async () => structuredClone(legacyKeys), save: secretSave } } });
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.replaceChildren(); Object.defineProperty(window, 'desktop', { configurable: true, value: originalDesktop }); expect(fetch).not.toHaveBeenCalled(); expect(secretSave).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mounted(quick = false) {
  function Harness() {
    const configuration = useStudioConfiguration('legacy-workspace', vi.fn()); current = configuration;
    return quick ? <QuickModelSetup configuration={configuration} onClose={vi.fn()} onComplete={vi.fn()} /> : <Models {...{ workspaceId: 'legacy-workspace', configuration, notify: vi.fn(), workflowRunner: { runtimeStatus: { available: true } } } as unknown as PageProps} />;
  }
  root = createRoot(host); await act(async () => root!.render(<Harness />));
  await vi.waitFor(() => expect(current.credentials).toEqual(legacyKeys));
}
async function click(label: string, scope: ParentNode = document) {
  const button = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label); expect(button).toBeTruthy(); await act(async () => button!.click());
}
async function fill(label: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!; expect(input).toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}
function unchangedLegacy() {
  const stored = loadStoredConfiguration(localStorage); expect(stored.issue).toBeUndefined();
  expect(stored.state.connections).toEqual(legacy.connections); expect(stored.state.workflows).toEqual(legacy.workflows);
  expect(stored.state.models.slice(0, legacy.models.length)).toEqual(legacy.models); expect(current.credentials).toEqual(legacyKeys);
  expect(studioModel(current.models, 'legacy-sol')?.modelId).toBe('gpt-6.1-sol'); expect(studioCredential(current.credentials, 'legacy-openai', 'legacy-key')).toBe('legacy-key');
}
it.each(['gpt-6.2-astra', 'gpt-6.2-sol'])('旧2.11.0配置升级后目录可见%s，只在手动选择并保存时添加，原型号/停用状态/账户/流程保持', async modelId => {
  const before = localStorage.getItem(CONFIGURATION_KEY); await mounted(); expect(MODEL_CATALOG_DATE).toBe(catalogSnapshot.checkedAt); expect(localStorage.getItem(CONFIGURATION_KEY)).toBe(before); unchangedLegacy();
  const entry = MODEL_CATALOG.find(item => item.providerId === 'openai' && item.modelId === modelId)!; expect(entry).toBeTruthy();
  const catalogOrder = MODEL_CATALOG.map(item => item.id); await click('浏览模型目录');
  for (const name of ['GPT-6.2 Astra', 'GPT-6.2 Sol']) expect(document.querySelector(`[aria-label="目录模型 ${name}"]`)).toBeTruthy();
  expect(MODEL_CATALOG.map(item => item.id)).toEqual(catalogOrder); await fill('搜索模型目录', modelId);
  const card = document.querySelector<HTMLElement>(`[aria-label="目录模型 ${entry.name}"]`)!; expect(card).toBeTruthy(); expect(card.textContent).toContain(modelId); await click('选择使用', card);
  expect(document.querySelector<HTMLInputElement>('[aria-label="模型 ID"]')?.value).toBe(modelId); expect(localStorage.getItem(CONFIGURATION_KEY)).toBe(before); expect(current.models).toHaveLength(legacy.models.length);
  await act(async () => document.querySelector<HTMLFormElement>('#mdl-model-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await vi.waitFor(() => expect(current.models).toHaveLength(legacy.models.length + 1)); unchangedLegacy();
  const added = current.models.at(-1)!; expect(added).toMatchObject({ modelId, connectionId: 'legacy-openai', enabled: true }); expect(added.id).not.toBe('legacy-sol'); expect(studioModel(current.models, added.id)?.modelId).toBe(modelId);
});
it('快捷接入列出Astra和Sol，由用户明确选用新型号并复用已有Key，不重建连接或覆盖原模型', async () => {
  const before = localStorage.getItem(CONFIGURATION_KEY); await mounted(true); expect(localStorage.getItem(CONFIGURATION_KEY)).toBe(before);
  for (const modelId of ['gpt-6.2-astra', 'gpt-6.2-sol']) expect(quickSetupEntries('openai').some(entry => entry.modelId === modelId)).toBe(true);
  await click('下一步'); expect(document.querySelector('input[type="password"]')).toBeNull(); await click('下一步');
  const trigger = document.querySelector<HTMLButtonElement>('[aria-label="快速接入文字模型"]')!;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) { return this === trigger ? { x: 0, y: 40, left: 0, top: 40, right: 320, bottom: 84, width: 320, height: 44, toJSON: () => ({}) } : { x: 0, y: 0, left: 0, top: 0, right: 1024, bottom: 768, width: 1024, height: 768, toJSON: () => ({}) }; });
  await act(async () => trigger.click());
  const options = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')];
  for (const name of ['GPT-6.2 Astra', 'GPT-6.2 Sol']) expect(options.some(option => option.textContent?.includes(name) && !option.disabled), options.map(option => option.textContent).join(", ")).toBe(true);
  const chosen = options.find(option => option.textContent?.includes('GPT-6.2 Sol'))!; await act(async () => chosen.click()); expect(localStorage.getItem(CONFIGURATION_KEY)).toBe(before);
  await click('保存并完成接入'); await vi.waitFor(() => expect(document.body.textContent).toContain('已接入，可以开始使用')); unchangedLegacy();
  expect(current.models).toHaveLength(legacy.models.length + 1); expect(current.models.at(-1)?.modelId).toBe('gpt-6.2-sol'); expect(current.connections).toHaveLength(1); expect(current.credentials).toHaveLength(1);
});
