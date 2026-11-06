import { describe, expect, it } from 'vitest';
import { compareDocumentVersions } from './version-comparison';
import { emptyEditorDocument, newWordBlock, newEditorSlide } from './editor-document';
import type { WordEditorDocument } from '../editor-types';
import type { SpreadsheetDocument } from '../spreadsheet-types';

describe('版本比较只读展示完整内容与格式差异', () => {
  it('Word识别新增、移除、文字、格式与顺序且不修改源对象', () => {
    const current = { ...emptyEditorDocument('word', '当前'), kind: 'word' as const, blocks: [newWordBlock('paragraph', '当前正文'), newWordBlock('heading', '新增章节')] };
    const previous = { ...current, title: '旧标题', blocks: [{ ...current.blocks[0], text: '历史正文', bold: true }] };
    const before = JSON.stringify({ current, previous }), diff = compareDocumentVersions(current, previous);
    expect(diff.total).toBeGreaterThan(2); expect(diff.changes.some(change => change.before === '当前正文' && change.after === '历史正文')).toBe(true); expect(diff.changes.some(change => change.label.includes('格式'))).toBe(true);
    expect(JSON.stringify({ current, previous })).toBe(before);
  });
  it.each([
    { name: '同值', header: true, borders: true, labels: [] },
    { name: '仅表头', header: false, borders: true, labels: ['第 1 段表格格式·表头'] },
    { name: '仅边框', header: true, borders: false, labels: ['第 1 段表格格式·边框'] },
    { name: '表头与边框', header: false, borders: false, labels: ['第 1 段表格格式·表头', '第 1 段表格格式·边框'] },
  ])('Word表格$name变化只报告实际格式，不伪报文字或修改原稿', ({ header, borders, labels }) => {
    const current: WordEditorDocument = { schemaVersion: 1, kind: 'word', title: '表格格式', blocks: [{ id: 'table-1', type: 'table', text: '', fontSize: 12, bold: false, italic: false, align: 'left', table: { columns: [{ id: 'col-1' }, { id: 'col-2' }], rows: [{ id: 'row-1', cells: [{ id: 'c11', text: '事项' }, { id: 'c12', text: '数量' }] }, { id: 'row-2', cells: [{ id: 'c21', text: '交付' }, { id: 'c22', text: '1' }] }], header: true, borders: true } }] };
    const previous = structuredClone(current); previous.blocks[0].table!.header = header; previous.blocks[0].table!.borders = borders;
    const original = JSON.stringify({ current, previous }), diff = compareDocumentVersions(current, previous);
    expect(diff.total).toBe(labels.length); expect(diff.changes.map(change => change.label)).toEqual(labels);
    expect(diff.changes.filter(change => change.label.includes('格式'))).toHaveLength(labels.length);
    expect(diff.changes.filter(change => change.label.includes('文字'))).toHaveLength(0);
    if (!header) expect(diff.changes.find(change => change.label.endsWith('表头'))).toMatchObject({ before: '首行为表头', after: '无表头' });
    if (!borders) expect(diff.changes.find(change => change.label.endsWith('边框'))).toMatchObject({ before: '显示边框', after: '无边框' });
    expect(JSON.stringify({ current, previous })).toBe(original);
  });
  it('PPT比较备注、插图变化和版式，限制展示条数但统计全部', () => {
    const slide = { ...newEditorSlide('第一页'), body: '当前', notes: '当前备注', imageId: 'one' }, current = { ...emptyEditorDocument('ppt', '演示'), kind: 'ppt' as const, theme: 'paper' as const, slides: [slide] };
    const previous = { ...current, slides: [{ ...slide, body: '旧正文', notes: '旧备注', imageId: 'two', layout: 'image-right' as const }] };
    const diff = compareDocumentVersions(current, previous, 1); expect(diff.total).toBe(4); expect(diff.changes).toHaveLength(1);
  });
  it('Excel比较公式与列宽/筛选；相同内容没有伪差异', () => {
    const current: SpreadsheetDocument = { schemaVersion: 1, kind: 'excel', title: '明细', sheets: [{ id: 'one', name: '账单', rowCount: 10, columnCount: 2, cells: { A1: { value: '名称' }, B2: { value: null, formula: 'SUM(B3:B5)' } }, columnWidths: { A: 240 } }] };
    expect(compareDocumentVersions(current, structuredClone(current)).total).toBe(0);
    const previous = structuredClone(current); previous.sheets[0].cells.B2.formula = 'SUM(B3:B4)'; previous.sheets[0].columnWidths = { A: 300 };
    const diff = compareDocumentVersions(current, previous); expect(diff.total).toBe(2); expect(diff.changes[0].before).toBe('=SUM(B3:B5)'); expect(diff.changes[1].before).toContain('240 像素');
  });
});
