// Generated from src/lib/word-table.ts; run scripts/build-spreadsheet-runtime.mjs.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORD_TABLE_MAX_COLUMNS = exports.WORD_TABLE_MAX_ROWS = void 0;
exports.normalizeWordTable = normalizeWordTable;
exports.newWordTable = newWordTable;
exports.wordTableText = wordTableText;
exports.editWordTableCell = editWordTableCell;
exports.insertWordTableRow = insertWordTableRow;
exports.removeWordTableRow = removeWordTableRow;
exports.insertWordTableColumn = insertWordTableColumn;
exports.removeWordTableColumn = removeWordTableColumn;
exports.WORD_TABLE_MAX_ROWS = 30;
exports.WORD_TABLE_MAX_COLUMNS = 12;
function object(value, allowed) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Word 表格需要有效对象。');
    const item = value;
    const extra = Object.keys(item).find(key => !allowed.includes(key));
    if (extra)
        throw new Error(`Word 表格包含暂不支持的字段“${extra}”。`);
    return item;
}
function normalizeWordTable(value, generateIds = false) {
    const table = object(value, ['columns', 'rows', 'header', 'borders']);
    if (!Array.isArray(table.columns) || !table.columns.length || table.columns.length > exports.WORD_TABLE_MAX_COLUMNS || !Array.isArray(table.rows) || !table.rows.length || table.rows.length > exports.WORD_TABLE_MAX_ROWS)
        throw new Error(`Word 表格需要 1 至 ${exports.WORD_TABLE_MAX_ROWS} 行、1 至 ${exports.WORD_TABLE_MAX_COLUMNS} 列。`);
    if (typeof table.header !== 'boolean' || typeof table.borders !== 'boolean')
        throw new Error('Word 表格的表头和边框需要布尔值。');
    const ids = new Set();
    const identifier = (value) => {
        const actual = value === undefined && generateIds ? crypto.randomUUID() : value;
        if (typeof actual !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(actual))
            throw new Error('Word 表格编号无效。');
        if (ids.has(actual))
            throw new Error('Word 表格编号重复。');
        ids.add(actual);
        return actual;
    };
    const columns = table.columns.map(value => ({ id: identifier(object(value, ['id']).id) }));
    const rows = table.rows.map(value => {
        const row = object(value, ['id', 'cells']), id = identifier(row.id);
        if (!Array.isArray(row.cells) || row.cells.length !== columns.length)
            throw new Error('Word 表格每行单元格数量必须与列数一致。');
        const cells = row.cells.map(value => {
            const cell = object(value, ['id', 'text']);
            if (typeof cell.text !== 'string' || cell.text.length > 20000)
                throw new Error('Word 表格单元格需要不超过 20000 字符的文字。');
            return { id: identifier(cell.id), text: cell.text };
        });
        return { id, cells };
    });
    return { columns, rows, header: table.header, borders: table.borders };
}
const newCell = () => ({ id: crypto.randomUUID(), text: '' });
function newWordTable() {
    return { columns: Array.from({ length: 2 }, () => ({ id: crypto.randomUUID() })), rows: Array.from({ length: 2 }, () => ({ id: crypto.randomUUID(), cells: [newCell(), newCell()] })), header: true, borders: true };
}
function wordTableText(table) {
    return table.rows.map(row => row.cells.map(cell => cell.text).join('\t')).join('\n');
}
function editWordTableCell(table, cellId, text) {
    return { ...table, rows: table.rows.map(row => row.cells.some(cell => cell.id === cellId) ? { ...row, cells: row.cells.map(cell => cell.id === cellId ? { ...cell, text } : cell) } : row) };
}
function insertWordTableRow(table, afterIndex) {
    if (table.rows.length >= exports.WORD_TABLE_MAX_ROWS || afterIndex < 0 || afterIndex >= table.rows.length)
        return table;
    const rows = [...table.rows];
    rows.splice(afterIndex + 1, 0, { id: crypto.randomUUID(), cells: table.columns.map(newCell) });
    return { ...table, rows };
}
function removeWordTableRow(table, index) {
    return table.rows.length <= 1 || index < 0 || index >= table.rows.length ? table : { ...table, rows: table.rows.filter((_, position) => position !== index) };
}
function insertWordTableColumn(table, afterIndex) {
    if (table.columns.length >= exports.WORD_TABLE_MAX_COLUMNS || afterIndex < 0 || afterIndex >= table.columns.length)
        return table;
    const columns = [...table.columns];
    columns.splice(afterIndex + 1, 0, { id: crypto.randomUUID() });
    return { ...table, columns, rows: table.rows.map(row => { const cells = [...row.cells]; cells.splice(afterIndex + 1, 0, newCell()); return { ...row, cells }; }) };
}
function removeWordTableColumn(table, index) {
    return table.columns.length <= 1 || index < 0 || index >= table.columns.length ? table : { ...table, columns: table.columns.filter((_, position) => position !== index), rows: table.rows.map(row => ({ ...row, cells: row.cells.filter((_, position) => position !== index) })) };
}
