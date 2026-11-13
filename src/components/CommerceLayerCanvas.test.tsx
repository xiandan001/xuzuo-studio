// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CommerceImageDocument, CommerceImageSource } from '../commerce-image-types';
import { CommerceLayerCanvas, type CommerceLayerCanvasHandle } from './CommerceLayerCanvas';
let root: Root | undefined, host: HTMLDivElement;
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';
const source: CommerceImageSource = { id: 'original', name: '原图', width: 1000, height: 1000, sha256: 'a'.repeat(64), previewDataUrl: image };
const documentValue: CommerceImageDocument = { type: 'xuzuo-commerce-image', version: 1, id: 'document', projectId: 'project', sourceArtifactId: source.id, sourceSha256: source.sha256, title: '原图', revision: 1, width: 1000, height: 1000, background: '#fff', layers: [{ id: 'layer', type: 'image', role: 'product', artifactId: source.id, name: '主体', x: 10, y: 10, width: 1000, height: 1000, opacity: 1, visible: true, locked: false }], updatedAt: '' };
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); vi.stubGlobal('ResizeObserver', class { callback: ResizeObserverCallback; constructor(callback: ResizeObserverCallback) { this.callback = callback; } observe() { this.callback([{ contentRect: { width: 800, height: 600 } } as ResizeObserverEntry], this as unknown as ResizeObserver); } disconnect() {} unobserve() {} }); vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId = 1; }); HTMLElement.prototype.setPointerCapture = vi.fn(); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function mount(maskMode?: 'product', value = documentValue) { const onChange = vi.fn(), onSelect = vi.fn(), onMaskDirty = vi.fn(), handle = createRef<CommerceLayerCanvasHandle>(); await act(async () => { root = createRoot(host); root.render(<CommerceLayerCanvas ref={handle} document={value} source={source} previews={{ original: image }} selectedId="layer" maskMode={maskMode} onChange={onChange} onSelect={onSelect} onMask={vi.fn(async () => {})} onCancelMask={vi.fn()} onMaskDirty={onMaskDirty} />); }); const viewport = host.querySelector<HTMLElement>('[aria-label="图片编辑视口"]')!; Object.defineProperties(viewport, { clientWidth: { configurable: true, value: 800 }, clientHeight: { configurable: true, value: 600 } }); return { onChange, onSelect, onMaskDirty, viewport, handle }; }
async function click(label: string) { const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.getAttribute('aria-label') === label || item.textContent === label)!; expect(button).toBeTruthy(); await act(async () => button.click()); }
it('缩放与适应仅改变视图，图层拖动按当前缩放反算原图位置', async () => {
  const f = await mount(); await click('100%'); await click('放大画布'); expect(host.querySelector('.cle-stage')!.getAttribute('style')).toContain('1250px'); expect(f.onChange).not.toHaveBeenCalled();
  await click('选择与移动图层'); const layer = host.querySelector<HTMLElement>('[aria-label="图层 主体"]')!;
  await act(async () => { layer.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100 })); layer.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 225, clientY: 150 })); layer.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); });
  expect(f.onChange.mock.lastCall![0].layers[0]).toMatchObject({ x: 110, y: 50 }); const count = f.onChange.mock.calls.length;
  await click('适应窗口'); expect(host.querySelector('[aria-label="画布缩放比例"]')!.textContent).toBe('55%'); expect(f.onChange).toHaveBeenCalledTimes(count);
});
it('平移工具和临时空格平移不会移动图层，输入框快捷键保持原行为', async () => {
  const f = await mount(); await click('100%'); f.viewport.scrollLeft = 180; f.viewport.scrollTop = 120;
  await click('拖动画布'); const layer = host.querySelector<HTMLElement>('[aria-label="图层 主体"]')!;
  await act(async () => { layer.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 300, clientY: 200 })); layer.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 1, clientX: 350, clientY: 230 })); layer.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); });
  expect(f.viewport.scrollLeft).toBe(130); expect(f.viewport.scrollTop).toBe(90); expect(f.onChange).not.toHaveBeenCalled();
  await click('选择与移动图层'); f.viewport.focus(); await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true })));
  expect(f.viewport.classList.contains('is-pan-tool')).toBe(true); await act(async () => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ', bubbles: true })));
  expect(f.viewport.classList.contains('is-pan-tool')).toBe(false);
  const field = document.createElement('input'); f.viewport.append(field); const key = new KeyboardEvent('keydown', { key: '-', ctrlKey: true, bubbles: true, cancelable: true }), wheel = new WheelEvent('wheel', { deltaY: 100, ctrlKey: true, bubbles: true, cancelable: true }); field.dispatchEvent(key); field.dispatchEvent(wheel); expect(key.defaultPrevented).toBe(false); expect(wheel.defaultPrevented).toBe(false);
});
it('Ctrl滚轮只缩放画布；放大后的蒙版点击仍映射到同一原图坐标', async () => {
  const context = { clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), arc: vi.fn(), fill: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  const f = await mount('product'); await click('100%'); await click('放大画布');
  const mask = host.querySelector<HTMLCanvasElement>('.cle-mask')!; mask.getBoundingClientRect = () => ({ left: 100, top: 100, width: 1250, height: 1250 } as DOMRect);
  await act(async () => mask.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 225, clientY: 225 })));
  expect(context.arc.mock.calls[0][0]).toBe(100); expect(context.arc.mock.calls[0][1]).toBe(100); expect(f.onMaskDirty).toHaveBeenCalledWith(true);
  const wheel = new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, clientX: 400, clientY: 300, bubbles: true, cancelable: true }); await act(async () => f.viewport.dispatchEvent(wheel)); expect(wheel.defaultPrevented).toBe(true); expect(f.onChange).not.toHaveBeenCalled(); expect(Number(host.querySelector('[aria-label="画布缩放比例"]')!.textContent!.replace('%', ''))).toBeGreaterThan(125);
});
it('普通滚轮仅在图片视口内缩放，默认平移不会修改图层', async () => {
  const f = await mount(); expect(host.querySelector('[aria-label="拖动画布"]')!.getAttribute('aria-pressed')).toBe('true');
  const before = Number(host.querySelector('output')!.textContent!.replace('%', ''));
  const wheel = new WheelEvent('wheel', { deltaY: -100, clientX: 300, clientY: 200, bubbles: true, cancelable: true });
  await act(async () => f.viewport.dispatchEvent(wheel)); expect(wheel.defaultPrevented).toBe(true); expect(Number(host.querySelector('output')!.textContent!.replace('%', ''))).toBeGreaterThan(before);
  const outside = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }); host.dispatchEvent(outside); expect(outside.defaultPrevented).toBe(false); expect(f.onChange).not.toHaveBeenCalled();
});
it('默认平移模式仍可直接拖拽控制点，按视图比例等比缩放且不会触发平移', async () => {
  const f = await mount(); await click('100%'); await click('放大画布'); const handle = host.querySelector<HTMLElement>('.cle-resize-se')!;
  const left = f.viewport.scrollLeft;
  await act(async () => { handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 400, clientY: 400 })); handle.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 525, clientY: 450 })); handle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); });
  expect(f.onChange).toHaveBeenCalledTimes(1); expect(f.onChange.mock.lastCall![0].layers[0]).toMatchObject({ x: 10, y: 10, width: 1100, height: 1100 }); expect(f.viewport.scrollLeft).toBe(left);
});
it('文字角点同步缩放字号，边点仅调整文字框；锁定图层没有控制点', async () => {
  const textLayer = { id: 'layer', type: 'text' as const, name: '标题', text: '原始标题', x: 20, y: 30, width: 200, height: 100, fontSize: 40, fontWeight: 'bold' as const, fontFamily: 'Arial', align: 'left' as const, color: '#ffffff', visible: true, locked: false, opacity: 1 };
  const f = await mount(undefined, { ...documentValue, layers: [textLayer] }); await click('100%');
  const corner = host.querySelector<HTMLElement>('.cle-resize-se')!;
  await act(async () => { corner.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0 })); corner.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 100, clientY: 50 })); corner.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); });
  expect(f.onChange.mock.lastCall![0].layers[0]).toMatchObject({ width: 300, height: 150, fontSize: 60 });
  const edge = host.querySelector<HTMLElement>('.cle-resize-e')!;
  await act(async () => { edge.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0 })); edge.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 100, clientY: 50 })); edge.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); });
  expect(f.onChange.mock.lastCall![0].layers[0]).toMatchObject({ width: 300, height: 100, fontSize: 40 });
  await act(async () => root!.render(<CommerceLayerCanvas document={{ ...documentValue, layers: [{ ...textLayer, locked: true }] }} source={source} previews={{}} selectedId="layer" onChange={f.onChange} onSelect={f.onSelect} onMask={vi.fn(async () => {})} onCancelMask={vi.fn()} />)); expect(host.querySelector('.cle-resize-handle')).toBeNull();
});
it('画布文字草稿被保存保护检测，保存前统一提交且不改变其他图层', async () => {
  const textLayer = { id: 'layer', type: 'text' as const, name: '标题', text: '原始标题', x: 20, y: 30, width: 200, height: 100, fontSize: 40, fontWeight: 'bold' as const, fontFamily: 'Arial', align: 'left' as const, color: '#ffffff', visible: true, locked: false, opacity: 1 };
  const f = await mount(undefined, { ...documentValue, layers: [{ ...documentValue.layers[0], id: 'other' }, textLayer] });
  await act(async () => host.querySelector('[aria-label="图层 标题"]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  const field = host.querySelector<HTMLTextAreaElement>('[aria-label="直接编辑文字"]')!; expect(field).toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, '新的标题\n第二行'); field.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(f.handle.current!.hasPendingEdits()).toBe(true); expect(f.onChange).not.toHaveBeenCalled();
  await act(async () => f.handle.current!.flushDrag()); expect(f.onChange).toHaveBeenCalledTimes(1); expect(f.onChange.mock.lastCall![0].layers[1].text).toBe('新的标题\n第二行'); expect(f.onChange.mock.lastCall![0].layers[0]).toEqual({ ...documentValue.layers[0], id: 'other' }); expect(f.handle.current!.hasPendingEdits()).toBe(false);
});
