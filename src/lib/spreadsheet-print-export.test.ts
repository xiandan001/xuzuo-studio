import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { SpreadsheetDocument } from '../spreadsheet-types';

const dependencies = createRequire(path.join(process.cwd(), 'work/ui-build/package.json'));
function exporter() {
  const ts = dependencies('typescript'), engine = { exports: {} }, compiled = ts.transpileModule(fs.readFileSync('src/lib/spreadsheet-engine.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('module', 'exports', 'require', compiled)(engine, engine.exports, dependencies);
  const module = { exports: {} as { buildSpreadsheetWorkbook: (document: SpreadsheetDocument, load: typeof dependencies) => Promise<{ buffer: Buffer }> } };
  new Function('module', 'exports', 'require', fs.readFileSync('electron/spreadsheet-export.cjs', 'utf8'))(module, module.exports, (name: string) => name === './spreadsheet-engine.cjs' ? engine.exports : dependencies(name));
  return module.exports.buildSpreadsheetWorkbook;
}
async function exported(document: SpreadsheetDocument) {
  const { buffer } = await exporter()(document, dependencies), workbook = new (dependencies('exceljs').Workbook)();
  await workbook.xlsx.load(buffer); return workbook.worksheets[0];
}
describe('generated workbook print layout', () => {
  it('prints a populated wide table together without including unused editing rows and columns', async () => {
    const sheet = await exported({ schemaVersion: 1, kind: 'excel', title: '预算', sheets: [{ id: 'wide', name: '参数', rowCount: 50, columnCount: 12, columnWidths: { F: 635 }, cells: { A1: { value: '费用名称', bold: true }, E1: { value: '金额' }, F1: { value: '使用说明' }, A5: { value: '推广费' }, E5: { value: 400, format: 'currency' }, E6: { value: 200 }, E7: { value: 150 }, F9: { value: '销量为计划，非实际成交。' }, E8: { value: null, formula: 'SUM(E5:E7)' } } }] });
    expect(sheet.pageSetup).toMatchObject({ paperSize: 8, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printArea: 'A1:F9', printTitlesRow: '1:1' });
    expect(sheet.getCell('E8').value).toEqual({ formula: 'SUM(E5:E7)', result: 750 });
    expect(sheet.getColumn('F').width).toBe(90);
  });
  it('keeps narrow sheets in portrait and respects disabled repeating headers', async () => {
    const sheet = await exported({ schemaVersion: 1, kind: 'excel', title: '窄表', sheets: [{ id: 'narrow', name: '明细', rowCount: 50, columnCount: 12, view: { header: false }, cells: { A1: { value: '计划' }, B2: { value: 0 }, B3: { value: false }, L50: { value: null, bold: true } } }] });
    expect(sheet.pageSetup).toMatchObject({ paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printArea: 'A1:B3' });
    expect(sheet.pageSetup.printTitlesRow).toBeUndefined();
    expect(sheet.getCell('B2').value).toBe(0); expect(sheet.getCell('B3').value).toBe(false);
  });
  it('uses A4 landscape for moderately wide sheets', async () => {
    const sheet = await exported({ schemaVersion: 1, kind: 'excel', title: '普通宽表', sheets: [{ id: 'medium', name: '汇总', rowCount: 50, columnCount: 12, cells: { A1: { value: '项目' }, F7: { value: 1420 } } }] });
    expect(sheet.pageSetup).toMatchObject({ paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printArea: 'A1:F7' });
  });
});
