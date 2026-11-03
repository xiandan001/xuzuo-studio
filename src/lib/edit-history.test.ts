import { describe, expect, it } from 'vitest';
import { EDIT_HISTORY_LIMIT, EDIT_HISTORY_MAX_CHARACTERS, emptyEditHistory, recordEdit, redoEdit, undoEdit } from './edit-history';

describe('有界编辑撤销与重做', () => {
  it('未保存的结构删除可原样恢复正文、图片引用、来源及选择，redo不修改原对象', () => {
    const before = { document: { title: '客户稿', blocks: [{ id: 'one', text: '末段', imageId: 'actual-image', fontSize: 24, bold: true }] }, sources: ['actual-source'], selectedId: 'one' };
    const after = { ...before, document: { ...before.document, blocks: [] } };
    const history = recordEdit(emptyEditHistory<typeof before>(), before, after), undone = undoEdit(history, after);
    expect(undone.value).toEqual(before); expect(history.past).toHaveLength(1);
    const redone = redoEdit(undone.history, undone.value!); expect(redone.value).toEqual(after); expect(redone.history.future).toHaveLength(0);
  });
  it('公式、格式、多格粘贴与工作表顺序作为同一事务恢复', () => {
    const before: { sheets: { id: string; cells: Record<string, { formula: string; format: string }> }[] } = { sheets: [{ id: 'detail', cells: { A1: { formula: 'SUM(B1:C1)', format: 'currency' } } }, { id: 'summary', cells: {} }] };
    const after: typeof before = { sheets: [{ id: 'summary', cells: {} }] };
    const reverted = undoEdit(recordEdit(emptyEditHistory<typeof before>(), before, after), after);
    expect(reverted.value).toEqual(before); expect(reverted.value!.sheets[0].cells.A1!.formula).toBe('SUM(B1:C1)');
  });
  it('新编辑清空redo分支，等价值不创建操作', () => {
    const history = recordEdit(emptyEditHistory<string>(), 'A', 'B'), undone = undoEdit(history, 'B');
    const next = recordEdit(undone.history, 'A', 'C'); expect(next.future).toEqual([]); expect(redoEdit(next, 'C').value).toBeUndefined();
    expect(recordEdit(next, 'C', 'C')).toBe(next);
  });
  it('可选连续文字事务合并，超过时间窗或结构操作分别入栈', () => {
    let history = recordEdit(emptyEditHistory<string>(), '', '中', 'body', 1000);
    history = recordEdit(history, '中', '中文', 'body', 1200); expect(history.past).toHaveLength(1);
    history = recordEdit(history, '中文', '中文稿', 'body', 2500); expect(history.past).toHaveLength(2);
    history = recordEdit(history, '中文稿', '加粗正文', undefined, 2600); expect(history.past).toHaveLength(3);
  });
  it('项目使用独立历史，空历史操作不会生成假的撤销结果', () => {
    const first = recordEdit(emptyEditHistory<string>(), '项目一', '项目一新版'), second = emptyEditHistory<string>();
    expect(undoEdit(first, '项目一新版').value).toBe('项目一'); expect(undoEdit(second, '项目二').value).toBeUndefined(); expect(redoEdit(second, '项目二').value).toBeUndefined();
  });
  it('达到条数上限仅丢弃最早历史，当前撤销和重做仍可用', () => {
    let history = emptyEditHistory<number>();
    for (let index = 0; index < EDIT_HISTORY_LIMIT + 10; index++) history = recordEdit(history, index, index + 1);
    expect(history.past).toHaveLength(EDIT_HISTORY_LIMIT); expect(history.past[0].value).toBe(10);
    const undo = undoEdit(history, EDIT_HISTORY_LIMIT + 10); expect(undo.value).toBe(EDIT_HISTORY_LIMIT + 9); expect(redoEdit(undo.history, undo.value!).value).toBe(EDIT_HISTORY_LIMIT + 10);
  });
  it('大文档快照总容量受限，不无限累积整个工作簿', () => {
    const size = Math.floor(EDIT_HISTORY_MAX_CHARACTERS * 0.55), first = 'A'.repeat(size), second = 'B'.repeat(size);
    const one = recordEdit(emptyEditHistory<string>(), first, second), two = recordEdit(one, second, 'C');
    expect(two.past).toHaveLength(1); expect(two.past[0].value).toBe(second); expect(two.past.reduce((sum, item) => sum + item.weight, 0)).toBeLessThanOrEqual(EDIT_HISTORY_MAX_CHARACTERS);
  });
});
