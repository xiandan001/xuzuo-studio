// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PageProps } from '../types';
import { registerEditorSession } from '../lib/editor-session-guard';
import { CommerceEditorDialog } from './CommerceEditorDialog';
vi.mock('./CommerceLayerEditor', () => ({ CommerceLayerEditor: () => <p>独立图层测试内容</p> }));
let root: Root | undefined, host: HTMLDivElement, release: (() => void) | undefined;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; release?.(); release = undefined; host.remove(); vi.unstubAllGlobals(); });
async function fixture(state: { dirty: boolean; pending: boolean; persistenceError?: string }, save = vi.fn(async () => false)) {
  const onClose = vi.fn(), notify = vi.fn(); release = registerEditorSession({ id: 'commerce:dialog-project', projectId: 'dialog-project', label: '图层', getState: () => state, save, exportRecovery: () => false });
  await act(async () => { root = createRoot(host); root.render(<CommerceEditorDialog props={{ notify } as unknown as PageProps} projectId="dialog-project" onClose={onClose} />); });
  return { onClose, notify, save, button: document.querySelector<HTMLButtonElement>('[aria-label="关闭图片排版"]')! };
}
it('未修改且仅原图读取失败时可关闭，不强制保存不存在的文稿', async () => {
  const f = await fixture({ dirty: false, pending: false, persistenceError: '原图无法读取' });
  await act(async () => f.button.click()); expect(f.onClose).toHaveBeenCalledTimes(1); expect(f.save).not.toHaveBeenCalled(); expect(f.notify).not.toHaveBeenCalled();
});
it('真正未保存的图层仍保留，写入失败不关闭或清除错误', async () => {
  const state = { dirty: true, pending: false, persistenceError: '写入失败' }, f = await fixture(state);
  await act(async () => f.button.click()); expect(f.onClose).not.toHaveBeenCalled(); expect(f.save).toHaveBeenCalledTimes(1); expect(f.notify).toHaveBeenCalledWith(expect.stringContaining('尚未保存'), 'error'); expect(state.dirty).toBe(true);
});
it('在途保存必须先完成，重复点击不会重复保存', async () => {
  let finish!: (value: boolean) => void; const state = { dirty: true, pending: true }, save = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; })), f = await fixture(state, save);
  await act(async () => { f.button.click(); f.button.click(); }); expect(f.onClose).not.toHaveBeenCalled(); expect(f.save).toHaveBeenCalledTimes(1);
  await act(async () => { state.dirty = false; state.pending = false; finish(true); }); expect(f.onClose).toHaveBeenCalledTimes(1);
});
