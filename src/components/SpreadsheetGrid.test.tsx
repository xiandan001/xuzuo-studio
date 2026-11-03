import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { calculateSpreadsheet } from '../lib/spreadsheet-engine';
import { emptySpreadsheet } from '../lib/spreadsheet-ui';
import { SpreadsheetGrid } from './SpreadsheetGrid';

describe('真实表格编辑视图', () => {
  it('10000行100列只渲染可视区域，公式结果、地址与错误清楚呈现', () => {
    const workbook = emptySpreadsheet('大表');
    const sheet = { ...workbook.sheets[0], rowCount: 10000, columnCount: 100, cells: { A1: { value: '实际内容' }, B1: { value: null, formula: '2+3' }, C1: { value: null, formula: '1/0' } } };
    const calculation = calculateSpreadsheet({ ...workbook, sheets: [sheet] });
    const html = renderToStaticMarkup(<SpreadsheetGrid sheet={sheet} calculation={calculation} selectedAddress="B1" onSelect={() => undefined} onCellInput={() => undefined} onPasteBlock={() => undefined} />);
    expect(html).toContain('实际内容'); expect(html).toContain('>5</span>'); expect(html).toContain('#DIV/0!');
    expect(html).toContain('B1，公式 =2+3'); expect(html).toContain('aria-rowcount="10001"'); expect(html).toContain('aria-colcount="101"');
    expect((html.match(/role="gridcell"/g) || []).length).toBeLessThan(250);
    expect((html.match(/<input/g) || []).length).toBeLessThanOrEqual(1);
    expect(html).toContain('支持粘贴表格'); expect(html).not.toContain('演示');
  });
});
