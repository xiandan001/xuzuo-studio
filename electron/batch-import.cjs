const MAX_ROWS = 500, MAX_COLUMNS = 50, MAX_BYTES = 8 * 1024 * 1024;
function tableRows(table) {
  if (!Array.isArray(table) || !table.length || table.length > MAX_ROWS + 1) throw new Error(`批量表格需要表头和1到${MAX_ROWS}行数据。`);
  const columns = table[0].map(value => String(value ?? '').trim());
  if (!columns.length || columns.length > MAX_COLUMNS || columns.some(value => !value || value.length > 100) || new Set(columns).size !== columns.length) throw new Error('批量表头不能为空、重复或超过50列，每列表头最多100字。');
  const rows = table.slice(1).filter(row => row.some(value => String(value ?? '').trim())).map((row, index) => {
    if (row.length > columns.length) throw new Error(`第${index + 2}行的数据列多于表头，未丢弃多余内容。`);
    const result = {};
    for (const [column, name] of columns.entries()) { const value = String(row[column] ?? ''); if (value.length > 10000) throw new Error(`第${index + 2}行“${name}”超过10000字。`); Object.defineProperty(result, name, { value, enumerable: true, configurable: true, writable: true }); }
    return result;
  });
  if (!rows.length) throw new Error('表格没有可生产的数据行。');
  return { columns, rows, warnings: [] };
}
function csvRows(text) {
  const rows = []; let row = [], cell = '', quoted = false, closed = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) { if (char === '"' && text[index + 1] === '"') { cell += '"'; index++; } else if (char === '"') { quoted = false; closed = true; } else cell += char; continue; }
    if (char === '"') { if (cell || closed) throw new Error('CSV引号位置无效，请另存为标准UTF-8 CSV。'); quoted = true; continue; }
    if (char === ',' || char === '\n') { row.push(cell); cell = ''; closed = false; if (char === '\n') { rows.push(row); row = []; if (rows.length > MAX_ROWS + 1) throw new Error(`批量最多${MAX_ROWS}行，请拆分文件。`); } continue; }
    if (closed && char.trim()) throw new Error('CSV引号结束后出现额外内容，请检查文件。');
    if (!closed) cell += char;
  }
  if (quoted) throw new Error('CSV存在未结束的引号，未提交任何任务。');
  if (cell || row.length || closed) { row.push(cell); rows.push(row); }
  return tableRows(rows);
}
async function checkZip(buffer, loadModule) {
  const zip = await loadModule('jszip').loadAsync(buffer), files = Object.values(zip.files).filter(item => !item.dir);
  if (files.length > 2000) throw new Error('XLSX内部文件过多，请精简后导入。');
  let total = 0;
  for (const entry of files) {
    await new Promise((resolve, reject) => { let size = 0; const stream = entry.internalStream('nodebuffer'); stream.on('data', chunk => { size += chunk.length; total += chunk.length; if (size > 8 * 1024 * 1024 || total > 64 * 1024 * 1024) { stream.pause(); reject(new Error('XLSX展开内容过大，请拆分后导入。')); } }); stream.on('error', reject); stream.on('end', resolve); stream.resume(); });
  }
}
function valueText(value, address) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && Array.isArray(value.richText)) return value.richText.map(item => item.text || '').join('');
  if (typeof value === 'object' && 'formula' in value) { if (value.result === undefined || value.result === null || typeof value.result === 'object') throw new Error(`${address}的公式没有可用缓存结果，请先用Excel/WPS重算并另存或替换为值。`); return valueText(value.result, address); }
  if (typeof value === 'object' && typeof value.text === 'string') return value.text;
  throw new Error(`${address}含不支持的单元格对象，请转换为文字或数值。`);
}
async function parseBatchImport({ name, buffer }, loadModule = require) {
  const bytes = Buffer.from(buffer || []); if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('导入文件为空或超过8MB，请拆分后导入。');
  if (/\.csv$/i.test(name || '')) { let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'); } catch { throw new Error('CSV需要UTF-8编码，请另存为CSV UTF-8后导入。'); } return csvRows(text); }
  if (!/\.xlsx$/i.test(name || '')) throw new Error('批量导入仅支持CSV UTF-8或XLSX，不支持宏工作簿。');
  await checkZip(bytes, loadModule); const ExcelJS = loadModule('exceljs'), workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bytes);
  const sheet = workbook.worksheets[0]; if (!sheet || sheet.rowCount > MAX_ROWS + 1 || sheet.columnCount > MAX_COLUMNS) throw new Error(`第一张工作表需在${MAX_ROWS}行数据、${MAX_COLUMNS}列以内。`);
  const table = [];
  for (let row = 1; row <= sheet.rowCount; row++) { const values = []; for (let column = 1; column <= sheet.columnCount; column++) { const cell = sheet.getCell(row, column); values.push(valueText(cell.value, `${sheet.name}!${cell.address}`)); } while (values.length && !values.at(-1)) values.pop(); table.push(values); }
  const result = tableRows(table); if (workbook.worksheets.length > 1) result.warnings.push(`只使用第一张工作表“${sheet.name}”，其余${workbook.worksheets.length - 1}张未导入。`); return result;
}
module.exports = { parseBatchImport, csvRows, tableRows, MAX_ROWS, MAX_BYTES };
