import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { WordEditorDocument } from '../editor-types';
import { editorFromText, editorPlainText, newWordBlock } from './editor-document';
import { editWordTableCell, insertWordTableColumn, insertWordTableRow, newWordTable, normalizeWordTable, removeWordTableColumn, removeWordTableRow, WORD_TABLE_MAX_COLUMNS, WORD_TABLE_MAX_ROWS, wordTableText } from './word-table';
import { editorDeliveryChecks } from './delivery-quality';

const require = createRequire(import.meta.url);
const { validateEditorDocument } = require('../../electron/editor-document.cjs') as { validateEditorDocument: (value: unknown) => WordEditorDocument };
const { normalizeOfficeDocument } = require('../../electron/office-content.cjs') as { normalizeOfficeDocument: (kind: string, source: string, title: string) => WordEditorDocument };
function tableDocument(): WordEditorDocument {
  const block = newWordBlock('table');
  block.table!.rows[0].cells[0].text = '交付事项'; block.table!.rows[0].cells[1].text = '说明';
  block.table!.rows[1].cells[0].text = '完整数据'; block.table!.rows[1].cells[1].text = '最后一格-END\n保留换行';
  return { schemaVersion: 1, kind: 'word', title: '原生表格', blocks: [newWordBlock('paragraph', '表前'), block, newWordBlock('paragraph', '表后')] };
}
describe('Word 表格的共享结构与稳定编号', () => {
  it('生成 JSON、保存校验和 Office 规范保留同一个结构，全文包含单元格', () => {
    const document = tableDocument(), source = JSON.stringify(document);
    expect(editorFromText('word', '备用', source)).toEqual(document);
    expect(normalizeOfficeDocument('word', source, '备用')).toEqual(document);
    expect(validateEditorDocument(document)).toEqual(document);
    expect(editorPlainText(document)).toBe('原生表格\n\n表前\n\n交付事项\t说明\n完整数据\t最后一格-END\n保留换行\n\n表后');
  });
  it('旧 schemaVersion 1 段落和图片不需要迁移，生成的缺省表格编号只分配一次', () => {
    const old: WordEditorDocument = { schemaVersion: 1, kind: 'word', title: '旧稿', blocks: [newWordBlock('paragraph', '原内容'), { ...newWordBlock('image', '图片说明'), imageId: 'picture-old' }] };
    expect(validateEditorDocument(old)).toEqual(old); expect(editorFromText('word', '备用', JSON.stringify(old))).toEqual(old);
    const generated = { ...newWordBlock('table'), table: { columns: [{}, {}], rows: [{ cells: [{ text: '第一格' }, { text: '第二格' }] }], header: true, borders: true } };
    const parsed = editorFromText('word', '新表', JSON.stringify({ blocks: [generated] }));
    expect(parsed.kind).toBe('word'); if (parsed.kind !== 'word') throw new Error('wrong kind');
    const table = parsed.blocks[0].table!; expect(new Set([...table.columns, ...table.rows, ...table.rows.flatMap(row => row.cells)].map(item => item.id)).size).toBe(5);
    expect(validateEditorDocument(parsed)).toEqual(parsed);
  });
  it('单元格编辑和增删行列只改对应对象，已有 id 和文字不变', () => {
    const table = tableDocument().blocks[1].table!, cell = table.rows[1].cells[1];
    const edited = editWordTableCell(table, cell.id, '人工修改');
    expect(edited.rows[0]).toBe(table.rows[0]); expect(edited.rows[1].cells[0]).toBe(table.rows[1].cells[0]); expect(cell.text).toContain('END');
    const rowAdded = insertWordTableRow(edited, 0);
    expect(rowAdded.rows[0]).toBe(edited.rows[0]); expect(rowAdded.rows[2]).toBe(edited.rows[1]);
    const columnAdded = insertWordTableColumn(rowAdded, 0);
    expect(columnAdded.columns[2]).toBe(table.columns[1]); expect(columnAdded.rows[2].cells[2].id).toBe(cell.id);
    const restored = removeWordTableRow(removeWordTableColumn(columnAdded, 1), 1);
    expect(restored).toEqual(edited); expect(normalizeWordTable(restored)).toEqual(restored);
    expect(wordTableText(restored)).toContain('人工修改');
  });
  it('至少保留一行一列，上限操作不产生半张表', () => {
    let table = newWordTable(); table = removeWordTableRow(removeWordTableColumn(table, 0), 0);
    expect(removeWordTableRow(table, 0)).toBe(table); expect(removeWordTableColumn(table, 0)).toBe(table);
    for (let index = 1; index < WORD_TABLE_MAX_ROWS; index++) table = insertWordTableRow(table, 0);
    for (let index = 1; index < WORD_TABLE_MAX_COLUMNS; index++) table = insertWordTableColumn(table, 0);
    expect(insertWordTableRow(table, 0)).toBe(table); expect(insertWordTableColumn(table, 0)).toBe(table);
    expect(normalizeWordTable(table)).toEqual(table);
  });
  it('生成与保存均拒绝不规则、重复编号、隐藏内容和不支持的合并结构', () => {
    const invalidTables = [
      { ...newWordTable(), rows: [] },
      { ...newWordTable(), columns: [] },
      { ...newWordTable(), header: 'true' },
      { ...newWordTable(), rows: [{ id: 'r1', cells: [{ id: 'c1', text: '不足列' }] }] },
      { ...newWordTable(), columns: [{ id: 'same' }, { id: 'same' }] },
      { ...newWordTable(), mergeCells: ['A1:B1'] },
      { ...newWordTable(), rows: [{ id: 'r1', cells: [{ id: 'c1', text: '甲', colSpan: 2 }, { id: 'c2', text: '乙' }] }] },
    ];
    for (const table of invalidTables) {
      const document = tableDocument(); document.blocks[1] = { ...document.blocks[1], table } as typeof document.blocks[1];
      expect(() => editorFromText('word', '备用', JSON.stringify(document))).toThrow('Word 表格');
      expect(() => validateEditorDocument(document)).toThrow('Word 表格');
    }
    const document = tableDocument(); document.blocks[1].text = '不能丢失的重复正文';
    expect(() => editorFromText('word', '备用', JSON.stringify(document))).toThrow('text');
    expect(() => validateEditorDocument(document)).toThrow('text');
  });
  it('纯表格文稿按格内文字判断正文和占位检查', () => {
    const document = tableDocument(); document.blocks = [document.blocks[1]];
    expect(editorDeliveryChecks(document).find(check => check.id === 'title')?.status).toBe('passed');
    document.blocks[0].table!.rows[1].cells[0].text = 'XXX 项目';
    expect(editorDeliveryChecks(document).find(check => check.id === 'placeholders')?.status).toBe('failed');
  });
});
