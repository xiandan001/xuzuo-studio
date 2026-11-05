const { validateSpreadsheetDocument, calculateSpreadsheet } = require('./spreadsheet-engine.cjs');
const FORMATS = { general: 'General', integer: '0', number: '0.00', currency: '"¥"#,##0.00', percent: '0.00%' };

async function buildSpreadsheetWorkbook(input, loadModule = require) {
  const document = validateSpreadsheetDocument(input), calculation = calculateSpreadsheet(document);
  const ExcelJS = loadModule('exceljs'), workbook = new ExcelJS.Workbook();
  workbook.creator = '序作工作台'; workbook.title = document.title; workbook.calcProperties.fullCalcOnLoad = true;
  for (const source of document.sheets) {
    const sheet = workbook.addWorksheet(source.name);
    let lastPrintedRow = 0, lastPrintedColumn = 0;
    sheet.views = source.view?.header === false ? [{ state: 'normal' }] : [{ state: 'frozen', ySplit: 1 }];
    for (let column = 1; column <= source.columnCount; column++) {
      const label = sheet.getColumn(column).letter, pixels = source.columnWidths?.[label];
      sheet.getColumn(column).width = pixels ? Math.round((pixels - 5) / 7 * 100) / 100 : 18;
    }
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
      if (target.value !== null && target.value !== undefined && target.value !== '') {
        lastPrintedRow = Math.max(lastPrintedRow, target.row);
        lastPrintedColumn = Math.max(lastPrintedColumn, target.col);
      }
      target.font = { name: 'Microsoft YaHei', size: 11, bold: value.bold || false };
      target.alignment = { vertical: 'middle', horizontal: value.align || (typeof value.value === 'number' || value.formula ? 'right' : 'left'), wrapText: true };
      target.numFmt = FORMATS[value.format || 'general'];
    }
    if (lastPrintedRow && lastPrintedColumn) {
      const width = sheet.columns.slice(0, lastPrintedColumn).reduce((sum, column) => sum + (column.width || 18), 0);
      // Very wide tables need A3 to avoid shrinking the default 11-point text below readable business sizes.
      sheet.pageSetup = { ...sheet.pageSetup, paperSize: width > 160 ? 8 : 9, orientation: width > 85 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printArea: `A1:${sheet.getColumn(lastPrintedColumn).letter}${lastPrintedRow}`, ...(source.view?.header !== false ? { printTitlesRow: '1:1' } : {}) };
    }
    if (source.view?.filter?.text.trim()) {
      const column = sheet.getColumn(source.view.filter.column).letter, query = source.view.filter.text.trim().toLocaleLowerCase();
      if (source.view.header) sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: source.rowCount, column: source.columnCount } };
      for (let row = source.view.header ? 2 : 1; row <= source.rowCount; row++) {
        const address = `${column}${row}`, calculated = calculation.cells[source.id][address], value = calculated?.status === 'calculated' || calculated?.status === 'value' ? calculated.value : source.cells[address]?.value;
        sheet.getRow(row).hidden = !String(value ?? '').toLocaleLowerCase().includes(query);
      }
    }
  }
  return { buffer: Buffer.from(await workbook.xlsx.writeBuffer()), document, calculation };
}
module.exports = { buildSpreadsheetWorkbook };
