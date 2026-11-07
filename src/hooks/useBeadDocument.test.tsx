// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBeadDocument } from './useBeadDocument';
import { beadUiBridge, beadUiDocument } from '../lib/bead-ui-fixtures';
import { editBeadCells } from '../lib/bead-pattern';
import { guardedEditorSessions } from '../lib/editor-session-guard';
import type { BeadDocument } from '../bead-types';

let root: Root | undefined, container: HTMLDivElement, api: ReturnType<typeof useBeadDocument>;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function fixture(options = {}) {
  const f = beadUiBridge(beadUiDocument());
  function Harness() { api = useBeadDocument('bead-project', f.bridge, options); return <output>{api.document?.revision}:{api.dirty ? 'dirty' : 'saved'}</output>; }
  await act(async () => { root = createRoot(container); root.render(<Harness />); }); return f;
}
async function draw(index: number) { await act(async () => { const value = api.current.current!; api.change({ ...value, pattern: editBeadCells(value.pattern, [{ index, value: 2 }]) }); }); }

describe('拼豆文档单writer与恢复', () => {
  it('真实编辑只在原生版本上前进保存，不写网格到localStorage', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem'), f = await fixture(); await draw(0);
    expect(api.dirty).toBe(true); await act(async () => { expect(await api.flush()).toBe(true); });
    expect(f.current()?.pattern.cells[0]).toBe(2); expect(api.document?.revision).toBe(2); expect(api.dirty).toBe(false); expect(storage).not.toHaveBeenCalled();
  });
  it('迟到saveAck不覆盖新手改，续存使用新revision和最新格子', async () => {
    const f = await fixture(); let finish!: (value: BeadDocument) => void;
    vi.mocked(f.bridge.save).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await draw(0); let task!: Promise<boolean>; await act(async () => { task = api.flush(); }); await draw(1);
    const first = vi.mocked(f.bridge.save).mock.calls[0][0], ack = { ...first.document, revision: 2 }; f.external(ack);
    await act(async () => { finish(structuredClone(ack)); await task; });
    expect(api.document?.pattern.cells.slice(0, 2)).toEqual([2, 2]); expect(api.document?.revision).toBe(3); expect(vi.mocked(f.bridge.save).mock.calls[1][0]).toMatchObject({ expectedRevision: 2, document: { revision: 2 } }); expect(api.dirty).toBe(false);
  });
  it('原生保留恢复点造成跳号时接受前进回执，后续CAS从返回版本开始', async () => {
    const f = await fixture(); vi.mocked(f.bridge.save).mockImplementationOnce(async input => { const value = { ...structuredClone(input.document), revision: 3 }; f.external(value); return value; });
    await draw(0); await act(async () => { expect(await api.flush()).toBe(true); }); expect(api.revision.current).toBe(3);
    await draw(1); await act(async () => { expect(await api.flush()).toBe(true); }); expect(vi.mocked(f.bridge.save).mock.calls[1][0].expectedRevision).toBe(3); expect(api.document?.revision).toBe(4);
  });
  it('重制或导入后undo只恢复内容，不倒回文档id或原生revision', async () => {
    const f = await fixture(); const imported = { ...beadUiDocument('bead-project', 16, 8), id: 'native-current-id', revision: 4 }; f.external(imported); await act(async () => api.accept(imported));
    await act(async () => api.undo()); expect(api.document).toMatchObject({ id: 'native-current-id', revision: 4, pattern: { columns: 8, rows: 8 } });
    await act(async () => { await api.flush(); }); expect(f.current()).toMatchObject({ id: 'native-current-id', revision: 5, pattern: { columns: 8, rows: 8 } });
  });
  it('保存失败直接导出当前内存JSON，不用旧persisted导出假装恢复', async () => {
    const f = await fixture(); vi.mocked(f.bridge.save).mockRejectedValue(Error('U盘暂不可用')); await draw(0);
    await act(async () => { expect(await api.flush()).toBe(false); expect(await api.recover()).toBe(true); });
    expect(f.current()?.pattern.cells[0]).toBe(0); expect(vi.mocked(f.bridge.exportRecovery).mock.calls[0][0].document.pattern.cells[0]).toBe(2); expect(f.bridge.export).not.toHaveBeenCalled(); expect(api.dirty).toBe(true); expect(api.recoveryCurrent).toBe(true);
    await draw(1); expect(api.recoveryCurrent).toBe(false); const reads = vi.mocked(f.bridge.read).mock.calls.length;
    await act(async () => { await api.reload(); }); expect(f.bridge.read).toHaveBeenCalledTimes(reads); expect(api.document?.pattern.cells.slice(0, 2)).toEqual([2, 2]);
  });
  it('当前恢复副本成功后，显式重读才可替换dirty；更晚的读取不能盖新手改', async () => {
    const f = await fixture(); await draw(0); await act(async () => { await api.recover(); });
    let finish!: (value: BeadDocument | undefined) => void; vi.mocked(f.bridge.read).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    let task!: Promise<void>; await act(async () => { task = api.reload(); }); await draw(1); await act(async () => { finish({ ...beadUiDocument(), revision: 7 }); await task; });
    expect(api.document?.pattern.cells.slice(0, 2)).toEqual([2, 2]); expect(api.error).toContain('未用旧读取');
  });
  it('原生文件缺失时保留已有内存图纸，不创建空白覆盖', async () => {
    const f = await fixture(); vi.mocked(f.bridge.read).mockResolvedValueOnce(undefined); await act(async () => { await api.reload(); });
    expect(api.document?.pattern.cells).toHaveLength(64); expect(api.error).toContain('内存图纸仍保留'); expect(f.bridge.save).not.toHaveBeenCalled();
  });
  it('退出恢复入口先提交未结束手势，导出最新网格而非保存旧版本', async () => {
    let pending = false; const f = await fixture({ pendingStroke: () => pending, beforeSave: () => { if (pending) { pending = false; const value = api.current.current!; api.change({ ...value, pattern: editBeadCells(value.pattern, [{ index: 4, value: 2 }]) }); } } });
    pending = true; const session = guardedEditorSessions({ includeDirty: true }).find(item => item.id === 'beads:bead-project')!; expect(session.getState().pending).toBe(true);
    await act(async () => { expect(await session.exportRecovery()).toBe(true); }); expect(vi.mocked(f.bridge.exportRecovery).mock.calls[0][0].document.pattern.cells[4]).toBe(2); expect(f.bridge.export).not.toHaveBeenCalled();
  });
});
