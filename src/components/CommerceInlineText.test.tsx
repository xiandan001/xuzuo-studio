// @vitest-environment jsdom
import { act, createRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CommerceTextLayer } from '../commerce-image-types';
import { CommerceInlineText, type CommerceInlineTextHandle } from './CommerceInlineText';
import { ModalPortal } from './ModalPortal';

let root: Root | undefined, host: HTMLDivElement;
const layer: CommerceTextLayer = { id: 'text', name: '标题', type: 'text', text: '原文字', x: 0, y: 0, width: 800, height: 200, opacity: 1, visible: true, locked: false, fontSize: 80, color: '#17212B', fontFamily: 'Arial', fontWeight: 'bold', align: 'center' };
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function mount() {
  const onCommit = vi.fn(), onCancel = vi.fn(), parentKey = vi.fn(), parentPointer = vi.fn(), handle = createRef<CommerceInlineTextHandle>();
  await act(async () => { root = createRoot(host); root.render(<div onKeyDown={parentKey} onPointerDown={parentPointer}><CommerceInlineText ref={handle} layer={layer} scale={.25} onCommit={onCommit} onCancel={onCancel} /></div>); });
  return { onCommit, onCancel, parentKey, parentPointer, handle, input: host.querySelector('textarea')! };
}
async function type(input: HTMLTextAreaElement, text: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function key(input: HTMLElement, value: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options }); await act(async () => input.dispatchEvent(event)); return event;
}

it('就地编辑使用缩放后的文字样式并保持草稿，失焦只提交一次', async () => {
  const f = await mount(); expect(document.activeElement).toBe(f.input); expect(f.input.selectionStart).toBe(0); expect(f.input.selectionEnd).toBe(layer.text.length);
  expect(f.input.style.fontSize).toBe('20px'); expect(f.input.style.textAlign).toBe('center'); expect(f.input.maxLength).toBe(2000);
  expect(f.handle.current!.hasChanges()).toBe(false); await type(f.input, '新标题\n第二行'); expect(f.onCommit).not.toHaveBeenCalled(); expect(layer.text).toBe('原文字'); expect(f.handle.current!.hasChanges()).toBe(true);
  await act(async () => f.input.blur()); await act(async () => f.handle.current!.commit()); expect(f.onCommit).toHaveBeenCalledExactlyOnceWith('新标题\n第二行'); expect(f.handle.current!.hasChanges()).toBe(false);
});
it('Enter和原生撤销保持文本行为，完成快捷键提交但不冒泡给画布', async () => {
  const f = await mount(); await type(f.input, '更新后的文案'); const enter = await key(f.input, 'Enter'), undo = await key(f.input, 'z', { ctrlKey: true });
  expect(enter.defaultPrevented).toBe(false); expect(undo.defaultPrevented).toBe(false); expect(f.onCommit).not.toHaveBeenCalled(); expect(f.parentKey).not.toHaveBeenCalled();
  await act(async () => f.input.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))); expect(f.parentPointer).not.toHaveBeenCalled();
  expect((await key(f.input, 'Enter', { ctrlKey: true })).defaultPrevented).toBe(true); expect(f.onCommit).toHaveBeenCalledExactlyOnceWith('更新后的文案');
});
it('Esc取消保留原文字，随后的失焦不会再提交', async () => {
  const f = await mount(); await type(f.input, '不要保存的草稿'); expect((await key(f.input, 'Escape')).defaultPrevented).toBe(true);
  await act(async () => f.input.blur()); expect(f.onCancel).toHaveBeenCalledOnce(); expect(f.onCommit).not.toHaveBeenCalled(); expect(layer.text).toBe('原文字'); expect(f.handle.current!.hasChanges()).toBe(false);
});
it('中文输入法组合期间不以Enter或Esc结束编辑，完成后可正常提交', async () => {
  const f = await mount(); await act(async () => f.input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  await type(f.input, '中文输入'); expect((await key(f.input, 'Enter', { ctrlKey: true })).defaultPrevented).toBe(false); await key(f.input, 'Escape'); expect(f.onCommit).not.toHaveBeenCalled(); expect(f.onCancel).not.toHaveBeenCalled();
  await act(async () => f.input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  await key(f.input, 'Enter', { metaKey: true }); expect(f.onCommit).toHaveBeenCalledExactlyOnceWith('中文输入');
});
it('真实弹窗内Esc先取消文字编辑，再按Esc才关闭弹窗，Tab仍由弹窗管理', async () => {
  const onClose = vi.fn(), onCommit = vi.fn(), onCancel = vi.fn();
  function Fixture() {
    const [editing, setEditing] = useState(true);
    return <ModalPortal onClose={onClose}><section role="dialog" aria-modal="true" aria-label="排版测试">{editing ? <CommerceInlineText layer={layer} scale={1} onCommit={onCommit} onCancel={() => { onCancel(); setEditing(false); }} /> : <button type="button">继续排版</button>}</section></ModalPortal>;
  }
  await act(async () => { root = createRoot(host); root.render(<Fixture />); });
  const input = document.querySelector<HTMLTextAreaElement>('[aria-label="直接编辑文字"]')!; await type(input, '取消这段修改');
  expect((await key(input, 'Tab')).defaultPrevented).toBe(true); expect(onCancel).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
  await act(async () => input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))); await key(input, 'Escape'); expect(onCancel).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
  await act(async () => input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  await key(input, 'Escape'); expect(onCancel).toHaveBeenCalledOnce(); expect(onCommit).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled(); expect(document.querySelector('[aria-label="直接编辑文字"]')).toBeNull();
  await key(document.querySelector<HTMLElement>('[aria-label="排版测试"] button')!, 'Escape'); expect(onClose).toHaveBeenCalledOnce();
});
