import { createIncrementalSpreadsheetCalculator } from '../lib/spreadsheet-incremental';
import type { SpreadsheetDocument } from '../spreadsheet-types';
import { spreadsheetDisplayRows } from '../lib/spreadsheet-operations';
const calculator = createIncrementalSpreadsheetCalculator();
self.onmessage = (event: MessageEvent<{ id: number; document: SpreadsheetDocument }>) => {
  const { id, document } = event.data;
  try { const calculation = calculator.calculate(document); self.postMessage({ id, calculation: { ...calculation, rowOrders: Object.fromEntries(document.sheets.map(sheet => [sheet.id, spreadsheetDisplayRows(sheet, calculation)])) } }); }
  catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : '工作簿结构需要修正后才能计算。' }); }
};
