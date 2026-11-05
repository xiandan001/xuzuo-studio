// Generated from src/lib/spreadsheet-generated.ts; run scripts/build-spreadsheet-runtime.mjs.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.spreadsheetMissingInputs = spreadsheetMissingInputs;
exports.spreadsheetFromText = spreadsheetFromText;
const spreadsheet_engine_1 = require("./spreadsheet-engine.cjs");
const spreadsheet_generated_formatting_1 = require("./spreadsheet-generated-formatting.cjs");
const NOTES_ID = 'generated-missing-inputs';
const object = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const scalar = (value) => value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value);
const fail = (location, message) => { throw new Error(`${location}：${message}，原内容未被丢弃。`); };
function generatedCell(value, location, inferTypes) {
    if (scalar(value))
        return typeof value === 'string' && inferTypes && !value.startsWith('=') ? (0, spreadsheet_engine_1.cellFromInput)(value) : { value };
    if (!object(value))
        return fail(location, '单元格需要文字、数字、布尔值、空值或明确的值/公式对象');
    const unknown = Object.keys(value).filter(key => !['value', 'text', 'formula', 'bold', 'align', 'format'].includes(key) && !(key === 'result' && typeof value.formula === 'string'));
    if (unknown.length)
        return fail(location, `不支持单元格字段 ${unknown.join('、')}`);
    if (value.formula !== undefined) {
        if (typeof value.formula !== 'string')
            return fail(location, 'formula 需要是文字');
        const { result: _untrustedCache, ...formula } = value;
        return { ...formula, value: null };
    }
    if (Object.hasOwn(value, 'text') && Object.hasOwn(value, 'value'))
        return fail(location, 'text 与 value 不能同时指定');
    const content = Object.hasOwn(value, 'text') ? value.text : value.value;
    if (!scalar(content) || Object.hasOwn(value, 'text') && typeof content !== 'string')
        return fail(location, '值对象需要有效的 value 或 text');
    const { text: _text, ...styles } = value;
    return { ...styles, value: content };
}
function columnsFrom(value, location) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value) || value.length > spreadsheet_engine_1.SPREADSHEET_LIMITS.columns)
        return fail(location, 'columns 需要是最多 100 列的数组');
    const columns = value.map((item, index) => {
        if (typeof item === 'string')
            return { name: item, key: item };
        if (object(item) && typeof item.header === 'string' && (item.key === undefined || typeof item.key === 'string'))
            return { name: item.header, key: item.key || item.header };
        return fail(`${location} 第 ${index + 1} 列`, '列名需要文字或 {header,key}');
    });
    if (new Set(columns.map(column => column.key)).size !== columns.length)
        return fail(location, 'columns 的字段名不能重复');
    return columns;
}
function sheetFromRows(raw, index, inferTypes) {
    if (!object(raw))
        return fail(`第 ${index + 1} 张工作表`, '工作表结构无效');
    const name = typeof raw.name === 'string' ? raw.name : `工作表${index + 1}`, location = `工作表“${name}”`;
    if (!Array.isArray(raw.rows))
        return fail(location, '需要 rows 行数组');
    const columns = columnsFrom(raw.columns, location);
    const rows = raw.rows.map((row, rowIndex) => {
        if (Array.isArray(row))
            return row;
        if (!object(row))
            return fail(`${location} 第 ${rowIndex + 1} 行`, '数据行不是数组或对象');
        if (!columns.length)
            return fail(`${location} 第 ${rowIndex + 1} 行`, '对象行需要对应的 columns 字段');
        const unknown = Object.keys(row).filter(key => !columns.some(column => column.key === key));
        if (unknown.length)
            return fail(`${location} 第 ${rowIndex + 1} 行`, `字段 ${unknown.join('、')} 未声明在 columns 中`);
        return columns.map(column => Object.hasOwn(row, column.key) ? row[column.key] : null);
    });
    if (columns.length)
        rows.unshift(columns.map(column => ({ value: column.name, bold: true })));
    if (rows.length > spreadsheet_engine_1.SPREADSHEET_LIMITS.rows)
        return fail(location, '含表头最多 10000 行，生成内容未被截断');
    let columnCount = Math.max(1, columns.length);
    const cells = {};
    rows.forEach((row, rowIndex) => {
        if (row.length > spreadsheet_engine_1.SPREADSHEET_LIMITS.columns)
            return fail(`${location} 第 ${rowIndex + 1} 行`, '最多 100 列，生成内容未被截断');
        columnCount = Math.max(columnCount, row.length);
        row.forEach((value, columnIndex) => {
            const address = `${(0, spreadsheet_engine_1.columnLabel)(columnIndex + 1)}${rowIndex + 1}`;
            cells[address] = generatedCell(value, `${location}!${address}`, inferTypes && !(columns.length && rowIndex === 0));
        });
    });
    return (0, spreadsheet_generated_formatting_1.applyGeneratedSheetFormatting)({ id: `generated-sheet-${index + 1}`, name, rowCount: Math.max(50, rows.length), columnCount: Math.max(12, columnCount), cells }, raw.formatting);
}
function withMissingInputs(document, meta) {
    if (!object(meta) || meta.missingInputs === undefined)
        return document;
    if (!Array.isArray(meta.missingInputs) || !meta.missingInputs.every(item => typeof item === 'string'))
        return fail('meta.missingInputs', '需要完整的文字数组');
    const missing = meta.missingInputs.filter(item => item.trim());
    if (!missing.length || document.sheets.some(sheet => sheet.id === NOTES_ID))
        return document;
    let name = '资料说明', suffix = 2;
    while (document.sheets.some(sheet => sheet.name === name))
        name = `资料说明${suffix++}`;
    const cells = { A1: { value: '待补充资料', bold: true } };
    missing.forEach((value, index) => { cells[`A${index + 2}`] = { value }; });
    return { ...document, sheets: [...document.sheets, { id: NOTES_ID, name, rowCount: Math.max(50, missing.length + 1), columnCount: 12, cells }] };
}
function spreadsheetMissingInputs(document) {
    const sheet = document.sheets.find(item => item.id === NOTES_ID);
    return sheet ? Object.entries(sheet.cells).filter(([address, cell]) => /^A(?:[2-9]|[1-9]\d+)$/.test(address) && typeof cell.value === 'string').sort(([first], [second]) => Number(first.slice(1)) - Number(second.slice(1))).map(([, cell]) => String(cell.value)) : [];
}
function parseDelimited(raw, separator) {
    const rows = [];
    let row = [], cell = '', quoted = false;
    for (let index = 0; index < raw.length; index++) {
        const character = raw[index];
        if (character === '"') {
            if (quoted && raw[index + 1] === '"') {
                cell += '"';
                index++;
            }
            else if (!cell || quoted)
                quoted = !quoted;
            else
                cell += character;
        }
        else if (character === separator && !quoted) {
            row.push(cell);
            cell = '';
        }
        else if ((character === '\n' || character === '\r') && !quoted) {
            row.push(cell);
            rows.push(row);
            row = [];
            cell = '';
            if (character === '\r' && raw[index + 1] === '\n')
                index++;
        }
        else
            cell += character;
    }
    if (quoted)
        return fail('表格文字', 'CSV/TSV 引号未闭合');
    if (cell || row.length) {
        row.push(cell);
        rows.push(row);
    }
    return rows;
}
function markdownRow(line) {
    return line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'));
}
function delimitedStructure(raw) {
    const lines = raw.split(/\r?\n/).filter(line => line.trim());
    let rows;
    if (lines.length > 1 && lines[0].includes('|') && markdownRow(lines[1]).every(cell => /^:?-{3,}:?$/.test(cell)))
        rows = [markdownRow(lines[0]), ...lines.slice(2).map(markdownRow)];
    else if (raw.includes('\t') || raw.includes(','))
        rows = parseDelimited(raw, raw.includes('\t') ? '\t' : ',');
    else
        return fail('生成内容', '需要有效工作簿 JSON、CSV、TSV 或 Markdown 表格');
    return { sheets: [{ name: '数据', columns: rows[0] || [], rows: rows.slice(1) }] };
}
function spreadsheetFromText(text, fallbackTitle) {
    if (typeof text !== 'string' || text.length > 1_000_000)
        return fail('生成内容', '表格文字最多支持 1000000 个字符');
    let raw = text.replace(/^\uFEFF/, '').trim();
    const fences = [...raw.matchAll(/```([^\n`]*)\n([\s\S]*?)```/g)];
    if (fences.length > 1)
        return fail('生成内容', '发现多个代码块，请提供单份完整工作簿');
    if (fences.length === 1)
        raw = fences[0][2].trim();
    let source, inferTypes = false;
    if (/^[{[]/.test(raw)) {
        try {
            source = JSON.parse(raw);
        }
        catch {
            return fail('生成内容', '表格 JSON 格式无效，请检查括号与完整性');
        }
    }
    else {
        if (raw.includes('```') || /"sheets"\s*:/.test(raw))
            return fail('生成内容', '表格 JSON 不完整，不能按 CSV 处理');
        source = delimitedStructure(raw);
        inferTypes = true;
    }
    if (!object(source))
        return fail('生成内容', '需要包含 sheets 的工作簿对象');
    const title = typeof source.title === 'string' ? source.title : fallbackTitle;
    let document;
    if (source.schemaVersion === 1 && source.kind === 'excel')
        document = (0, spreadsheet_engine_1.validateSpreadsheetDocument)(source);
    else {
        if (!Array.isArray(source.sheets) || !source.sheets.length)
            return fail('生成内容', '缺少 sheets 工作表数组');
        document = { schemaVersion: 1, kind: 'excel', title, sheets: source.sheets.map((sheet, index) => sheetFromRows(sheet, index, inferTypes)) };
    }
    return (0, spreadsheet_engine_1.validateSpreadsheetDocument)(withMissingInputs(document, source.meta));
}
