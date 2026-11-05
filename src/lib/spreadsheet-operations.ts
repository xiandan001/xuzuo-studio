import type { SpreadsheetCalculation, SpreadsheetCell, SpreadsheetSheet } from '../spreadsheet-types';
import { cellToInput, columnLabel, parseCellAddress } from './spreadsheet-engine';

export function spreadsheetRange(sheet: SpreadsheetSheet, text: string) {
  const pieces = text.trim().split(':'); if (!pieces[0] || pieces.length > 2) throw new Error('区域请填写 A1 或 A1:D20。');
  const first = parseCellAddress(pieces[0]), last = parseCellAddress(pieces[1] || pieces[0]);
  const top = Math.min(first.row, last.row), bottom = Math.max(first.row, last.row), left = Math.min(first.column, last.column), right = Math.max(first.column, last.column);
  if (bottom > sheet.rowCount || right > sheet.columnCount || (bottom - top + 1) * (right - left + 1) > 100000) throw new Error('区域超出当前工作表或超过 100000 个单元格，请缩小范围。');
  return { top, bottom, left, right, text: `${columnLabel(left)}${top}:${columnLabel(right)}${bottom}` };
}

export function clearSpreadsheetRange(sheet: SpreadsheetSheet, range: string): SpreadsheetSheet {
  const area = spreadsheetRange(sheet, range), multiple = area.top !== area.bottom || area.left !== area.right;
  if (multiple && (sheet.view?.sort || sheet.view?.filter?.text)) throw new Error('请先清除查看排序和筛选，再清空多格区域；隐藏行未改变。');
  const cells = { ...sheet.cells }; let changed = false;
  for (const [address, cell] of Object.entries(sheet.cells)) {
    const position = parseCellAddress(address);
    if (position.row < area.top || position.row > area.bottom || position.column < area.left || position.column > area.right || cell.value === null && cell.formula === undefined) continue;
    const cleared = { ...cell, value: null }; delete cleared.formula; cells[address] = cleared; changed = true;
  }
  return changed ? { ...sheet, cells } : sheet;
}

export function spreadsheetRangeText(sheet: SpreadsheetSheet, range: string, visibleRows?: number[]): string {
  const area = spreadsheetRange(sheet, range), rows = visibleRows ? visibleRows.filter(row => row >= area.top && row <= area.bottom) : Array.from({ length: area.bottom - area.top + 1 }, (_, index) => index + area.top);
  let characters = 0;
  return rows.map(row => Array.from({ length: area.right - area.left + 1 }, (_, index) => {
    const value = cellToInput(sheet.cells[`${columnLabel(area.left + index)}${row}`]);
    const encoded = /[\t\n\r"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
    characters += encoded.length + 1; if (characters > 4000000) throw new Error('复制内容超过 400 万字符，请缩小区域后分批复制。');
    return encoded;
  }).join('\t')).join('\n');
}

export function parseSpreadsheetClipboard(raw: string): string[][] {
  if (raw.length > 4000000) throw new Error('粘贴内容超过 400 万字符，请拆成较小区域。');
  const rows: string[][] = [[]]; let value = '', quoted = false;
  const text = raw.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"' && (quoted || !value)) { if (quoted && text[index + 1] === '"') { value += '"'; index++; } else quoted = !quoted; }
    else if (!quoted && (char === '\t' || char === '\n')) { rows.at(-1)!.push(value); value = ''; if (char === '\n') rows.push([]); }
    else value += char;
  }
  if (quoted) throw new Error('粘贴内容的引号未闭合，当前表格未改变。');
  rows.at(-1)!.push(value); return rows;
}

export function shiftSpreadsheetFormula(formula: string, rowDelta: number, columnDelta = 0): string {
  return formula.replace(/"(?:[^"]|"")*"|'(?:[^']|'')*'|\$?[A-Z]{1,3}\$?[1-9]\d{0,6}/gi, (token, offset: number) => {
    if (token.startsWith('"') || token.startsWith("'")) return token;
    if (/[\p{L}\p{N}_.]/u.test(formula[offset - 1] || '') || /[\p{L}\p{N}_.!]/u.test(formula[offset + token.length] || '')) return token;
    const match = /^(\$?)([A-Z]+)(\$?)(\d+)$/i.exec(token)!, address = parseCellAddress(token);
    const row = address.row + (match[3] ? 0 : rowDelta), column = address.column + (match[1] ? 0 : columnDelta);
    if (row < 1 || row > 1048576 || column < 1 || column > 16384) throw new Error('填充会产生超出 Excel 范围的公式引用，原区域未改变。');
    return `${match[1]}${columnLabel(column)}${match[3]}${row}`;
  });
}

