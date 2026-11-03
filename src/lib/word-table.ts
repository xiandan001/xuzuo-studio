import type { WordTable, WordTableCell } from '../editor-types';

export const WORD_TABLE_MAX_ROWS = 30;
export const WORD_TABLE_MAX_COLUMNS = 12;
type Data = Record<string, unknown>;
function object(value: unknown, allowed: string[]): Data {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Word 表格需要有效对象。');
  const item = value as Data;
  const extra = Object.keys(item).find(key => !allowed.includes(key));
  if (extra) throw new Error(`Word 表格包含暂不支持的字段“${extra}”。`);
  return item;
}
export function normalizeWordTable(value: unknown, generateIds = false): WordTable {
  const table = object(value, ['columns', 'rows', 'header', 'borders']);
  if (!Array.isArray(table.columns) || !table.columns.length || table.columns.length > WORD_TABLE_MAX_COLUMNS || !Array.isArray(table.rows) || !table.rows.length || table.rows.length > WORD_TABLE_MAX_ROWS) throw new Error(`Word 表格需要 1 至 ${WORD_TABLE_MAX_ROWS} 行、1 至 ${WORD_TABLE_MAX_COLUMNS} 列。`);
  if (typeof table.header !== 'boolean' || typeof table.borders !== 'boolean') throw new Error('Word 表格的表头和边框需要布尔值。');
  const ids = new Set<string>();
  const identifier = (value: unknown) => {
    const actual = value === undefined && generateIds ? crypto.randomUUID() : value;
    if (typeof actual !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(actual)) throw new Error('Word 表格编号无效。');
    if (ids.has(actual)) throw new Error('Word 表格编号重复。');
    ids.add(actual); return actual;
  };
  const columns = table.columns.map(value => ({ id: identifier(object(value, ['id']).id) }));
  const rows = table.rows.map(value => {
    const row = object(value, ['id', 'cells']), id = identifier(row.id);
    if (!Array.isArray(row.cells) || row.cells.length !== columns.length) throw new Error('Word 表格每行单元格数量必须与列数一致。');
    const cells = row.cells.map(value => {
      const cell = object(value, ['id', 'text']);
      if (typeof cell.text !== 'string' || cell.text.length > 20000) throw new Error('Word 表格单元格需要不超过 20000 字符的文字。');
      return { id: identifier(cell.id), text: cell.text };
    });
    return { id, cells };
  });
  return { columns, rows, header: table.header, borders: table.borders };
}
const newCell = (): WordTableCell => ({ id: crypto.randomUUID(), text: '' });
export function newWordTable(): WordTable {
  return { columns: Array.from({ length: 2 }, () => ({ id: crypto.randomUUID() })), rows: Array.from({ length: 2 }, () => ({ id: crypto.randomUUID(), cells: [newCell(), newCell()] })), header: true, borders: true };
}
export function wordTableText(table: WordTable): string {
  return table.rows.map(row => row.cells.map(cell => cell.text).join('\t')).join('\n');
}
export function editWordTableCell(table: WordTable, cellId: string, text: string): WordTable {
  return { ...table, rows: table.rows.map(row => row.cells.some(cell => cell.id === cellId) ? { ...row, cells: row.cells.map(cell => cell.id === cellId ? { ...cell, text } : cell) } : row) };
}
export function insertWordTableRow(table: WordTable, afterIndex: number): WordTable {
  if (table.rows.length >= WORD_TABLE_MAX_ROWS || afterIndex < 0 || afterIndex >= table.rows.length) return table;
  const rows = [...table.rows]; rows.splice(afterIndex + 1, 0, { id: crypto.randomUUID(), cells: table.columns.map(newCell) });
  return { ...table, rows };
}
export function removeWordTableRow(table: WordTable, index: number): WordTable {
  return table.rows.length <= 1 || index < 0 || index >= table.rows.length ? table : { ...table, rows: table.rows.filter((_, position) => position !== index) };
}
export function insertWordTableColumn(table: WordTable, afterIndex: number): WordTable {
  if (table.columns.length >= WORD_TABLE_MAX_COLUMNS || afterIndex < 0 || afterIndex >= table.columns.length) return table;
  const columns = [...table.columns]; columns.splice(afterIndex + 1, 0, { id: crypto.randomUUID() });
  return { ...table, columns, rows: table.rows.map(row => { const cells = [...row.cells]; cells.splice(afterIndex + 1, 0, newCell()); return { ...row, cells }; }) };
}
export function removeWordTableColumn(table: WordTable, index: number): WordTable {
  return table.columns.length <= 1 || index < 0 || index >= table.columns.length ? table : { ...table, columns: table.columns.filter((_, position) => position !== index), rows: table.rows.map(row => ({ ...row, cells: row.cells.filter((_, position) => position !== index) })) };
}
