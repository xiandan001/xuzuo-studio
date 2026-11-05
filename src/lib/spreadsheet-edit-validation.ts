import type { SpreadsheetDocument, SpreadsheetSheet } from '../spreadsheet-types';
import { SPREADSHEET_LIMITS, validateSpreadsheetDocument } from './spreadsheet-engine';

const counts = new WeakMap<SpreadsheetSheet, number>();
const count = (sheet: SpreadsheetSheet) => { const known = counts.get(sheet); if (known !== undefined) return known; const value = Object.keys(sheet.cells).length; counts.set(sheet, value); return value; };

// Normal cell edits are constructed locally; validate just those cells here.
// The worker and saved/exported file still validate the complete canonical workbook.
export function validateSpreadsheetEdit(previous: SpreadsheetDocument, sheet: SpreadsheetSheet, addresses?: string[]): SpreadsheetDocument {
  if (!addresses?.length) return validateSpreadsheetDocument({ ...previous, sheets: previous.sheets.map(item => item.id === sheet.id ? sheet : item) });
  const before = previous.sheets.find(item => item.id === sheet.id);
  if (!before) throw new Error('工作表已变化，请重新选择。');
  const keys = [...new Set(addresses)], cells = Object.fromEntries(keys.filter(address => sheet.cells[address]).map(address => [address, sheet.cells[address]]));
  const checked = validateSpreadsheetDocument({ ...previous, sheets: [{ ...sheet, cells }] }).sheets[0];
  const nextCount = count(before) + keys.reduce((delta, address) => delta + Number(!!sheet.cells[address]) - Number(!!before.cells[address]), 0);
  if (previous.sheets.reduce((total, item) => total + (item.id === sheet.id ? nextCount : count(item)), 0) > SPREADSHEET_LIMITS.cells) throw new Error('工作簿最多保存 100000 个非空单元格，请拆分。');
  const next = { ...sheet, cells: { ...sheet.cells, ...checked.cells } }; counts.set(next, nextCount);
  return { ...previous, sheets: previous.sheets.map(item => item.id === sheet.id ? next : item) };
}
