// @vitest-environment jsdom
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAutoSizeTextarea } from './useAutoSizeTextarea';

let root: Root, host: HTMLDivElement, natural = 80, observers = 0, disconnected = 0, resize: ResizeObserverCallback;
const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'scrollHeight');
function Input({ value }: { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useAutoSizeTextarea(ref, value);
  return <textarea ref={ref} readOnly value={value} style={{ minHeight: 56, padding: 0, border: 0 }} />;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); natural = 80; observers = 0; disconnected = 0;
  Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', { configurable: true, get: () => natural });
  vi.stubGlobal('ResizeObserver', class { constructor(callback: ResizeObserverCallback) { resize = callback; observers++; } observe() {} disconnect() { disconnected++; } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
  if (scrollDescriptor) Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', scrollDescriptor);
  else delete (HTMLTextAreaElement.prototype as unknown as Record<string, unknown>).scrollHeight;
});
async function show(value: string) { await act(async () => root.render(<Input value={value} />)); return host.querySelector('textarea')!; }
it('输入框随正文增高并有上限，删空后回到紧凑高度而不改正文', async () => {
  const field = await show('短句'); expect(field.style.height).toBe('80px');
  natural = 320; await show('完整长内容'.repeat(200)); expect(field.style.height).toBe('200px'); expect(field.style.overflowY).toBe('auto'); expect(field.value).toBe('完整长内容'.repeat(200));
  natural = 20; await show(''); expect(field.style.height).toBe('56px'); expect(field.style.overflowY).toBe('hidden'); expect(observers).toBe(1);
});
it('窗口宽度改变重新测量，同一宽度的高度通知不循环重排', async () => {
  const field = await show('同一段内容'); natural = 130;
  await act(async () => { resize([{ contentRect: { width: 450 } } as ResizeObserverEntry], {} as ResizeObserver); await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(field.style.height).toBe('130px'); natural = 180;
  await act(async () => { resize([{ contentRect: { width: 450 } } as ResizeObserverEntry], {} as ResizeObserver); await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(field.style.height).toBe('130px'); expect(observers).toBe(1);
});
it('清空后不沿用浏览器尚未复位的长内容测量与滚动位置', async () => {
  natural = 320; const field = await show('长内容'.repeat(100)); field.scrollTop = 90;
  await show(''); expect(field.style.height).toBe('56px'); expect(field.style.overflowY).toBe('hidden'); expect(field.scrollTop).toBe(0); expect(field.value).toBe('');
});
it('超长输入保留内部滚动位置，卸载时移除观察器', async () => {
  natural = 400; const field = await show('保留文字'); field.scrollTop = 85;
  await show('保留文字与新增内容'); expect(field.scrollTop).toBe(85); expect(field.value).toBe('保留文字与新增内容');
  await act(async () => root.render(null)); expect(disconnected).toBe(1);
});
