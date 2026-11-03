const { writeEditorPresentation, writeEditorDocument } = require('./editor-office.cjs');
const { buildSpreadsheetWorkbook } = require('./spreadsheet-export.cjs');

async function renderOffice({ document, images, report }, loadModule = require) {
  let buffer;
  if (document.kind === 'excel') {
    const workbook = await buildSpreadsheetWorkbook(document, loadModule); buffer = workbook.buffer;
    report.worksheets = document.sheets.length;
    report.formulas = { count: workbook.calculation.formulaCount, cells: document.sheets.flatMap(sheet => Object.entries(sheet.cells).filter(([, cell]) => cell.formula !== undefined).map(([address]) => `${sheet.name}!${address}`)), recalculated: workbook.calculation.formulaCount > 0 && workbook.calculation.allFormulasValid, resultsVerified: false };
    report.calculation = { engineVersion: workbook.calculation.engineVersion, calculatedCount: workbook.calculation.calculatedCount, allFormulasValid: workbook.calculation.allFormulasValid, issues: workbook.calculation.issues, fullCalcOnLoad: true };
    if (workbook.calculation.issues.length) report.warnings.push('部分公式未通过本地支持子集的重算，未写入假结果；请查看逐格问题，并在 Excel/WPS 中重算核对。');
  } else buffer = await (document.kind === 'ppt' ? writeEditorPresentation : writeEditorDocument)(document, images.map(image => ({ ...image, buffer: Buffer.from(image.buffer) })), loadModule, report);
  return { buffer, report };
}
module.exports = { renderOffice };
