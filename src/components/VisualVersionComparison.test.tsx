// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PresentationEditorDocument } from '../editor-types';
import { DocumentVisualComparison, ImageCompareSurface } from './VisualVersionComparison';
let root: Root | undefined, host: HTMLDivElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }); vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 300, bottom: 40, x: 0, y: 0, width: 300, height: 40, toJSON: () => ({}) }); host = document.createElement('div'); document.body.append(host); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function click(label: string) { const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === label || button.textContent?.trim() === label); expect(button).toBeTruthy(); await act(async () => button!.click()); }
const preview = { mimeType: 'image/png', dataUrl: 'data:image/png;base64,aGVsbG8=' };
describe('按需可视化版本对比', () => {
  it('图片并排和滑杆只读所选两张，切换/拖动不重新调用读取或模型', async () => {
    const read = vi.fn(async () => preview);
    await act(async () => { root = createRoot(host); root.render(<ImageCompareSurface firstId="first" secondId="second" read={read} />); });
    expect(read).toHaveBeenCalledTimes(2); expect(host.querySelectorAll('img')).toHaveLength(2);
    await click('滑杆对照'); expect(host.querySelector('[aria-label="版本分界位置"]')).toBeTruthy();
    const field = host.querySelector<HTMLInputElement>('[aria-label="版本分界位置"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, '25'); field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(host.querySelector<HTMLElement>('.vvc-slider-top')!.style.clipPath).toMatch(/^inset\(0(?:px)? 75% 0(?:px)? 0(?:px)?\)$/); expect(read).toHaveBeenCalledTimes(2); await click('并排查看'); expect(read).toHaveBeenCalledTimes(2);
  });
  it('四十页PPT只渲染当前页两份内容/插图，缩略摘要限制十页', async () => {
    const read = vi.fn(async () => preview); Object.defineProperty(window, 'desktop', { configurable: true, value: { runtime: { thumbnailArtifact: read } } });
    const document: PresentationEditorDocument = { schemaVersion: 1, kind: 'ppt', title: '提案', theme: 'paper', slides: Array.from({ length: 40 }, (_, index) => ({ id: `slide-${index}`, title: `标题${index}`, body: `完整正文${index}`, notes: '', layout: 'image-right', fontSize: 20, align: 'left', imageId: `image-${index}` })) };
    const previous = { ...document, slides: document.slides.map(slide => ({ ...slide, body: `旧${slide.body}`, imageId: `old-${slide.imageId}` })) };
    await act(async () => { root = createRoot(host); root.render(<DocumentVisualComparison current={document} previous={previous} />); });
    expect(read).toHaveBeenCalledTimes(2); expect(host.querySelectorAll('.vvc-slide')).toHaveLength(2); expect(host.querySelector('.vvc-slide')!.textContent).toContain('完整正文0'); expect(host.querySelector('.vvc-slide')!.textContent).not.toContain('完整正文9');
    expect(host.querySelectorAll('.vvc-page-thumbnails button')).toHaveLength(12);
    await click('选择对比页面'); const ninth = [...documentElementButtons()].find(button => button.textContent?.includes('第 10 页')); expect(ninth).toBeTruthy(); await act(async () => ninth!.click());
    expect(host.textContent).toContain('完整正文9'); expect(read).toHaveBeenCalledTimes(4);
  });
});
function documentElementButtons() { return document.querySelectorAll<HTMLButtonElement>('button[role=option]'); }
