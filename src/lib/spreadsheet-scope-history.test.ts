import { describe, expect, it } from 'vitest';
import type { SpreadsheetDocument } from '../spreadsheet-types';
import { applySpreadsheetScope, emptySpreadsheetScopeHistory, inspectSpreadsheetScope, recordSpreadsheetScope, spreadsheetHistoryScope } from './spreadsheet-scope-history';
import { calculateSpreadsheet } from './spreadsheet-engine';

const document = (a = 10, b = '正文'): SpreadsheetDocument => ({ schemaVersion: 1, kind: 'excel', title: '订单表', sheets: [{ id: 'sheet', name: '订单', rowCount: 20, columnCount: 6, cells: { A1: { value: a, bold: true, format: 'currency' }, B1: { value: b }, C1: { value: null, formula: 'A1*2' } } }] });
describe('单元格与区域局部历史', () => {
  it('只撤销所选单元格，保留后来改过的区域外内容和依赖公式，并真实重算', () => {
    const original = document(), changed = document(20), latest = document(20, '其他单元格后改');
    let history = recordSpreadsheetScope(emptySpreadsheetScopeHistory(), original, changed);
    history = recordSpreadsheetScope(history, changed, latest);
    const result = applySpreadsheetScope(history, 'undo', latest, spreadsheetHistoryScope(latest.sheets[0], 'A1'));
    expect(result.available).toBe(true); expect(result.document!.sheets[0].cells.A1).toEqual(original.sheets[0].cells.A1);
    expect(result.document!.sheets[0].cells.B1.value).toBe('其他单元格后改'); expect(result.document!.sheets[0].cells.C1.formula).toBe('A1*2');
    expect(calculateSpreadsheet(result.document!).cells.sheet.C1.value).toBe(20);
    const redo = applySpreadsheetScope(result.history, 'redo', result.document!, spreadsheetHistoryScope(latest.sheets[0], 'A1'));
    expect(redo.document!.sheets[0].cells.A1.value).toBe(20); expect(redo.document!.sheets[0].cells.B1.value).toBe('其他单元格后改');
  });
  it('一次多格编辑只撤销区域内部分，区域外patch仍可单独撤销', () => {
    const original = document(), changed = document(20, '修改后');
    const history = recordSpreadsheetScope(emptySpreadsheetScopeHistory(), original, changed);
    const a = applySpreadsheetScope(history, 'undo', changed, spreadsheetHistoryScope(changed.sheets[0], 'A1'));
    expect(a.document!.sheets[0].cells.B1.value).toBe('修改后');
    const b = applySpreadsheetScope(a.history, 'undo', a.document!, spreadsheetHistoryScope(changed.sheets[0], 'B1'));
    expect(b.document!.sheets[0].cells.B1.value).toBe('正文');
    expect(b.document!.sheets[0].cells.A1.value).toBe(10);
  });
  it('恢复整个公式和格式，删除新增格时保持真正空白，不写假的空值覆盖', () => {
    const original = document(), changed = structuredClone(original);
    changed.sheets[0].cells.C1 = { value: null, formula: 'A1*3', align: 'right' }; changed.sheets[0].cells.D1 = { value: '新增' };
    const history = recordSpreadsheetScope(emptySpreadsheetScopeHistory(), original, changed);
    const result = applySpreadsheetScope(history, 'undo', changed, spreadsheetHistoryScope(changed.sheets[0], 'D1:C1'));
    expect(result.document!.sheets[0].cells.C1).toEqual(original.sheets[0].cells.C1);
    expect(Object.hasOwn(result.document!.sheets[0].cells, 'D1')).toBe(false);
  });
  it('区域任一格冲突时整次拒绝，当前数据和历史原对象均不修改', () => {
    const original = document(), changed = document(20, '修改后'), latest = document(30, '修改后');
    const history = recordSpreadsheetScope(emptySpreadsheetScopeHistory(), original, changed);
    const result = applySpreadsheetScope(history, 'undo', latest, spreadsheetHistoryScope(latest.sheets[0], 'A1:B1'));
    expect(result.available).toBe(false); expect(result.reason).toContain('不一致'); expect(result.history).toBe(history);
    expect(latest.sheets[0].cells.B1.value).toBe('修改后');
  });
  it('边界区域先校验，格式变化可撤销，新编辑清除局部重做', () => {
    const original = document(), changed = structuredClone(original); changed.sheets[0].cells.A1.bold = false;
    expect(() => spreadsheetHistoryScope(changed.sheets[0], 'A1:ZZ9000')).toThrow('超出');
    expect(() => spreadsheetHistoryScope(changed.sheets[0], 'A1:B1:C1')).toThrow();
    const scope = spreadsheetHistoryScope(changed.sheets[0], 'A1');
    const undone = applySpreadsheetScope(recordSpreadsheetScope(emptySpreadsheetScopeHistory(), original, changed), 'undo', changed, scope);
    const next = document(15), history = recordSpreadsheetScope(undone.history, undone.document!, next);
    expect(inspectSpreadsheetScope(history, 'redo', next, scope).available).toBe(false);
  });
  it('已知单格编辑仅检查该地址，生成的恢复记录与完整扫描一致', () => {
    const original = document(), changed = document(20);
    expect(recordSpreadsheetScope(emptySpreadsheetScopeHistory(), original, changed, [{ sheetId: 'sheet', address: 'A1' }])).toEqual(recordSpreadsheetScope(emptySpreadsheetScopeHistory(), original, changed));
  });
});
