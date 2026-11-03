import type { SpreadsheetCell, SpreadsheetDocument, SpreadsheetSheet } from '../spreadsheet-types';
import { parseCellAddress } from './spreadsheet-engine';

interface CellPatch { sheetId: string; address: string; before?: SpreadsheetCell; after?: SpreadsheetCell; }
interface CellTransaction { id: number; patches: CellPatch[]; }
export interface SpreadsheetScopeHistory { past: CellTransaction[]; future: CellTransaction[]; sequence: number; reason?: string; }
export interface SpreadsheetScope { sheetId: string; range: string; contains: (address: string) => boolean; }
const MAX_TRANSACTION_CELLS = 2000, MAX_HISTORY_CELLS = 8000, MAX_HISTORY_CHARACTERS = 512000;
export const emptySpreadsheetScopeHistory = (): SpreadsheetScopeHistory => ({ past: [], future: [], sequence: 0 });
const sameCell = (left?: SpreadsheetCell, right?: SpreadsheetCell) => left === right || !!left && !!right && left.value === right.value && left.formula === right.formula && left.bold === right.bold && left.align === right.align && left.format === right.format;
const copy = (value?: SpreadsheetCell) => value ? { ...value } : undefined;

export function spreadsheetHistoryScope(sheet: SpreadsheetSheet, range: string): SpreadsheetScope {
  const parts = range.trim().split(':');
  if (!parts[0] || parts.length > 2) throw new Error('局部区域请使用 A1 或 A1:D20 格式。');
  const first = parseCellAddress(parts[0]), last = parseCellAddress(parts[1] || parts[0]);
  const top = Math.min(first.row, last.row), bottom = Math.max(first.row, last.row), left = Math.min(first.column, last.column), right = Math.max(first.column, last.column);
  if (bottom > sheet.rowCount || right > sheet.columnCount) throw new Error('局部区域超出当前工作表，请缩小范围。');
  return { sheetId: sheet.id, range: first.address === last.address ? first.address : `${first.address}:${last.address}`, contains: address => { const cell = parseCellAddress(address); return cell.row >= top && cell.row <= bottom && cell.column >= left && cell.column <= right; } };
}

function changedCells(previous: SpreadsheetDocument, next: SpreadsheetDocument, knownCells?: { sheetId: string; address: string }[]): CellPatch[] | undefined {
  const patches: CellPatch[] = [];
  for (const after of next.sheets) {
    const before = previous.sheets.find(sheet => sheet.id === after.id);
    if (!before || before.cells === after.cells) continue;
    const addresses = knownCells ? knownCells.filter(cell => cell.sheetId === after.id).map(cell => cell.address) : new Set([...Object.keys(before.cells), ...Object.keys(after.cells)]);
    for (const address of addresses) {
      if (sameCell(before.cells[address], after.cells[address])) continue;
      if (patches.length >= MAX_TRANSACTION_CELLS) return undefined;
      patches.push({ sheetId: after.id, address, before: copy(before.cells[address]), after: copy(after.cells[address]) });
    }
  }
  return patches;
}
function bounded(history: SpreadsheetScopeHistory): SpreadsheetScopeHistory {
  let past = history.past;
  const characters = (entries: CellTransaction[]) => entries.reduce((sum, entry) => sum + entry.patches.reduce((count, patch) => count + (typeof patch.before?.value === 'string' ? patch.before.value.length : 0) + (typeof patch.after?.value === 'string' ? patch.after.value.length : 0) + (patch.before?.formula?.length || 0) + (patch.after?.formula?.length || 0), 0), 0);
  while (past.length > 40 || past.reduce((sum, entry) => sum + entry.patches.length, 0) > MAX_HISTORY_CELLS || characters(past) > MAX_HISTORY_CHARACTERS) past = past.slice(1);
  return { ...history, past };
}
export function recordSpreadsheetScope(history: SpreadsheetScopeHistory, previous: SpreadsheetDocument, next: SpreadsheetDocument, knownCells?: { sheetId: string; address: string }[]): SpreadsheetScopeHistory {
  const patches = changedCells(previous, next, knownCells);
  if (!patches) return { ...emptySpreadsheetScopeHistory(), sequence: history.sequence + 1, reason: '这次修改超过局部历史容量，请使用工作簿撤销；当前内容保留。' };
  if (!patches.length) return history;
  return bounded({ past: [...history.past, { id: history.sequence + 1, patches }], future: [], sequence: history.sequence + 1 });
}
function prepare(history: SpreadsheetScopeHistory, direction: 'undo' | 'redo', document: SpreadsheetDocument, scope: SpreadsheetScope) {
  const entries = direction === 'undo' ? history.past : history.future;
  const sheet = document.sheets.find(item => item.id === scope.sheetId);
  if (!sheet) return { available: false, reason: '工作表已变化，请重新选择区域。' };
  for (let index = entries.length - 1; index >= 0; index--) {
    const patches = entries[index].patches.filter(patch => patch.sheetId === scope.sheetId && scope.contains(patch.address));
    if (!patches.length) continue;
    if (patches.some(patch => !sameCell(sheet.cells[patch.address], direction === 'undo' ? patch.after : patch.before))) return { available: false, reason: '区域内容与历史已不一致，当前未覆盖任何单元格；可使用工作簿撤销。' };
    return { available: true, entries, index, patches, sheet };
  }
  return { available: false, reason: history.reason || `此区域没有可${direction === 'undo' ? '撤销' : '重做'}的单元格修改。` };
}
export function inspectSpreadsheetScope(history: SpreadsheetScopeHistory, direction: 'undo' | 'redo', document: SpreadsheetDocument, scope: SpreadsheetScope) {
  const { available, reason } = prepare(history, direction, document, scope); return { available, reason };
}
export function applySpreadsheetScope(history: SpreadsheetScopeHistory, direction: 'undo' | 'redo', document: SpreadsheetDocument, scope: SpreadsheetScope) {
  const prepared = prepare(history, direction, document, scope);
  if (!prepared.available || !prepared.entries || prepared.index === undefined || !prepared.patches || !prepared.sheet) return { history, available: false, reason: prepared.reason };
  const { entries, index, patches, sheet } = prepared;
  const cells = { ...sheet.cells };
  for (const patch of patches) { const value = direction === 'undo' ? patch.before : patch.after; if (value) cells[patch.address] = { ...value }; else delete cells[patch.address]; }
  const remaining = entries[index].patches.filter(patch => !patches.includes(patch));
  const reduced = [...entries.slice(0, index), ...(remaining.length ? [{ ...entries[index], patches: remaining }] : []), ...entries.slice(index + 1)];
  const moved = { id: entries[index].id, patches };
  const updated = direction === 'undo' ? { ...history, past: reduced, future: [...history.future, moved] } : { ...history, past: [...history.past, moved], future: reduced };
  return { history: updated, available: true, document: { ...document, sheets: document.sheets.map(item => item.id === sheet.id ? { ...item, cells } : item) } };
}