export function fillSpreadsheetDown(sheet: SpreadsheetSheet, range: string): SpreadsheetSheet {
  if (sheet.view?.sort || sheet.view?.filter?.text) throw new Error('请先清除查看排序和筛选，再按原始行号填充区域。');
  const area = spreadsheetRange(sheet, range); if (area.top === area.bottom) throw new Error('向下填充需要至少选择两行。');
  const cells = { ...sheet.cells };
  for (let row = area.top + 1; row <= area.bottom; row++) for (let column = area.left; column <= area.right; column++) {
    const label = columnLabel(column), source = sheet.cells[`${label}${area.top}`], target = `${label}${row}`;
    if (!source) delete cells[target]; else cells[target] = { ...source, ...(source.formula !== undefined ? { formula: shiftSpreadsheetFormula(source.formula, row - area.top) } : {}) };
  }
  return { ...sheet, cells };
}

const cellValue = (cell?: SpreadsheetCell, result?: SpreadsheetCalculation['cells'][string][string]) => result?.status === 'calculated' || result?.status === 'value' ? result.value : cell?.value;
function compareValues(left: unknown, right: unknown, direction: 'asc' | 'desc') {
  const leftEmpty = left === null || left === undefined || left === '', rightEmpty = right === null || right === undefined || right === '';
  if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1;
  return (typeof left === 'number' && typeof right === 'number' ? left - right : String(left ?? '').localeCompare(String(right ?? ''), 'zh-CN', { numeric: true })) * (direction === 'asc' ? 1 : -1);
}
export function spreadsheetDisplayRows(sheet: SpreadsheetSheet, calculation?: SpreadsheetCalculation): number[] {
  const view = sheet.view, first = view?.header ? 2 : 1, results = calculation?.cells[sheet.id];
  let rows = Array.from({ length: Math.max(0, sheet.rowCount - first + 1) }, (_, index) => index + first);
  if (view?.filter?.text.trim()) { const column = columnLabel(view.filter.column), query = view.filter.text.trim().toLocaleLowerCase(); rows = rows.filter(row => String(cellValue(sheet.cells[`${column}${row}`], results?.[`${column}${row}`]) ?? '').toLocaleLowerCase().includes(query)); }
  if (view?.sort) {
    const column = columnLabel(view.sort.column);
    rows.sort((left, right) => compareValues(cellValue(sheet.cells[`${column}${left}`], results?.[`${column}${left}`]), cellValue(sheet.cells[`${column}${right}`], results?.[`${column}${right}`]), view.sort!.direction) || left - right);
  }
  return view?.header ? [1, ...rows] : rows;
}

export function sortSpreadsheetValues(sheet: SpreadsheetSheet, range: string, column: number, direction: 'asc' | 'desc'): SpreadsheetSheet {
  if (sheet.view?.sort || sheet.view?.filter?.text) throw new Error('请先清除查看排序和筛选，再重排原始区域。');
  const area = spreadsheetRange(sheet, range); if (column < area.left || column > area.right) throw new Error('排序依据列需包含在选中区域内。');
  if (Object.values(sheet.cells).some(cell => cell.formula !== undefined)) throw new Error('含公式的数据请使用查看排序，避免改变公式引用。');
  const label = columnLabel(column), rows = Array.from({ length: area.bottom - area.top + 1 }, (_, index) => index + area.top);
  rows.sort((a, b) => compareValues(sheet.cells[`${label}${a}`]?.value, sheet.cells[`${label}${b}`]?.value, direction) || a - b);
  const cells = { ...sheet.cells };
  rows.forEach((sourceRow, index) => { for (let col = area.left; col <= area.right; col++) { const source = sheet.cells[`${columnLabel(col)}${sourceRow}`], target = `${columnLabel(col)}${area.top + index}`; if (source) cells[target] = { ...source }; else delete cells[target]; } });
  return { ...sheet, cells, view: undefined };
}

export function spreadsheetColumnGeometry(sheet: SpreadsheetSheet) {
  const offsets = [0], widths = Array.from({ length: sheet.columnCount }, (_, index) => sheet.columnWidths?.[columnLabel(index + 1)] || 136);
  for (const width of widths) offsets.push(offsets.at(-1)! + width);
  return { offsets, widths, width: offsets.at(-1)! };
}
