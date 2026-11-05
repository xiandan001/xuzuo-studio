// Generated from src/lib/spreadsheet-generated-formatting.ts; run scripts/build-spreadsheet-runtime.mjs.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyGeneratedSheetFormatting = applyGeneratedSheetFormatting;
const spreadsheet_engine_1 = require("./spreadsheet-engine.cjs");
const object = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const formats = { General: 'general', general: 'general', '0': 'integer', '0.00': 'number', '0.00%': 'percent', '"¥"#,##0.00': 'currency' };
const invalid = (sheet, message) => { throw new Error(`工作表“${sheet.name}”的 formatting：${message}，原内容未被丢弃。`); };
function applyGeneratedSheetFormatting(sheet, raw) {
    if (raw === undefined)
        return sheet;
    if (!object(raw))
        return invalid(sheet, '需要样式对象');
    const unsupported = Object.keys(raw).filter(key => !['boldRanges', 'columnWidths', 'numberFormats'].includes(key));
    if (unsupported.length)
        return invalid(sheet, `暂不支持字段 ${unsupported.join('、')}`);
    const cells = { ...sheet.cells }, columnWidths = { ...sheet.columnWidths };
    let applied = 0;
    function apply(range, changes) {
        if (typeof range !== 'string')
            return invalid(sheet, '区域需要 A1 或 A1:D8 形式');
        const parts = range.split(':');
        if (!parts[0] || parts.length > 2)
            return invalid(sheet, `区域 ${range} 无效`);
        const first = (0, spreadsheet_engine_1.parseCellAddress)(parts[0]), last = (0, spreadsheet_engine_1.parseCellAddress)(parts[1] || parts[0]);
        const top = Math.min(first.row, last.row), bottom = Math.max(first.row, last.row), left = Math.min(first.column, last.column), right = Math.max(first.column, last.column);
        applied += (bottom - top + 1) * (right - left + 1);
        if (bottom > sheet.rowCount || right > sheet.columnCount || applied > spreadsheet_engine_1.SPREADSHEET_LIMITS.cells)
            return invalid(sheet, '样式区域超出工作表或超过100000个单元格');
        for (let row = top; row <= bottom; row++)
            for (let column = left; column <= right; column++) {
                const address = `${(0, spreadsheet_engine_1.columnLabel)(column)}${row}`;
                cells[address] = { ...(cells[address] || { value: null }), ...changes };
            }
    }
    if (raw.boldRanges !== undefined) {
        if (!Array.isArray(raw.boldRanges) || raw.boldRanges.length > 200)
            return invalid(sheet, 'boldRanges需要最多200个区域');
        for (const range of raw.boldRanges)
            apply(range, { bold: true });
    }
    if (raw.numberFormats !== undefined) {
        if (!object(raw.numberFormats) || Object.keys(raw.numberFormats).length > 200)
            return invalid(sheet, 'numberFormats需要区域与数字格式对象');
        for (const [range, mask] of Object.entries(raw.numberFormats)) {
            if (typeof mask !== 'string' || !Object.hasOwn(formats, mask))
                return invalid(sheet, `数字格式 ${String(mask)} 尚不支持，请使用 General、0、0.00、0.00% 或人民币格式`);
            apply(range, { format: formats[mask] });
        }
    }
    if (raw.columnWidths !== undefined) {
        if (!object(raw.columnWidths))
            return invalid(sheet, 'columnWidths需要列名与字符宽度对象');
        for (const [label, width] of Object.entries(raw.columnWidths)) {
            const address = (0, spreadsheet_engine_1.parseCellAddress)(`${label}1`);
            if (address.address !== `${label}1` || address.column > sheet.columnCount || typeof width !== 'number' || !Number.isFinite(width) || width < 8.43 || width > 90)
                return invalid(sheet, '列宽需为8.43–90字符，且属于当前工作表');
            columnWidths[label] = Math.round(width * 7 + 5);
        }
    }
    return { ...sheet, cells, ...(Object.keys(columnWidths).length ? { columnWidths } : {}) };
}
