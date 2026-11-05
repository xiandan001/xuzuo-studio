import { describe, expect, it } from 'vitest';
import type { SpreadsheetSheet } from '../spreadsheet-types';
import { clearSpreadsheetRange, fillSpreadsheetDown, parseSpreadsheetClipboard, shiftSpreadsheetFormula, sortSpreadsheetValues, spreadsheetColumnGeometry, spreadsheetDisplayRows, spreadsheetRange, spreadsheetRangeText } from './spreadsheet-operations';
import { validateSpreadsheetDocument } from './spreadsheet-engine';
import { displaySpreadsheetCell, pasteSpreadsheetCells } from './spreadsheet-ui';

const sheet = (): SpreadsheetSheet => ({ id: 'sheet', name: '明细', rowCount: 8, columnCount: 4, cells: { A1: { value: '名称' }, B1: { value: '金额' }, A2: { value: '甲' }, B2: { value: 20 }, A3: { value: '乙' }, B3: { value: 3 } } });
describe('表格列宽、区域与安全数据整理', () => {
  it('清除反向选区的值和公式但保留样式、范围外对象和原始文稿', () => {
    const source = sheet(); source.cells.A2 = { value: 0, bold: true, format: 'currency' }; source.cells.B2 = { value: null, formula: 'A2*2', align: 'right' }; source.cells.C2 = { value: false }; source.cells.C3 = { value: null, bold: true }; source.cells.D8 = { value: '范围外' };
    const next = clearSpreadsheetRange(source, 'C3:A2');
    expect(next.cells.A2).toEqual({ value: null, bold: true, format: 'currency' }); expect(next.cells.B2).toEqual({ value: null, align: 'right' }); expect(next.cells.C2).toEqual({ value: null }); expect(next.cells.C3).toBe(source.cells.C3);
    expect(next.cells.D8).toBe(source.cells.D8); expect(next.rowCount).toBe(source.rowCount); expect(next.columnCount).toBe(source.columnCount); expect(source.cells.A2.value).toBe(0); expect(source.cells.B2.formula).toBe('A2*2');
  });
  it('空区域不新建单元格，排序筛选中的多格清除拒绝，单格保持可编辑', () => {
    const source = sheet(); expect(clearSpreadsheetRange(source, 'C6:D8')).toBe(source); expect(() => clearSpreadsheetRange(source, 'A1:E2')).toThrow('超出');
    for (const view of [{ header: true, sort: { column: 2, direction: 'asc' as const } }, { header: true, filter: { column: 1, text: '甲' } }]) {
      const viewed = { ...source, view }; expect(() => clearSpreadsheetRange(viewed, 'A2:B3')).toThrow('清除查看排序和筛选'); expect(clearSpreadsheetRange(viewed, 'B2').cells.B2.value).toBeNull(); expect(source.cells.B2.value).toBe(20);
    }
  });
  it('后台重算期间原始输入立即显示，不被上一轮结果或旧公式错误遮盖', () => {
    expect(displaySpreadsheetCell({ value: 20 }, { status: 'value', value: 10 })).toBe('20');
    expect(displaySpreadsheetCell({ value: '已改为文字' }, { status: 'error', error: '#DIV/0!' })).toBe('已改为文字');
    expect(displaySpreadsheetCell(undefined, { status: 'calculated', value: 100 })).toBe('');
  });
  it('列宽及查看设置通过canonical校验，越界宽度/列号拒绝', () => {
    const document = { schemaVersion: 1, kind: 'excel', title: '工作簿', sheets: [{ ...sheet(), columnWidths: { A: 240.2 }, view: { header: true, sort: { column: 2, direction: 'asc' }, filter: { column: 1, text: '甲' } } }] };
    const checked = validateSpreadsheetDocument(document); expect(checked.sheets[0].columnWidths).toEqual({ A: 240 }); expect(checked.sheets[0].view?.filter?.text).toBe('甲');
    expect(() => validateSpreadsheetDocument({ ...document, sheets: [{ ...sheet(), columnWidths: { A: 900 } }] })).toThrow('列宽');
    expect(() => validateSpreadsheetDocument({ ...document, sheets: [{ ...sheet(), view: { header: true, sort: { column: 8, direction: 'asc' } } }] })).toThrow('筛选');
    expect(spreadsheetColumnGeometry(checked.sheets[0]).offsets).toEqual([0, 240, 376, 512, 648]);
  });
  it('拖选倒向区域归一化，复制多行/引号/数字文字可无损粘贴', () => {
    const source = { ...sheet(), cells: { A1: { value: '多\n行' }, B1: { value: '001' }, A2: { value: '引号"和\t分隔' }, B2: { value: null, formula: 'SUM(B3:B4)' } } };
    expect(spreadsheetRange(source, 'B2:A1').text).toBe('A1:B2');
    const raw = spreadsheetRangeText(source, 'A1:B2'), pasted = pasteSpreadsheetCells(sheet(), 'A4', raw);
    expect(pasted.cells.A4.value).toBe('多\n行'); expect(pasted.cells.B4.value).toBe('001'); expect(pasted.cells.A5.value).toBe('引号"和\t分隔'); expect(pasted.cells.B5.formula).toBe('SUM(B3:B4)');
    expect(() => parseSpreadsheetClipboard('"不完整')).toThrow('引号'); expect(() => spreadsheetRange(source, 'A1:E2')).toThrow('超出');
    expect(() => parseSpreadsheetClipboard('x'.repeat(4000001))).toThrow('400 万');
  });
  it('向下填充仅改所选区域，公式保留绝对引用/字符串/表名并调整相对引用', () => {
    expect(shiftSpreadsheetFormula('IF(A2="A2",$A2+B$2+\'成本 A2\'!C2,Sheet1!D2)', 2)).toBe('IF(A4="A2",$A4+B$2+\'成本 A2\'!C4,Sheet1!D4)');
    const source = sheet(); source.cells.C2 = { value: null, formula: 'B2*$D$1', bold: true }; source.cells.D8 = { value: '范围外' };
    const next = fillSpreadsheetDown(source, 'B2:C4'); expect(next.cells.B4.value).toBe(20); expect(next.cells.C4.formula).toBe('B4*$D$1'); expect(next.cells.C4.bold).toBe(true); expect(next.cells.D8).toEqual(source.cells.D8); expect(source.cells.C4).toBeUndefined();
    expect(() => shiftSpreadsheetFormula('A1', -1)).toThrow('超出');
  });
  it('查看排序/筛选不改地址与数据，表头固定且空值靠后', () => {
    const source = { ...sheet(), view: { header: true, sort: { column: 2, direction: 'asc' as const } } };
    expect(spreadsheetDisplayRows(source).slice(0, 3)).toEqual([1, 3, 2]); expect(source.cells.B2.value).toBe(20);
    expect(spreadsheetDisplayRows({ ...source, view: { ...source.view, filter: { column: 1, text: '甲' } } })).toEqual([1, 2]);
    expect(() => fillSpreadsheetDown(source, 'A2:B4')).toThrow('清除');
  });
  it('纯值重排保持整行关联与范围外内容，含公式时拒绝物理重排', () => {
    const source = sheet(), next = sortSpreadsheetValues(source, 'A2:B3', 2, 'asc');
    expect(next.cells.A2.value).toBe('乙'); expect(next.cells.B2.value).toBe(3); expect(next.cells.A1).toEqual(source.cells.A1); expect(source.cells.A2.value).toBe('甲');
    source.cells.D8 = { value: null, formula: 'B2+B3' }; expect(() => sortSpreadsheetValues(source, 'A2:B3', 2, 'asc')).toThrow('公式');
  });
});
