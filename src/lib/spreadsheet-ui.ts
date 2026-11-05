import type { SpreadsheetCell, SpreadsheetCellResult, SpreadsheetDocument, SpreadsheetRecord, SpreadsheetSheet } from '../spreadsheet-types';
import { cellFromInput, columnLabel, parseCellAddress, SPREADSHEET_LIMITS, validateSpreadsheetDocument } from './spreadsheet-engine';
import { spreadsheetFromText } from './spreadsheet-generated';
import { parseSpreadsheetClipboard } from './spreadsheet-operations';
export { spreadsheetFromText } from './spreadsheet-generated';

export interface SpreadsheetRecovery { document: SpreadsheetDocument; sourceArtifactIds: string[]; baseRevision: number; }
export const spreadsheetRecoveryKey = (projectId: string) => `xuzuo.spreadsheet-recovery.${projectId}`;
export const spreadsheetConflictKey = (projectId: string) => `xuzuo.spreadsheet-conflict.${projectId}`;
export const spreadsheetFormKey = (projectId: string) => `xuzuo.spreadsheet-form.${projectId}`;
export const SPREADSHEET_ROW_LIMIT = SPREADSHEET_LIMITS.rows;
export const SPREADSHEET_COLUMN_LIMIT = SPREADSHEET_LIMITS.columns;

export function newSpreadsheetSheet(name = '工作表1'): SpreadsheetSheet {
  return { id: `sheet-${crypto.randomUUID()}`, name, rowCount: 50, columnCount: 12, cells: {} };
}
export function emptySpreadsheet(title: string): SpreadsheetDocument {
  return { schemaVersion: 1, kind: 'excel', title, sheets: [newSpreadsheetSheet()] };
}
export function readSpreadsheetRecovery(raw: string | null): SpreadsheetRecovery | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw);
    if (!Number.isSafeInteger(value?.baseRevision) || value.baseRevision < 0 || !Array.isArray(value.sourceArtifactIds) || !value.sourceArtifactIds.every((id: unknown) => typeof id === 'string')) return undefined;
    const title = value.document?.title;
    if (typeof title !== 'string' || title.length > 120) return undefined;
    const document = validateSpreadsheetDocument({ ...value.document, title: title.trim() ? title : '未命名工作簿' });
    return { document: { ...document, title }, sourceArtifactIds: value.sourceArtifactIds, baseRevision: value.baseRevision };
  } catch { return undefined; }
}
export function resolveSpreadsheetRecovery(saved: SpreadsheetRecord | null, recovery?: SpreadsheetRecovery) {
  const same = !!saved && !!recovery && JSON.stringify(saved.document) === JSON.stringify(recovery.document);
  const usable = recovery && (!saved || recovery.baseRevision === saved.revision) && !same;
  return { document: usable ? recovery.document : saved?.document, sourceArtifactIds: usable ? recovery.sourceArtifactIds : saved?.sourceArtifactIds || [], dirty: !!usable, conflict: recovery && saved && recovery.baseRevision !== saved.revision && !same ? recovery : undefined };
}
export function hasSpreadsheetEdits(document: SpreadsheetDocument, originalTitle: string): boolean {
  if (document.title !== originalTitle || document.sheets.length !== 1) return true;
  const sheet = document.sheets[0];
  return !['工作表1', '项目记录'].includes(sheet.name) || sheet.rowCount !== 50 || sheet.columnCount !== 12 || !!sheet.columnWidths || !!sheet.view || Object.values(sheet.cells).some(cell => cell.formula !== undefined || cell.value !== null && cell.value !== '' || cell.bold !== undefined || cell.align !== undefined || cell.format !== undefined);
}

