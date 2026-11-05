import { describe, expect, it } from 'vitest';
import type { SpreadsheetDocument } from '../spreadsheet-types';
import { calculateSpreadsheet } from './spreadsheet-engine';
import { createIncrementalSpreadsheetCalculator } from './spreadsheet-incremental';

const workbook = (): SpreadsheetDocument => ({ schemaVersion: 1, kind: 'excel', title: '依赖计算', sheets: [{ id: 'one', name: '明细', rowCount: 10, columnCount: 5, cells: { A1: { value: 2 }, A2: { value: 3 }, B1: { value: null, formula: 'A1*2' }, B2: { value: null, formula: 'SUM(A1:A3)' }, C1: { value: null, formula: 'B1+B2' }, D1: { value: null, formula: 'ROUND(A2/3,2)' } } }, { id: 'two', name: '汇总', rowCount: 4, columnCount: 2, cells: { A1: { value: null, formula: "'明细'!C1" }, B1: { value: null, formula: 'IF(明细!A1>0,明细!A2,99)' } } }] });
describe('有界依赖增量计算与完整引擎结果一致', () => {
  it('单格修改重算跨表/链式/范围依赖，复用无关单元格结果', () => {
    const calculator = createIncrementalSpreadsheetCalculator(), original = workbook(), first = calculator.calculate(original), next = structuredClone(original);
    next.sheets[0].cells.A1.value = 10; const result = calculator.calculate(next);
    expect(result).toEqual(calculateSpreadsheet(next)); expect(result.cells.one.D1).toBe(first.cells.one.D1); expect(result.cells.one.B1).not.toBe(first.cells.one.B1); expect(result.cells.two.A1.value).toBe(33); expect(calculator.stats().mode).toBe('incremental');
  });
  it('原本空白的范围单元格新增值也会使SUM与下游失效', () => {
    const calculator = createIncrementalSpreadsheetCalculator(), original = workbook(); calculator.calculate(original); const next = structuredClone(original); next.sheets[0].cells.A3 = { value: 20 };
    expect(calculator.calculate(next)).toEqual(calculateSpreadsheet(next)); expect(calculator.calculate(next).cells.one.B2.value).toBe(25);
  });
  it('IF两条分支的依赖都跟踪，公式/工作表形状变化回退完整计算', () => {
    const calculator = createIncrementalSpreadsheetCalculator(), original = workbook(); calculator.calculate(original); const next = structuredClone(original); next.sheets[0].cells.A1.value = -1;
    expect(calculator.calculate(next).cells.two.B1.value).toBe(99); next.sheets[0].cells.B1.formula = 'A2*5'; expect(calculator.calculate(next)).toEqual(calculateSpreadsheet(next)); expect(calculator.stats().mode).toBe('full');
    next.sheets[0].rowCount = 20; expect(calculator.calculate(next)).toEqual(calculateSpreadsheet(next)); expect(calculator.stats().mode).toBe('full');
  });
  it('纯格式与列宽变化复用计算，查看筛选不进入公式输入', () => {
    const calculator = createIncrementalSpreadsheetCalculator(), original = workbook(), first = calculator.calculate(original), next = structuredClone(original); next.sheets[0].cells.A1.bold = true; next.sheets[0].columnWidths = { A: 320 }; next.sheets[0].view = { header: true, filter: { column: 1, text: '2' } };
    expect(calculator.calculate(next)).toBe(first); expect(calculator.stats().mode).toBe('reused');
  });
  it('多次改值、删值和公式含错误时仍与完整计算逐格一致', () => {
    const calculator = createIncrementalSpreadsheetCalculator(), next = workbook(); next.sheets[0].cells.E1 = { value: null, formula: '1/A1' }; calculator.calculate(next);
    for (let index = 0; index < 35; index++) { const current = structuredClone(next); current.sheets[0].cells.A1.value = index % 7 - 3; current.sheets[0].cells.A2.value = index * 2; expect(calculator.calculate(current)).toEqual(calculateSpreadsheet(current)); }
  });
  it('循环和循环解除都与完整计算一致，不复用过时错误', () => {
    const calculator = createIncrementalSpreadsheetCalculator(), current = workbook(); current.sheets[0].cells.A1 = { value: null, formula: 'B1+1' };
    expect(calculator.calculate(current)).toEqual(calculateSpreadsheet(current));
    const next = structuredClone(current); next.sheets[0].cells.A2.value = 8; expect(calculator.calculate(next)).toEqual(calculateSpreadsheet(next));
    next.sheets[0].cells.A1 = { value: 4 }; expect(calculator.calculate(next)).toEqual(calculateSpreadsheet(next)); expect(calculator.stats().mode).toBe('full');
  });
});
