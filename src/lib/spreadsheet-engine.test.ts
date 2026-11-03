import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { SpreadsheetCell, SpreadsheetDocument } from '../spreadsheet-types';
import { calculateSpreadsheet, cellFromInput, cellToInput, columnLabel, parseCellAddress, validateSpreadsheetDocument } from './spreadsheet-engine';
const require = createRequire(import.meta.url);
const backend = require('../../electron/spreadsheet-engine.cjs') as { calculateSpreadsheet: typeof calculateSpreadsheet };
const formula = (value: string): SpreadsheetCell => ({ value: null, formula: value });
const number = (value: number): SpreadsheetCell => ({ value });
function document(cells: Record<string, SpreadsheetCell>): SpreadsheetDocument { return { schemaVersion: 1, kind: 'excel', title: '隔离工作簿', sheets: [{ id: 'sheet-one', name: '明细', rowCount: 30, columnCount: 12, cells }] }; }
const result = (value: SpreadsheetDocument, address: string) => calculateSpreadsheet(value).cells['sheet-one'][address];

describe('同源安全电子表格公式计算', () => {
  it('四则、优先级、绝对地址、范围与常用聚合函数按实际输入计算', () => {
    const doc = document({ A1: number(10), B1: number(2), C1: formula('$A$1+B1*3'), D1: formula('SUM(A1:B1)'), E1: formula('AVERAGE(A1:B1)'), F1: formula('MIN(A1:B1)'), G1: formula('MAX(A1:B1)'), H1: formula('COUNT(A1:B1)'), I1: formula('-(A1-B1)/2'), J1: formula('A1*10%') });
    const computed = calculateSpreadsheet(doc); expect(computed.issues).toEqual([]);
    expect(Object.fromEntries(Object.entries(computed.cells['sheet-one']).map(([key, cell]) => [key, cell.value]))).toEqual({ A1: 10, B1: 2, C1: 16, D1: 12, E1: 6, F1: 2, G1: 10, H1: 2, I1: -4, J1: 1 });
    expect(computed.formulaCount).toBe(8); expect(computed.calculatedCount).toBe(8); expect(computed.allFormulasValid).toBe(true);
  });
  it('跨表、带空格/单引号的表名和前向引用可计算', () => {
    const doc = document({ A1: formula("SUM('销售 '' 明细'!$A$1:A2)+B1"), B1: formula('C1+1'), C1: number(4) });
    doc.sheets.push({ id: 'sheet-two', name: "销售 ' 明细", rowCount: 10, columnCount: 3, cells: { A1: number(10), A2: number(5) } });
    expect(result(doc, 'A1')).toEqual({ status: 'calculated', value: 20 });
  });
  it('IF只计算选中分支，比较与负数四舍五入正确', () => {
    const doc = document({ A1: formula('IF(2>1,7,1/0)'), B1: formula('IF(FALSE,1/0,"保留")'), C1: formula('ROUND(-1.25,1)'), D1: formula('ROUND(1.005,2)'), E1: formula('ROUND(1234,-2)'), F1: formula('IF("a"="A",TRUE,FALSE)') });
    const cells = calculateSpreadsheet(doc).cells['sheet-one'];
    expect(cells.A1.value).toBe(7); expect(cells.B1.value).toBe('保留'); expect(cells.C1.value).toBe(-1.3); expect(cells.D1.value).toBe(1.01); expect(cells.E1.value).toBe(1200); expect(cells.F1.value).toBe(true);
  });
  it('聚合区分引用中的文字/布尔与直接参数，不把文字当成数字缓存', () => {
    const doc = document({ A1: number(2), A2: { value: '4' }, A3: { value: true }, A4: { value: null }, B1: formula('SUM(A1:A4,TRUE,"3")'), C1: formula('COUNT(A1:A4,TRUE,"3","bad")'), D1: formula('SUM("bad")'), E1: formula('COUNT(D1)') });
    const cells = calculateSpreadsheet(doc).cells['sheet-one'];
    expect(cells.B1.value).toBe(6); expect(cells.C1.value).toBe(3); expect(cells.D1.error).toBe('#VALUE!'); expect(cells.E1.value).toBe(0);
  });
  it('循环、除0、空平均数、越界和语法错误逐单元格报告，不伪造0', () => {
    const doc = document({ A1: formula('B1+1'), B1: formula('A1+1'), C1: formula('1/0'), D1: formula('AVERAGE(A9:A10)'), E1: formula('A99'), F1: formula('SUM('), G1: formula('COUNT(G1)') });
    const computed = calculateSpreadsheet(doc), cells = computed.cells['sheet-one'];
    expect(cells.A1.error).toBe('#CYCLE!'); expect(cells.B1.error).toBe('#CYCLE!'); expect(cells.C1.error).toBe('#DIV/0!'); expect(cells.D1.error).toBe('#DIV/0!'); expect(cells.E1.error).toBe('#REF!'); expect(cells.F1.error).toBe('#ERROR!'); expect(cells.G1.error).toBe('#CYCLE!');
    expect(computed.allFormulasValid).toBe(false); expect(computed.issues).toHaveLength(7); expect(cells.C1.value).toBeUndefined();
  });
  it('不支持的函数/符号明确标为unsupported，外部操作拒绝但普通文字安全保留', () => {
    const doc = document({ A1: formula('XLOOKUP(1,A2:A3,B2:B3)'), C1: formula('2^3'), D1: { value: '=WEBSERVICE("https://example.com")' } });
    const computed = calculateSpreadsheet(doc); expect(computed.cells['sheet-one'].A1.status).toBe('unsupported'); expect(computed.cells['sheet-one'].C1.status).toBe('unsupported'); expect(computed.cells['sheet-one'].D1.value).toContain('=WEBSERVICE');
    expect(() => calculateSpreadsheet(document({ A1: formula('WEBSERVICE("https://example.com")') }))).toThrow('外部');
    expect(() => calculateSpreadsheet(document({ A1: formula("'[private.xlsx]Sheet1'!A1") }))).toThrow('外部');
    expect(() => calculateSpreadsheet(document({ A1: formula('HYPERLINK("target")') }))).toThrow('外部');
    expect(() => calculateSpreadsheet(document({ A1: formula("cmd|' /C calc'!A1") }))).toThrow('外部');
    expect(() => calculateSpreadsheet(document({ A1: formula('INDIRECT(CHAR(91)&"external")') }))).toThrow('外部');
    const nested = calculateSpreadsheet(document({ A1: formula('SQRT(4)'), B1: formula('COUNT(A1)'), C1: formula('COUNT(SQRT(4))') }));
    expect(nested.cells['sheet-one'].B1.status).toBe('unsupported'); expect(nested.cells['sheet-one'].C1.status).toBe('unsupported'); expect(nested.allFormulasValid).toBe(false);
  });
  it('忽略客户端公式缓存，只保留声明数据和格式', () => {
    const raw = document({ A1: number(2), B1: number(3), C1: { value: 99999, formula: '=SUM(A1:B1)', bold: true, format: 'currency' } });
    const normalized = validateSpreadsheetDocument(raw); expect(normalized.sheets[0].cells.C1).toEqual({ value: null, formula: 'SUM(A1:B1)', bold: true, format: 'currency' }); expect(result(normalized, 'C1').value).toBe(5);
  });
  it('保留文字单元格类型、前导0、等号和单引号，输入编辑可往返', () => {
    for (const value of ['=SUM(A1:A2)', 'TRUE', '12', '', '  ', "'quoted", '00123', '普通文字']) expect(cellFromInput(cellToInput({ value })).value).toBe(value);
    expect(cellFromInput('=1+2', { value: 0, bold: true, align: 'center', format: 'number' })).toEqual({ value: null, formula: '1+2', bold: true, align: 'center', format: 'number' });
    expect(cellFromInput('10%')).toEqual({ value: .1, format: 'percent' }); expect(cellFromInput('FALSE').value).toBe(false); expect(cellToInput(undefined)).toBe('');
  });
  it('地址使用1-based，规范大写；重名/重复地址/越界不得丢弃内容', () => {
    expect(columnLabel(27)).toBe('AA'); expect(parseCellAddress('$b$12')).toEqual({ row: 12, column: 2, address: 'B12' });
    expect(() => validateSpreadsheetDocument(document({ a1: number(1), A1: number(2) }))).toThrow('重复');
    expect(() => validateSpreadsheetDocument(document({ Z100: number(2) }))).toThrow('超出');
    const doc = document({}); doc.sheets.push({ ...doc.sheets[0], id: 'second', name: '明细' }); expect(() => validateSpreadsheetDocument(doc)).toThrow('重复');
    expect(() => validateSpreadsheetDocument(document({ A1: number(Number.MAX_SAFE_INTEGER + 1) }))).toThrow('可靠');
  });
  it('前端TS与生成的后端CJS对同一工作簿给出一致结果', () => {
    const doc = document({ A1: number(7), A2: number(3), B1: formula('IF(SUM(A1:A2)>9,ROUND(8/3,2),0)'), C1: formula('UNSUPPORTED(A1)'), D1: formula('1/0') });
    expect(backend.calculateSpreadsheet(doc)).toEqual(calculateSpreadsheet(doc));
  });
});
