import { describe, expect, it } from 'vitest';
import { calculateSpreadsheet } from './spreadsheet-engine';
import { spreadsheetFromText, spreadsheetMissingInputs } from './spreadsheet-generated';

describe('共享生成表格归一化', () => {
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
