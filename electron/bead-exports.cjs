const { snapshot, metadata, splitLines, kindName, csvRow, usageHeaders, usageValues, readme } = require('./bead-export-helpers.cjs');
const { createBeadPdf } = require('./bead-pdf-layout.cjs');
const LIMIT = 100 * 1024 * 1024;

function previewPng(context, loadModule) {
  const { PNG } = loadModule('pngjs'), { pattern, settings } = context.document;
  const cell = Math.min(24, Math.floor(4096 / Math.max(pattern.columns, pattern.rows))), width = pattern.columns * cell, height = pattern.rows * cell;
  const image = new PNG({ width, height }); image.data.fill(0);
  for (let row = 0; row < pattern.rows; row++) for (let column = 0; column < pattern.columns; column++) {
    const index = pattern.cells[row * pattern.columns + column]; if (!index) continue;
    const color = pattern.palette.colors[index - 1];
    for (let y = row * cell; y < (row + 1) * cell; y++) for (let x = column * cell; x < (column + 1) * cell; x++) {
      const at = (y * width + x) * 4, hatch = color.kind === 'transparent' && (x + y) % 7 < 2;
      image.data[at] = hatch ? 160 : color.rgb[0]; image.data[at + 1] = hatch ? 160 : color.rgb[1]; image.data[at + 2] = hatch ? 160 : color.rgb[2]; image.data[at + 3] = 255;
    }
  }
  function line(x, y, color, thickness, vertical) {
    for (let offset = 0; offset < thickness; offset++) for (let position = 0; position < (vertical ? height : width); position++) {
      const px = vertical ? Math.min(width - 1, x + offset) : position, py = vertical ? position : Math.min(height - 1, y + offset), at = (py * width + px) * 4;
      image.data[at] = color; image.data[at + 1] = color; image.data[at + 2] = color; image.data[at + 3] = vertical && x % (settings.boardColumns * cell) === 0 || !vertical && y % (settings.boardRows * cell) === 0 ? 230 : 150;
    }
  }
  for (let x = 0; x <= pattern.columns; x++) line(Math.min(width - 1, x * cell), 0, 70, x % settings.boardColumns === 0 ? 2 : 1, true);
  for (let y = 0; y <= pattern.rows; y++) line(0, Math.min(height - 1, y * cell), 70, y % settings.boardRows === 0 ? 2 : 1, false);
  return { buffer: PNG.sync.write(image, { deflateLevel: 6 }), mimeType: 'image/png', extension: 'png', suffix: '拼豆预览' };
}
function csv(context) {
  const rows = [usageHeaders, ...context.usage.map(row => usageValues(row, context.document)), new Array(usageHeaders.length).fill(''), ['说明', '内容', ...new Array(usageHeaders.length - 2).fill('')], ...metadata(context).map(([, key, value]) => [key, value, ...new Array(usageHeaders.length - 2).fill('')])];
  return { buffer: Buffer.from('\uFEFF' + rows.map(csvRow).join('\n') + '\n', 'utf8'), mimeType: 'text/csv;charset=utf-8', extension: 'csv', suffix: '用量与采购清单' };
}
async function xlsx(context, loadModule) {
  const ExcelJS = loadModule('exceljs'), workbook = new ExcelJS.Workbook(), document = context.document;
  workbook.creator = '序作工作台'; workbook.created = new Date(document.updatedAt); workbook.modified = new Date(document.updatedAt);
  const usage = workbook.addWorksheet('用量与采购', { views: [{ state: 'frozen', ySplit: 1 }] }); usage.addRow(usageHeaders);
  for (const row of context.usage) usage.addRow(usageValues(row, document));
  usage.columns.forEach((column, index) => { column.width = index === 1 ? 28 : index === 0 ? 16 : 15; });
  usage.getRow(1).font = { bold: true }; usage.autoFilter = { from: 'A1', to: 'L1' };
  context.usage.forEach((row, index) => { usage.getCell(index + 2, 4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + row.hex.slice(1) } }; });
  const palette = workbook.addWorksheet('色卡'); palette.addRow(['色号', '名称', 'HEX', 'R', 'G', 'B', '材质', '自动配色']);
  for (const color of document.pattern.palette.colors) palette.addRow([color.code, color.name, color.hex, ...color.rgb, kindName(color.kind), color.automatic ? '是' : '否']);
  palette.columns.forEach((column, index) => { column.width = index === 1 ? 30 : 16; }); palette.getRow(1).font = { bold: true };
  const info = workbook.addWorksheet('说明'); info.columns = [{ header: '字段', key: 'field', width: 22 }, { header: '完整信息（长内容续行）', key: 'value', width: 100 }];
  for (const [, label, value] of metadata(context)) splitLines(value).forEach((line, index) => { const row = info.addRow([index ? `${label}（续）` : label, line]); row.height = 19; row.alignment = { vertical: 'top', wrapText: true }; });
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return { buffer, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx', suffix: '用量与采购清单' };
}
const json = context => ({ buffer: Buffer.from(JSON.stringify(context.document, null, 2) + '\n', 'utf8'), mimeType: 'application/json;charset=utf-8', extension: 'json', suffix: '可编辑拼豆工程' });
async function createBeadExport({ document, format }, loadModule = require) {
  const context = snapshot(document);
  if (!['png', 'pdf', 'csv', 'xlsx', 'json', 'bundle'].includes(format)) throw Error('请选择 PNG、PDF、CSV、XLSX、JSON 或整套导出。');
  if (format !== 'json' && context.totals.beads === 0) throw Error('当前图纸为空，请先放置珠子后再导出成品；空工程仍可保存为JSON。');
  if (format === 'png') return previewPng(context, loadModule);
  if (format === 'csv') return csv(context);
  if (format === 'xlsx') return xlsx(context, loadModule);
  if (format === 'json') return json(context);
  const pdf = createBeadPdf(context);
  if (format === 'pdf') return { ...pdf, mimeType: 'application/pdf', extension: 'pdf', suffix: '拼豆图纸' };
  return { parts: [previewPng(context, loadModule), csv(context), await xlsx(context, loadModule), json(context)], pdf, readme: readme(context), license: context.document.pattern.palette.license };
}