export function legacySpreadsheetDocument(raw: string | null, title: string): SpreadsheetDocument | undefined {
  if (!raw) return undefined;
  let old: Record<string, unknown>;
  try { old = JSON.parse(raw); } catch { throw new Error('旧版表格草稿无法读取，原草稿已保留；请先恢复草稿后再创建新工作簿。'); }
  if (!old || typeof old !== 'object' || Array.isArray(old)) throw new Error('旧版表格草稿结构无效，原草稿已保留。');
  const actualTitle = typeof old.title === 'string' && old.title.trim() ? old.title : title;
  const hasCells = Array.isArray(old.cells) && old.cells.every(row => Array.isArray(row));
  const hasCellContent = hasCells && (old.cells as unknown[][]).some(row => row.some(cell => cell !== null && String(cell).trim()));
  if (!hasCellContent && typeof old.body === 'string' && old.body.trim()) return spreadsheetFromText(old.body, actualTitle);
  if (!hasCells) return undefined;
  const rows = (old.cells as unknown[][]).map(row => row.map(value => {
    if (typeof value !== 'string') return value;
    if (/^\s*\{/.test(value)) {
      try { const parsed = JSON.parse(value); if (typeof parsed?.formula === 'string') return parsed; } catch { /* Ordinary JSON-like text is retained as literal text. */ }
    }
    return cellFromInput(value);
  }));
  return spreadsheetFromText(JSON.stringify({ title: actualTitle, sheets: [{ name: '项目记录', rows }] }), actualTitle);
}

export function displaySpreadsheetCell(cell?: SpreadsheetCell, result?: SpreadsheetCellResult): string {
  if (cell?.formula !== undefined && (result?.status === 'error' || result?.status === 'unsupported')) return result.error || (result.status === 'unsupported' ? '#不支持' : '#错误');
  const calculated = cell?.formula !== undefined && (result?.status === 'calculated' || result?.status === 'value');
  const value = calculated ? result.value : cell?.value;
  if (value === null || value === undefined) return !calculated && cell?.formula !== undefined ? '待计算' : '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value);
  if (cell?.format === 'currency') return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(value);
  if (cell?.format === 'percent') return new Intl.NumberFormat('zh-CN', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  if (cell?.format === 'integer') return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(value);
  if (cell?.format === 'number') return new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  return String(value);
}
export function updateSpreadsheetCell(sheet: SpreadsheetSheet, address: string, input: string): SpreadsheetSheet {
  return { ...sheet, cells: { ...sheet.cells, [address]: cellFromInput(input, sheet.cells[address]) } };
}
export function pasteSpreadsheetCells(sheet: SpreadsheetSheet, address: string, raw: string): SpreadsheetSheet {
  const start = parseCellAddress(address);
  if (!start) throw new Error('请选择有效的单元格。');
  const rows = parseSpreadsheetClipboard(raw);
  const rowCount = Math.max(sheet.rowCount, start.row + rows.length - 1);
  const columnCount = Math.max(sheet.columnCount, start.column + Math.max(...rows.map(row => row.length)) - 1);
  if (rowCount > SPREADSHEET_ROW_LIMIT || columnCount > SPREADSHEET_COLUMN_LIMIT) throw new Error(`粘贴超出 ${SPREADSHEET_ROW_LIMIT} 行、${SPREADSHEET_COLUMN_LIMIT} 列限制，当前表格未改变。`);
  if (rows.reduce((total, row) => total + row.length, 0) > SPREADSHEET_LIMITS.cells) throw new Error('单次粘贴超过 100000 个单元格，请拆分工作簿。');
  const cells = { ...sheet.cells };
  rows.forEach((row, rowOffset) => row.forEach((input, columnOffset) => {
    const target = `${columnLabel(start.column + columnOffset)}${start.row + rowOffset}`;
    cells[target] = cellFromInput(input, cells[target]);
  }));
  return { ...sheet, rowCount, columnCount, cells };
}
export function nextSpreadsheetName(sheets: SpreadsheetSheet[]): string {
  let number = sheets.length + 1;
  while (sheets.some(sheet => sheet.name === `工作表${number}`)) number++;
  return `工作表${number}`;
}
export function spreadsheetNameError(name: string, sheets: SpreadsheetSheet[], currentId: string): string {
  if (!name.trim() || name.trim().length > 31 || /[\\/*?:\[\]]/.test(name) || /^'|'$/.test(name.trim())) return '工作表名称需为 1–31 个字符，不能包含 \\ / * ? : [ ]，不能以单引号开头或结尾。';
  if (sheets.some(sheet => sheet.id !== currentId && sheet.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase())) return '工作表名称不能重复。';
  return '';
}
export function renameSpreadsheetSheet(document: SpreadsheetDocument, sheetId: string, name: string): SpreadsheetDocument {
  const previous = document.sheets.find(sheet => sheet.id === sheetId);
  if (!previous) return document;
  const error = spreadsheetNameError(name, document.sheets, sheetId);
  if (error) throw new Error(error);
  const nextName = name.trim();
  const reference = `'${nextName.replaceAll("'", "''")}'!`;
  return { ...document, sheets: document.sheets.map(sheet => ({ ...sheet, name: sheet.id === sheetId ? nextName : sheet.name, cells: Object.fromEntries(Object.entries(sheet.cells).map(([address, cell]) => {
    if (cell.formula === undefined) return [address, cell];
    const formula = cell.formula.replace(/"(?:[^"]|"")*"|'(?:[^']|'')*'!|[\p{L}_][\p{L}\p{N}_.$]*!/gu, token => {
      if (token.startsWith('"')) return token;
      const sourceName = token.startsWith("'") ? token.slice(1, -2).replaceAll("''", "'") : token.slice(0, -1);
      return sourceName.toLocaleLowerCase() === previous.name.toLocaleLowerCase() ? reference : token;
    });
    return [address, formula === cell.formula ? cell : { ...cell, formula }];
  })) })) };
}

export const GRID_ROW_HEIGHT = 32;
export const GRID_COLUMN_WIDTH = 136;
export const GRID_HEADER_HEIGHT = 32;
export const GRID_ROW_HEADER_WIDTH = 48;
export function spreadsheetVisibleRange(scroll: number, viewport: number, size: number, count: number, overscan = 2) {
  const start = Math.max(0, Math.min(count - 1, Math.floor(scroll / size) - overscan));
  const end = Math.min(count, Math.ceil((scroll + viewport) / size) + overscan);
  return { start, end };
}
