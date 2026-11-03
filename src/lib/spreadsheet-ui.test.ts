import { describe, expect, it } from 'vitest';
import type { SpreadsheetRecord } from '../spreadsheet-types';
import { calculateSpreadsheet } from './spreadsheet-engine';
import { spreadsheetDeliveryChecks } from './spreadsheet-delivery';
import { displaySpreadsheetCell, emptySpreadsheet, hasSpreadsheetEdits, legacySpreadsheetDocument, pasteSpreadsheetCells, readSpreadsheetRecovery, renameSpreadsheetSheet, resolveSpreadsheetRecovery, spreadsheetFromText, spreadsheetNameError, spreadsheetVisibleRange, updateSpreadsheetCell } from './spreadsheet-ui';

describe('可编辑工作簿的输入、迁移与恢复', () => {
  it('生成表头占第一行，公式行号与完整多表数据都保留', () => {
    const workbook = spreadsheetFromText(JSON.stringify({ title: '报价', sheets: [{ name: '明细', columns: ['项目', '金额'], rows: [['甲', 10], ['乙', 20], ['总计', { formula: 'SUM(B2:B3)', bold: true, format: 'currency' }]] }, { name: '备注', rows: [['保留来源']] }] }), '原名');
    expect(workbook.sheets).toHaveLength(2);
    expect(workbook.sheets[0].cells.A1.value).toBe('项目');
    expect(workbook.sheets[0].cells.B4).toMatchObject({ formula: 'SUM(B2:B3)', value: null, bold: true, format: 'currency' });
    expect(calculateSpreadsheet(workbook).cells[workbook.sheets[0].id].B4.value).toBe(30);
    expect(workbook.sheets[1].cells.A1.value).toBe('保留来源');
  });
  it('结构或大小不合法的AI内容明确报错，不截断或塞入空表', () => {
    expect(() => spreadsheetFromText('普通说明', '标题')).toThrow('JSON');
    expect(() => spreadsheetFromText('{"sheets":[{"rows":["错误行"]}]}', '标题')).toThrow('不是数组');
    expect(() => spreadsheetFromText(JSON.stringify({ sheets: [{ rows: Array.from({ length: 10001 }, () => []) }] }), '标题')).toThrow('未被截断');
    const original = emptySpreadsheet('源');
    expect(spreadsheetFromText(JSON.stringify(original), '其他标题')).toEqual(original);
  });
  it('旧版第一行、手工数据和字符串公式对象迁移，原始字段不会被删除', () => {
    const raw = JSON.stringify({ title: '旧报价', cells: [['名称', '金额'], ['00123', '12'], ['总计', '{"formula":"SUM(B2:B2)"}']], body: '这是旧显示字段' });
    const workbook = legacySpreadsheetDocument(raw, '默认')!;
    expect(workbook.title).toBe('旧报价');
    expect(workbook.sheets[0].cells.A1.value).toBe('名称');
    expect(workbook.sheets[0].cells.A2.value).toBe('00123');
    expect(workbook.sheets[0].cells.B2.value).toBe(12);
    expect(workbook.sheets[0].cells.B3.formula).toBe('SUM(B2:B2)');
    expect(calculateSpreadsheet(workbook).cells[workbook.sheets[0].id].B3.value).toBe(12);
    const fromBody = legacySpreadsheetDocument(JSON.stringify({ cells: [['']], body: '{"title":"正文源","sheets":[{"name":"表一","rows":[[7]]}]}' }), '默认')!;
    expect(fromBody.title).toBe('正文源'); expect(fromBody.sheets[0].cells.A1.value).toBe(7);
    expect(() => legacySpreadsheetDocument('{', '默认')).toThrow('原草稿已保留');
    expect(legacySpreadsheetDocument(null, '默认')).toBeUndefined();
  });
  it('当前项目源优先；同基线草稿恢复，冲突草稿单独保留', () => {
    const document = emptySpreadsheet('已保存');
    const saved: SpreadsheetRecord = { version: 1, projectId: 'p1', revision: 3, savedAt: '2026-10-30', document, sourceArtifactIds: ['source-1'], calculation: calculateSpreadsheet(document) };
    const recovery = { document: { ...document, title: '未保存修改' }, baseRevision: 3, sourceArtifactIds: ['source-2'] };
    expect(resolveSpreadsheetRecovery(saved, recovery)).toMatchObject({ document: recovery.document, dirty: true, sourceArtifactIds: ['source-2'] });
    const stale = { ...recovery, baseRevision: 2 };
    expect(resolveSpreadsheetRecovery(saved, stale)).toMatchObject({ document: saved.document, dirty: false, conflict: stale, sourceArtifactIds: ['source-1'] });
    expect(readSpreadsheetRecovery(JSON.stringify(recovery))).toEqual(recovery);
    const editingTitle = { ...recovery, document: { ...recovery.document, title: '' } };
    expect(readSpreadsheetRecovery(JSON.stringify(editingTitle))?.document).toEqual(editingTitle.document);
    expect(readSpreadsheetRecovery('{')).toBeUndefined();
  });
  it('多格粘贴保留格式并扩容；超界粘贴失败时原表仍完好', () => {
    const sheet = emptySpreadsheet('输入').sheets[0];
    const formatted = { ...sheet, cells: { B2: { value: 1, bold: true, format: 'currency' as const } } };
    const pasted = pasteSpreadsheetCells(formatted, 'B2', '10\t20\r\n30\t=SUM(B2:C2)\r\n');
    expect(pasted.cells.B2).toMatchObject({ value: 10, bold: true, format: 'currency' });
    expect(pasted.cells.C3).toMatchObject({ formula: 'SUM(B2:C2)', value: null });
    expect(formatted.cells.B2.value).toBe(1);
    expect(() => pasteSpreadsheetCells(sheet, 'CV10000', 'a\tb\nc\td')).toThrow('当前表格未改变');
    expect(updateSpreadsheetCell(formatted, 'B2', '=1+1').cells.B2.bold).toBe(true);
  });
  it('格式化只改变显示；缺少公式计算证据不能验收通过', () => {
    const workbook = emptySpreadsheet('交付');
    workbook.sheets[0].cells.A1 = { value: null, formula: '1/0', format: 'currency' };
    expect(displaySpreadsheetCell({ value: .25, format: 'percent' })).toBe('25%');
    expect(displaySpreadsheetCell({ value: null, formula: 'IF(TRUE,,)' }, { status: 'calculated', value: null })).toBe('');
    expect(displaySpreadsheetCell(workbook.sheets[0].cells.A1, { status: 'error', error: '#DIV/0!' })).toBe('#DIV/0!');
    expect(spreadsheetDeliveryChecks(workbook, undefined, { saved: true, exported: true }).find(check => check.id === 'formulas')?.status).toBe('unknown');
    expect(spreadsheetDeliveryChecks(workbook, calculateSpreadsheet(workbook), { saved: true, exported: true }).find(check => check.id === 'formulas')?.status).toBe('failed');
    workbook.sheets[0].cells.A1.formula = '';
    expect(spreadsheetDeliveryChecks(workbook, calculateSpreadsheet(workbook), { saved: true, exported: true }).find(check => check.id === 'formulas')?.status).toBe('failed');
  });
  it('视口范围有界，工作表名称遵循Excel约束', () => {
    expect(spreadsheetVisibleRange(100000, 480, 32, 10000)).toEqual({ start: 3123, end: 3142 });
    const workbook = emptySpreadsheet('工作表');
    expect(spreadsheetNameError('bad/name', workbook.sheets, workbook.sheets[0].id)).not.toBe('');
    expect(spreadsheetNameError("'名称", workbook.sheets, workbook.sheets[0].id)).not.toBe('');
    expect(spreadsheetNameError('工作表1', [...workbook.sheets, { ...workbook.sheets[0], id: 'different' }], workbook.sheets[0].id)).toBe('工作表名称不能重复。');
  });
  it('重命名同步更新跨表引用，保留公式字符串常量与原版本', () => {
    const workbook = spreadsheetFromText(JSON.stringify({ title: '引用', sheets: [{ name: 'Old', rows: [[8]] }, { name: '汇总', rows: [[{ formula: 'Old!A1+\'Old\'!A1' }, { formula: 'IF(TRUE,"Old!A1",Old!A1)' }]] }] }), '标题');
    const renamed = renameSpreadsheetSheet(workbook, workbook.sheets[0].id, "新版's");
    expect(renamed.sheets[1].cells.A1.formula).toBe("'新版''s'!A1+'新版''s'!A1");
    expect(renamed.sheets[1].cells.B1.formula).toBe('IF(TRUE,"Old!A1",\'新版\'\'s\'!A1)');
    expect(calculateSpreadsheet(renamed).cells[renamed.sheets[1].id].A1.value).toBe(16);
    expect(workbook.sheets[0].name).toBe('Old');
  });
  it('首次生成只可替换空白源；0、false、格式和结构改动都属于人工内容', () => {
    const blank = emptySpreadsheet('标题');
    expect(hasSpreadsheetEdits(blank, '标题')).toBe(false);
    for (const cell of [{ value: 0 }, { value: false }, { value: null, bold: false }, { value: null, format: 'currency' as const }, { value: null, formula: '' }]) expect(hasSpreadsheetEdits({ ...blank, sheets: [{ ...blank.sheets[0], cells: { A1: cell } }] }, '标题')).toBe(true);
    expect(hasSpreadsheetEdits({ ...blank, title: '人工标题' }, '标题')).toBe(true);
    expect(hasSpreadsheetEdits({ ...blank, sheets: [{ ...blank.sheets[0], name: '人工表名' }] }, '标题')).toBe(true);
    expect(hasSpreadsheetEdits({ ...blank, sheets: [{ ...blank.sheets[0], rowCount: 100 }] }, '标题')).toBe(true);
    expect(hasSpreadsheetEdits({ ...blank, sheets: [blank.sheets[0], { ...blank.sheets[0], id: 'second' }] }, '标题')).toBe(true);
  });
});
