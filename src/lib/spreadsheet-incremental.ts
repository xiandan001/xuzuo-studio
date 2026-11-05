import type { SpreadsheetCalculation, SpreadsheetDocument } from '../spreadsheet-types';
import { calculateValidatedSpreadsheet, spreadsheetDependencies, validateSpreadsheetDocument } from './spreadsheet-engine';

export function createIncrementalSpreadsheetCalculator() {
  let previous: { document: SpreadsheetDocument; result: SpreadsheetCalculation; graph?: Map<string, Set<string>> } | undefined;
  let stats = { mode: 'full', reusedCells: 0, changedCells: 0 };
  const shape = (document: SpreadsheetDocument) => JSON.stringify(document.sheets.map(sheet => [sheet.id, sheet.name, sheet.rowCount, sheet.columnCount]));
  return {
    calculate(input: SpreadsheetDocument): SpreadsheetCalculation {
      const document = validateSpreadsheetDocument(input), changed = new Set<string>(); let formulasChanged = false;
      const compatible = previous && shape(previous.document) === shape(document) && !previous.result.issues.some(issue => issue.code === '#LIMIT!');
      if (compatible) for (const sheet of document.sheets) {
        const old = previous!.document.sheets.find(item => item.id === sheet.id)!;
        for (const address of new Set([...Object.keys(old.cells), ...Object.keys(sheet.cells)])) {
          const before = old.cells[address], after = sheet.cells[address];
          if (before?.formula !== after?.formula) formulasChanged = true;
          if (before?.formula !== after?.formula || before?.value !== after?.value) changed.add(`${sheet.id}!${address}`);
        }
      }
      const graph = compatible && !formulasChanged ? previous!.graph : spreadsheetDependencies(document);
      if (compatible && !changed.size) { previous = { document, result: previous!.result, graph }; stats = { mode: 'reused', reusedCells: Object.values(previous.result.cells).reduce((sum, cells) => sum + Object.keys(cells).length, 0), changedCells: 0 }; return previous.result; }
      let reusable: SpreadsheetCalculation['cells'] | undefined;
      if (compatible && !formulasChanged && graph) {
        const invalid = new Set(changed), queue = [...changed];
        for (let index = 0; index < queue.length; index++) for (const parent of graph.get(queue[index]) || []) if (!invalid.has(parent)) { invalid.add(parent); queue.push(parent); }
        reusable = Object.fromEntries(document.sheets.map(sheet => [sheet.id, Object.fromEntries(Object.entries(previous!.result.cells[sheet.id] || {}).filter(([address]) => !!sheet.cells[address] && !invalid.has(`${sheet.id}!${address}`)))]));
      }
      const result = calculateValidatedSpreadsheet(document, reusable);
      stats = { mode: reusable ? 'incremental' : 'full', reusedCells: reusable ? Object.values(reusable).reduce((sum, cells) => sum + Object.keys(cells).length, 0) : 0, changedCells: changed.size };
      previous = { document, result, graph }; return result;
    },
    stats: () => ({ ...stats }),
  };
}
