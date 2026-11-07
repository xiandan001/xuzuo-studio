// @vitest-environment jsdom
import { act, createRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BeadCanvas, beadLineIndices } from './BeadCanvas';
import type { BeadCanvasHandle } from './BeadCanvas';
import { beadUiDocument } from '../lib/bead-ui-fixtures';
import { beadTotals, beadUsage, editBeadCells } from '../lib/bead-pattern';
import type { BeadPattern } from '../bead-types';

let root: Root | undefined, container: HTMLDivElement, fills: number, frames: Map<number, FrameRequestCallback>, nextFrame: number;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  fills = 0; frames = new Map(); nextFrame = 0; vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = ++nextFrame; frames.set(id, callback); return id; }); vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const context = { setTransform() {}, clearRect() {}, fillRect() { fills++; }, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 640, bottom: 440, width: 640, height: 440, toJSON: () => ({}) });
  container = document.createElement('div'); document.body.append(container);
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function fixture(brush = 2, size = 8) {
  const committed = vi.fn(), ref = createRef<BeadCanvasHandle>(); let current: BeadPattern;
  function Harness() { const [pattern, setPattern] = useState(beadUiDocument('bead-project', size, size).pattern); current = pattern; return <BeadCanvas ref={ref} pattern={pattern} brush={brush} boardColumns={52} boardRows={52} onCommit={edits => { committed(edits); setPattern(previous => editBeadCells(previous, edits)); }} />; }
  await act(async () => { root = createRoot(container); root.render(<Harness />); }); return { committed, ref, current: () => current! };
}
const element = () => container.querySelector('canvas')!;
async function pointer(name: string, x = 180, y = 80) { await act(async () => element().dispatchEvent(new MouseEvent(name, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }))); }
async function click(label: string) { const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label || item.getAttribute('aria-label') === label)!; await act(async () => button.click()); }
function drawFrames() { for (const [id, callback] of [...frames]) { frames.delete(id); callback(0); } }

describe('拼豆Canvas实际手势与性能边界', () => {
  it('快速划过按连续格补点，斜线不会跳过中间格子', () => { expect(beadLineIndices(0, 3, 8)).toEqual([0, 1, 2, 3]); expect(beadLineIndices(0, 27, 8)).toEqual([0, 9, 18, 27]); });
  it('一笔只在手势结束提交一次，绘制帧合并，未结束手势可主动保存', async () => {
    const f = await fixture(); await pointer('pointerdown'); await pointer('pointermove', 300, 80);
    expect(f.committed).not.toHaveBeenCalled(); expect(f.ref.current?.hasPendingStroke()).toBe(true); expect(frames.size).toBeLessThanOrEqual(1);
    await pointer('pointerup', 300, 80); expect(f.committed).toHaveBeenCalledTimes(1); expect(f.current().cells.slice(0, 4)).toEqual([2, 2, 2, 2]);
    await pointer('pointerdown', 340, 80); await act(async () => f.ref.current?.commitStroke()); expect(f.committed).toHaveBeenCalledTimes(2); expect(f.ref.current?.hasPendingStroke()).toBe(false);
  });
  it('透明实物珠是value3计一颗，橡皮明确擦成value0不计珠', async () => {
    const f = await fixture(3); await pointer('pointerdown'); await pointer('pointerup');
    expect(beadUsage(f.current(), beadUiDocument().procurement).find(row => row.code === 'T1')?.cells).toBe(1); expect(beadTotals(f.current()).emptyCells).toBe(0);
    await click('擦为空格'); await pointer('pointerdown'); await pointer('pointerup'); expect(f.current().cells[0]).toBe(0); expect(beadTotals(f.current()).emptyCells).toBe(1);
  });
  it('键盘可定位与编辑，不依赖65536个DOM格子', async () => {
    const f = await fixture(); await act(async () => element().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))); await act(async () => element().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    expect(f.committed).toHaveBeenCalledExactlyOnceWith([{ index: 1, value: 2 }]); expect(f.current().cells[1]).toBe(2);
  });
  it('256×256仍只创建一个Canvas，放大后只绘制可见区域', async () => {
    await fixture(2, 256); expect(container.querySelectorAll('canvas')).toHaveLength(1); expect(container.querySelectorAll('*').length).toBeLessThan(100);
    await act(async () => { for (let count = 0; count < 16; count++) container.querySelector<HTMLButtonElement>('[aria-label="放大拼豆画布"]')!.click(); }); fills = 0; drawFrames(); expect(fills).toBeGreaterThan(0); expect(fills).toBeLessThan(2000);
  });
  it('生产主题和配色attribute变化会安排重绘，不等待下一次手绘', async () => {
    const oldTheme = document.documentElement.getAttribute('data-app-theme'), oldPalette = document.documentElement.getAttribute('data-app-palette'), observe = vi.spyOn(MutationObserver.prototype, 'observe');
    await fixture(); drawFrames(); const before = fills;
    expect(observe).toHaveBeenCalledWith(document.documentElement, expect.objectContaining({ attributeFilter: ['data-app-theme', 'data-app-palette', 'class', 'style'] }));
    await act(async () => document.documentElement.setAttribute('data-app-theme', 'dark')); expect(frames.size).toBe(1); drawFrames(); expect(fills).toBeGreaterThan(before);
    await act(async () => document.documentElement.setAttribute('data-app-palette', 'blue')); expect(frames.size).toBe(1);
    if (oldTheme === null) document.documentElement.removeAttribute('data-app-theme'); else document.documentElement.setAttribute('data-app-theme', oldTheme);
    if (oldPalette === null) document.documentElement.removeAttribute('data-app-palette'); else document.documentElement.setAttribute('data-app-palette', oldPalette);
  });
});
