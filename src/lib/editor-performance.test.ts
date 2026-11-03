import { describe, expect, it, vi } from 'vitest';
import type { EditorDocument, WordEditorDocument } from '../editor-types';
import type { SpreadsheetDocument } from '../spreadsheet-types';
import { newEditorSlide, newWordBlock } from './editor-document';
import { emptyEditHistory, recordEdit, undoEdit } from './edit-history';
import { editorTypingGroup } from './editor-typing-group';
import { calculateValidatedSpreadsheet, validateSpreadsheetDocument } from './spreadsheet-engine';
import { createSpreadsheetCalculationCache } from './spreadsheet-calculation-cache';
import { serializeImmutableSnapshot } from './snapshot-serialization';
import { editWordTableCell, insertWordTableRow } from './word-table';

describe('不可变快照和连续输入的性能边界', () => {
  it('缓存共享子结构JSON且保持JSON.stringify语义，引用不变时不重复读取正文', () => {
    const toJSON = vi.fn(() => ({ content: '共享内容' })), shared = { toJSON };
    const first = { document: shared, sources: ['source'] }, second = { document: shared, selected: 'block-2' };
    expect(serializeImmutableSnapshot(first)).toBe('{"document":{"content":"共享内容"},"sources":["source"]}');
    expect(serializeImmutableSnapshot(second)).toBe('{"document":{"content":"共享内容"},"selected":"block-2"}'); expect(toJSON).toHaveBeenCalledTimes(1);
    const values = { text: '汉字\n"\\', optional: undefined, list: [undefined, null, false, 0, NaN, Infinity], nested: { key: '值' } };
    expect(serializeImmutableSnapshot(values)).toBe(JSON.stringify(values));
    expect(recordEdit(emptyEditHistory(), first, first).past).toHaveLength(0);
  });
  it('同段文字和同格文字可合并，格式、表头和结构变化独立撤销', () => {
    const before: WordEditorDocument = { schemaVersion: 1, kind: 'word', title: '正文', blocks: [newWordBlock('paragraph', ''), newWordBlock('table')] };
    const first: WordEditorDocument = { ...before, blocks: [{ ...before.blocks[0], text: '中' }, before.blocks[1]] };
    const next: WordEditorDocument = { ...first, blocks: [{ ...first.blocks[0], text: '中文' }, first.blocks[1]] };
    let history = recordEdit(emptyEditHistory<EditorDocument>(), before, first, editorTypingGroup(before, first), 1000);
    history = recordEdit(history, first, next, editorTypingGroup(first, next), 1100);
    expect(history.past).toHaveLength(1); expect(undoEdit(history, next).value).toEqual(before);
    const format: WordEditorDocument = { ...next, blocks: [{ ...next.blocks[0], bold: true }, next.blocks[1]] };
    expect(editorTypingGroup(next, format)).toBeUndefined();
    const table = before.blocks[1].table!, cell = table.rows[0].cells[0];
    const edited: WordEditorDocument = { ...before, blocks: [before.blocks[0], { ...before.blocks[1], table: editWordTableCell(table, cell.id, '输入') }] };
    expect(editorTypingGroup(before, edited)).toBe(`word:${before.blocks[1].id}:${cell.id}`);
    expect(editorTypingGroup(before, { ...before, blocks: [before.blocks[0], { ...before.blocks[1], table: insertWordTableRow(table, 0) }] })).toBeUndefined();
    expect(editorTypingGroup(before, { ...before, blocks: [before.blocks[0], { ...before.blocks[1], table: { ...table, header: false } }] })).toBeUndefined();
  });
  it('PPT仅同页同字段文字合并，换页、主题及版式仍独立', () => {
    const before: EditorDocument = { schemaVersion: 1, kind: 'ppt', title: '演示', theme: 'paper', slides: [newEditorSlide('页一'), newEditorSlide('页二')] };
    const next = { ...before, slides: [{ ...before.slides[0], body: '正文' }, before.slides[1]] };
    expect(editorTypingGroup(before, next)).toBe(`ppt:${before.slides[0].id}:body`);
    expect(editorTypingGroup(before, { ...next, theme: 'forest' })).toBeUndefined();
    expect(editorTypingGroup(before, { ...next, slides: [{ ...next.slides[0], layout: 'two-columns' }, next.slides[1]] })).toBeUndefined();
    const one = recordEdit(emptyEditHistory<string>(), '', '一', 'cell:sheet:A1', 1000);
    expect(recordEdit(one, '一', '二', 'cell:sheet:B1', 1100).past).toHaveLength(2);
  });
});

describe('工作簿只为值和公式重算', () => {
  const workbook = (): SpreadsheetDocument => ({ schemaVersion: 1, kind: 'excel', title: '业务', sheets: [{ id: 'sheet-one', name: '业务', rowCount: 10, columnCount: 3, cells: { A1: { value: 2 }, B1: { value: null, formula: 'A1+3' } } }] });
  it('change已校验的对象在render不再校验；格式/标题/空格样式复用计算结果', () => {
    const validate = vi.fn(validateSpreadsheetDocument), calculate = vi.fn(calculateValidatedSpreadsheet), cache = createSpreadsheetCalculationCache({ validate, calculate });
    const source = workbook(), first = cache.validate(source), result = cache.calculate(first);
    expect(validate).toHaveBeenCalledTimes(1); expect(calculate).toHaveBeenCalledTimes(1); expect(result.cells['sheet-one'].B1.value).toBe(5);
    const style = cache.validate({ ...first, sheets: [{ ...first.sheets[0], cells: { ...first.sheets[0].cells, A1: { value: 2, bold: true, format: 'currency' }, C1: { value: null, align: 'right' } } }] });
    expect(cache.calculate(style)).toBe(result); expect(validate).toHaveBeenCalledTimes(2); expect(calculate).toHaveBeenCalledTimes(1);
    expect(cache.calculate({ ...style, title: '改名' })).toBe(result); expect(calculate).toHaveBeenCalledTimes(1);
  });
  it('值/公式/行列边界/工作表名称变化重算，非法样式仍被校验拒绝', () => {
    const validate = vi.fn(validateSpreadsheetDocument), calculate = vi.fn(calculateValidatedSpreadsheet), cache = createSpreadsheetCalculationCache({ validate, calculate });
    const first = cache.validate(workbook()); cache.calculate(first);
    const changed = { ...first, sheets: [{ ...first.sheets[0], cells: { ...first.sheets[0].cells, A1: { value: 5 } } }] };
    expect(cache.calculate(changed).cells['sheet-one'].B1.value).toBe(8); expect(calculate).toHaveBeenCalledTimes(2);
    cache.calculate({ ...changed, sheets: [{ ...changed.sheets[0], name: '新业务' }] }); expect(calculate).toHaveBeenCalledTimes(3);
    expect(() => cache.calculate({ ...first, sheets: [{ ...first.sheets[0], cells: { A1: { value: 2, bold: 'yes' } } }] } as unknown as SpreadsheetDocument)).toThrow('加粗');
  });
});
