import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { SpreadsheetDocument } from '../spreadsheet-types';

const root = process.cwd(), dependencies = createRequire(path.join(root, 'work/ui-build/package.json'));
function exporter() {
  const ts = dependencies('typescript'), engine = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/spreadsheet-engine.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('module', 'exports', 'require', compiled)(engine, engine.exports, dependencies);
  const module = { exports: {} as { buildSpreadsheetWorkbook: (document: SpreadsheetDocument, load: typeof dependencies) => Promise<{ buffer: Buffer }> } };
  new Function('module', 'exports', 'require', fs.readFileSync(path.join(root, 'electron/spreadsheet-export.cjs'), 'utf8'))(module, module.exports, (name: string) => name === './spreadsheet-engine.cjs' ? engine.exports : dependencies(name));
  return module.exports.buildSpreadsheetWorkbook;
}
describe('真实XLSX保留列宽、隐藏筛选行、全部原始数据与公式', () => {
  it('筛选不删除行，查看排序不伪称重排，列宽写入实际XML', async () => {
    const document: SpreadsheetDocument = { schemaVersion: 1, kind: 'excel', title: '交付明细', sheets: [{ id: 'one', name: '明细', rowCount: 4, columnCount: 2, columnWidths: { A: 320, B: 150 }, view: { header: true, filter: { column: 1, text: '保留' }, sort: { column: 2, direction: 'asc' } }, cells: { A1: { value: '项目' }, B1: { value: '金额' }, A2: { value: '保留记录' }, B2: { value: 20 }, A3: { value: '其他记录' }, B3: { value: 10 }, B4: { value: null, formula: 'SUM(B2:B3)' } } }] };
    const { buffer } = await exporter()(document, dependencies), Excel = dependencies('exceljs'), workbook = new Excel.Workbook(); await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet('明细'); expect(sheet.getColumn(1).width).toBeCloseTo(45, 1); expect(sheet.getRow(2).hidden).toBeFalsy(); expect(sheet.getRow(3).hidden).toBe(true);
    expect(sheet.getCell('A2').value).toBe('保留记录'); expect(sheet.getCell('B2').value).toBe(20); expect(sheet.getCell('A3').value).toBe('其他记录'); expect(sheet.getCell('B4').value.formula).toBe('SUM(B2:B3)'); expect(sheet.autoFilter).toBeTruthy();
  });
});
