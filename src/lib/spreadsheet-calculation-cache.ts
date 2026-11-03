import type { SpreadsheetCalculation, SpreadsheetDocument } from '../spreadsheet-types';
import { calculateValidatedSpreadsheet, validateSpreadsheetDocument } from './spreadsheet-engine';

export function createSpreadsheetCalculationCache(dependencies = { validate: validateSpreadsheetDocument, calculate: calculateValidatedSpreadsheet }) {
  const validated = new WeakMap<SpreadsheetDocument, SpreadsheetDocument>();
  const signatures = new WeakMap<SpreadsheetDocument, string>();
  const calculated = new WeakMap<SpreadsheetDocument, SpreadsheetCalculation>();
  let previous: { signature: string; calculation: SpreadsheetCalculation } | undefined;
  function validate(input: SpreadsheetDocument): SpreadsheetDocument {
    const cached = validated.get(input); if (cached) return cached;
    const document = dependencies.validate(input);
    validated.set(input, document); validated.set(document, document); return document;
  }
  function signature(document: SpreadsheetDocument): string {
    const cached = signatures.get(document); if (cached) return cached;
    const result = JSON.stringify(document.sheets.map(sheet => [sheet.id, sheet.name, sheet.rowCount, sheet.columnCount, Object.entries(sheet.cells).filter(([, cell]) => cell.formula !== undefined || cell.value !== null).map(([address, cell]) => [address, cell.value, cell.formula])]));
    signatures.set(document, result); return result;
  }
  return {
    validate,
    calculate(input: SpreadsheetDocument): SpreadsheetCalculation {
      const cached = calculated.get(input); if (cached) return cached;
      const document = validate(input), key = signature(document);
      const calculation = previous?.signature === key ? previous.calculation : dependencies.calculate(document);
      previous = { signature: key, calculation }; calculated.set(input, calculation); calculated.set(document, calculation); return calculation;
    },
  };
}