function safeName(name) {
  if (typeof name !== 'string' || !name.length || name.length > 180 || name.trim() !== name || /[<>:"/\\|?*\u0000-\u001f\u007f]/.test(name) || name === '.' || name === '..' || /[. ]$/.test(name) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw Error('ZIP文件名无效，请使用不含路径的普通文件名。');
  return name;
}
async function createBeadBundle({ parts, readme: explanation, license }, loadModule = require) {
  if (!Array.isArray(parts) || !parts.length || parts.length > 16 || typeof explanation !== 'string' || typeof license !== 'string') throw Error('整套导出内容无效。');
  const names = new Set(['readme.txt', 'license.txt']); let bytes = Buffer.byteLength(explanation, 'utf8') + Buffer.byteLength(license, 'utf8');
  for (const part of parts) {
    const name = safeName(part?.name), key = name.toLowerCase();
    if (names.has(key)) throw Error('ZIP文件名重复，请重新导出。'); names.add(key);
    if (!(part.buffer instanceof Uint8Array) || !part.buffer.byteLength) throw Error('整套导出文件为空或二进制内容无效。');
    bytes += part.buffer.byteLength; if (bytes > LIMIT) throw Error('整套导出超过100MB，请减少格数或文件数量。');
  }
  const JSZip = loadModule('jszip'), zip = new JSZip();
  for (const part of parts) zip.file(part.name, part.buffer);
  zip.file('README.txt', explanation); zip.file('LICENSE.txt', license);
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE', streamFiles: true });
  if (buffer.length > LIMIT) throw Error('整套导出超过100MB，请减少格数后重试。');
  return buffer;
}
module.exports = { createBeadExport, createBeadBundle };
