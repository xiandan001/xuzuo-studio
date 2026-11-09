// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatScenarioPicker } from './ChatScenarioPicker';
import { availableChatScenarios } from '../lib/chat-scenarios';

let root: Root | undefined, host: HTMLDivElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); vi.stubGlobal('fetch', vi.fn(() => { throw Error('Choosing a scene cannot call a model'); })); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host.remove(); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
async function click(label: string) { const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === label || button.textContent?.trim() === label); expect(button).toBeTruthy(); await act(async () => button!.click()); }
async function render(value = 'chat-default', disabled = false) {
  const select = vi.fn(); await act(async () => { root = createRoot(host); root.render(<ChatScenarioPicker scenarios={availableChatScenarios('workspace')} value={value} disabled={disabled} onSelect={select} />); }); return select;
}
describe('输入区使用场景选择', () => {
  it('只选择场景而不发送，专用工具与参考要求清楚展示', async () => {
    const select = await render(); await click('选择使用场景'); expect(document.querySelector('[role=dialog]')).toBeTruthy(); expect(select).not.toHaveBeenCalled();
    await click('图片'); expect(document.body.textContent).toContain('专用工作台'); expect(document.body.textContent).toContain('需 1 张参考图');
    await click('使用场景 工程P图'); expect(select).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'image-engineering', entry: 'image-workbench', imagePreset: '工程P图', minImageReferences: 1 })); expect(document.querySelector('[role=dialog]')).toBeNull();
  });
  it('支持搜索、空结果和一键恢复全部列表，不使用原生select', async () => {
    await render(); await click('选择使用场景'); const field = document.querySelector<HTMLInputElement>('[aria-label="搜索使用场景"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, '不存在的场景'); field.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(document.body.textContent).toContain('没有找到相关场景'); await click('查看全部'); expect(document.querySelector('[aria-label="使用场景 壁纸"]')).toBeTruthy(); expect(document.querySelector('select')).toBeNull();
  });
  it('取消不改变已选用途，禁用时不能打开选择面板', async () => {
    const select = await render('image-gif'); expect(host.textContent).toContain('GIF动画工坊'); await click('选择使用场景'); await click('关闭使用场景'); expect(select).not.toHaveBeenCalled();
    await act(async () => { root!.render(<ChatScenarioPicker scenarios={availableChatScenarios('workspace')} value="chat-default" disabled onSelect={select} />); });
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="选择使用场景"]')!; expect(trigger.disabled).toBe(true); await act(async () => trigger.click()); expect(document.querySelector('[role=dialog]')).toBeNull();
  });
});
