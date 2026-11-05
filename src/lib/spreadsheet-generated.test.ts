import { describe, expect, it } from 'vitest';
import { calculateSpreadsheet } from './spreadsheet-engine';
import { spreadsheetFromText, spreadsheetMissingInputs } from './spreadsheet-generated';
import { displaySpreadsheetCell } from './spreadsheet-ui';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

describe('共享生成表格归一化', () => {
  it('落实生成的加粗区域、字符列宽和数字格式，保留公式、0与false', async () => {
    const document = spreadsheetFromText(JSON.stringify({ sheets: [{ name: '预算', columns: ['项目', '金额', '比例'], rows: [['甲', 0, { formula: '1/4' }], [false, 2.6, 7]], formatting: { boldRanges: ['A1:C1', 'A3:C3'], columnWidths: { A: 18, B: 20, C: 68 }, numberFormats: { 'B2:B3': '0.00', C2: '0.00%', C3: '0' } } }] }), '预算');
    const sheet = document.sheets[0], calculation = calculateSpreadsheet(document);
    expect(sheet.cells.A1.bold).toBe(true); expect(sheet.cells.C3.bold).toBe(true);
    expect(sheet.cells.B2.value).toBe(0); expect(sheet.cells.A3.value).toBe(false); expect(sheet.cells.C2.formula).toBe('1/4');
    expect(sheet.columnWidths).toEqual({ A: 131, B: 145, C: 481 });
    expect(displaySpreadsheetCell(sheet.cells.C2, calculation.cells[sheet.id].C2)).toBe('25.00%');
    expect(displaySpreadsheetCell({ value: 2.6, format: 'integer' })).toBe('3');
    const { buildSpreadsheetWorkbook } = require('../../electron/spreadsheet-export.cjs');
    const load = createRequire(new URL('../../work/ui-build/package.json', import.meta.url));
    const { buffer } = await buildSpreadsheetWorkbook(document, load);
    const ExcelJS = load('exceljs'), workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer);
    const actual = workbook.getWorksheet('预算');
    expect(actual.getCell('A1').font.bold).toBe(true); expect(actual.getCell('C2').result).toBe(0.25);
    expect(actual.getCell('B2').numFmt).toBe('0.00'); expect(actual.getCell('C2').numFmt).toBe('0.00%'); expect(actual.getCell('C3').numFmt).toBe('0');
    expect(actual.getColumn('C').width).toBe(68);
  });
  it('仅明确的columns生成默认表头，rows-only正文不擅自加粗', () => {
    expect(spreadsheetFromText('{"sheets":[{"columns":["字段"],"rows":[[1]]}]}', '表头').sheets[0].cells.A1.bold).toBe(true);
    expect(spreadsheetFromText('{"sheets":[{"rows":[["正文"]]}]}', '正文').sheets[0].cells.A1.bold).toBeUndefined();
  });
  it('未知样式、超界区域和过宽列明确拒绝而非静默丢失', () => {
    for (const formatting of [{ fontFamily: '未知字体' }, { numberFormats: { A1: 'dd/mm/yyyy' } }, { boldRanges: ['A1:A10001'] }, { columnWidths: { A: 200 } }]) expect(() => spreadsheetFromText(JSON.stringify({ sheets: [{ rows: [[0]], formatting }] }), '保留')).toThrow();
  });
  it('对象列和对象行按key完整映射，保留0、false、text与跨表公式', () => {
    const document = spreadsheetFromText(JSON.stringify({ title: '完整', sheets: [{ name: '数据', columns: [{ header: '数量', key: 'n' }, { header: '状态', key: 'ok' }, '说明'], rows: [{ n: 0, ok: false, 说明: { text: '第一行\n第二行' } }] }, { name: '汇总', rows: [[{ formula: '数据!A2+2' }]] }] }), '标题');
    expect(document.sheets[0].cells.A2.value).toBe(0); expect(document.sheets[0].cells.B2.value).toBe(false); expect(document.sheets[0].cells.C2.value).toBe('第一行\n第二行');
    expect(calculateSpreadsheet(document).cells[document.sheets[1].id].A1.value).toBe(2);
    expect(spreadsheetFromText(JSON.stringify(document), '其他')).toEqual(document);
  });
  it('前言单个JSON围栏、rows-only、CSV/TSV与Markdown均保留所有行', () => {
    const json = JSON.stringify({ sheets: [{ name: '正文', rows: [['完整末行']] }] });
    expect(spreadsheetFromText(`下面是表格：\n\n\`\`\`json\n${json}\n\`\`\`\n请核对资料。`, '标题').sheets[0].cells.A1.value).toBe('完整末行');
    for (const text of ['项目,数量,状态\n"甲,乙",0,false', '项目\t数量\t状态\n甲\t0\tfalse', '| 项目 | 数量 | 状态 |\n| --- | ---: | :--- |\n| 甲 | 0 | false |']) {
      const sheet = spreadsheetFromText(text, '标题').sheets[0]; expect(sheet.cells.B2.value).toBe(0); expect(sheet.cells.C2.value).toBe(false);
    }
    expect(spreadsheetFromText('内容,状态\n"第一行\n第二行",true', '标题').sheets[0].cells.A2.value).toBe('第一行\n第二行');
  });
  it('公式字符串始终是文字，只有明确公式对象执行', () => {
    for (const text of [JSON.stringify({ sheets: [{ rows: [['=SUM(A2:A3)', { formula: '1+2' }]] }] }), '文字,公式\n=SUM(A2:A3),普通文本']) {
      const document = spreadsheetFromText(text, '安全'); const sheet = document.sheets[0]; const address = text.startsWith('{') ? 'A1' : 'A2';
      expect(sheet.cells[address]).toEqual({ value: '=SUM(A2:A3)' });
    }
  });
  it('未知对象和未声明字段明确报位置，JSON损坏不能降级为CSV', () => {
    expect(() => spreadsheetFromText('{"sheets":[{"name":"数据","rows":[[{"unknown":"不能丢失"}]]}]}', '标题')).toThrow('数据”!A1');
    expect(() => spreadsheetFromText('{"sheets":[{"name":"数据","columns":["字段"],"rows":[{"字段":1,"遗漏":2}]}]}', '标题')).toThrow('遗漏');
    expect(() => spreadsheetFromText('{"sheets":[', '标题')).toThrow('JSON');
    expect(() => spreadsheetFromText('说明\n```json\n{}\n```\n```json\n{}\n```', '标题')).toThrow('多个代码块');
  });
  it('缺失资料完整保存到独立说明表，不污染原数据表或重复追加', () => {
    const document = spreadsheetFromText(JSON.stringify({ sheets: [{ name: '资料说明', rows: [[7]] }], meta: { missingInputs: ['缺少真实金额', '需要核实来源\n保留完整说明'] } }), '标题');
    expect(document.sheets).toHaveLength(2); expect(document.sheets[0].cells.A1.value).toBe(7); expect(document.sheets[1].name).toBe('资料说明2');
    expect(spreadsheetMissingInputs(document)).toEqual(['缺少真实金额', '需要核实来源\n保留完整说明']); expect(spreadsheetFromText(JSON.stringify(document), '其他')).toEqual(document);
  });
});
