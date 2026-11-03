const { validateSpreadsheetDocument, calculateSpreadsheet } = require('./spreadsheet-engine.cjs');
const FORMATS = { general: 'General', number: '0.00', currency: '"¥"#,##0.00', percent: '0.00%' };

async function buildSpreadsheetWorkbook(input, loadModule = require) {
  const document = validateSpreadsheetDocument(input), calculation = calculateSpreadsheet(document);
  const ExcelJS = loadModule('exceljs'), workbook = new ExcelJS.Workbook();
  workbook.creator = '序作工作台'; workbook.title = document.title; workbook.calcProperties.fullCalcOnLoad = true;
  for (const source of document.sheets) {
    const sheet = workbook.addWorksheet(source.name);
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    for (let column = 1; column <= source.columnCount; column++) sheet.getColumn(column).width = 18;
    for (const [address, value] of Object.entries(source.cells)) {
      const target = sheet.getCell(address), result = calculation.cells[source.id][address];
      if (value.formula !== undefined) {
        if (!value.formula || result.error === '#ERROR!') {
          target.value = `=${value.formula}`;
          target.note = `原公式保留为文字，未作为可执行公式写入：${result.message || '公式格式无效'}。请修正后重新导出。`;
        } else {
          target.value = { formula: value.formula, ...(result.status === 'calculated' && result.value !== undefined && result.value !== null ? { result: result.value } : {}) };
          if (result.status !== 'calculated') target.note = `${result.message || '本地尚未计算完成'}。未写入结果缓存，请在 Excel/WPS 中重算核对。`;
        }
      } else target.value = value.value;
      target.font = { name: 'Microsoft YaHei', size: 11, bold: value.bold || false };
      target.alignment = { vertical: 'middle', horizontal: value.align || (typeof value.value === 'number' || value.formula ? 'right' : 'left'), wrapText: true };
      target.numFmt = FORMATS[value.format || 'general'];
    }
  }
  return { buffer: Buffer.from(await workbook.xlsx.writeBuffer()), document, calculation };
}
module.exports = { buildSpreadsheetWorkbook };
