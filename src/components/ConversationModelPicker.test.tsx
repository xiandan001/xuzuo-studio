// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { StudioConfiguration } from '../configuration-types';
import type { NaturalBinding } from './NaturalAutomationModels';
import { ConversationModelPicker } from './ConversationModelPicker';

let root: Root, host: HTMLDivElement;
const changed = vi.fn(), manage = vi.fn();
function configuration(count = 1): StudioConfiguration {
  return { models: [{ id: 'model', name: '日常对话', modelId: 'gpt-5.2', connectionId: 'service', enabled: true, capabilities: ['text'] }], connections: [{ id: 'service', name: '我的服务商', providerId: 'openai', protocol: 'openai-chat', enabled: true, baseUrl: 'https://service.invalid/v1?secret=hidden' }], credentials: Array.from({ length: count }, (_, index) => ({ id: `key-${index}`, connectionId: 'service', name: `账户${index + 1}`, lastFour: `100${index}`, enabled: true })) } as unknown as StudioConfiguration;
}
function Picker({ count = 1, disabled = false }: { count?: number; disabled?: boolean }) {
  const [value, setValue] = useState<NaturalBinding>({ modelConfigId: 'model', credentialId: 'key-0', reasoningEffort: 'high' });
  return <ConversationModelPicker configuration={configuration(count)} value={value} disabled={disabled} onChange={next => { changed(next); setValue(next); }} onManage={manage} />;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); changed.mockReset(); manage.mockReset();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 10, y: 10, left: 10, top: 10, right: 310, bottom: 50, width: 300, height: 40, toJSON: () => ({}) });
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function show(count = 1, disabled = false) { await act(async () => root.render(<Picker count={count} disabled={disabled} />)); }
async function click(label: string) { const node = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === label || button.textContent?.trim() === label); expect(node).toBeTruthy(); await act(async () => { node!.focus(); node!.click(); }); await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); }); }
it('输入区保持模型与思考可选，单账户详情按需打开且不暴露地址认证内容', async () => {
  await show(); expect(host.querySelector('[aria-label="对话模型"]')).toBeTruthy(); expect(host.querySelector('[aria-label="推理强度"]')).toBeTruthy(); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(host.querySelector('.conversation-account-summary')).toBeNull();
  await click('模型与账户详情'); expect(document.body.textContent).toContain('账户1'); expect(document.body.textContent).toContain('gpt-5.2'); expect(document.body.textContent).not.toContain('secret=hidden'); expect(document.querySelector('[aria-label="对话Key"]')).toBeNull(); expect(changed).not.toHaveBeenCalled();
  await click('完成'); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(changed).not.toHaveBeenCalled();
});
it('多账户可在模型面板切换，保留所选模型和思考强度', async () => {
  await show(2); await click('模型与账户详情'); await click('对话Key');
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(node => node.textContent?.includes('账户2')); expect(option).toBeTruthy(); await act(async () => option!.click());
  expect(changed).toHaveBeenLastCalledWith({ modelConfigId: 'model', credentialId: 'key-1', reasoningEffort: 'high' }); await click('完成'); expect(host.querySelector('[aria-label="模型与账户详情"]')!.getAttribute('title')).toContain('账户2');
});
it('处理中锁定设置；打开详情后Esc只关闭面板，不发起模型调用', async () => {
  await show(1, true); expect(host.querySelector<HTMLButtonElement>('[aria-label="模型与账户详情"]')!.disabled).toBe(true); await show(); await click('模型与账户详情');
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(changed).not.toHaveBeenCalled(); expect(manage).not.toHaveBeenCalled();
});
it('管理账户入口关闭本轮面板，再导航，不修改绑定', async () => { await show(); await click('模型与账户详情'); await click('管理模型与账户'); expect(manage).toHaveBeenCalledTimes(1); expect(changed).not.toHaveBeenCalled(); expect(document.querySelector('[role="dialog"]')).toBeNull(); });
