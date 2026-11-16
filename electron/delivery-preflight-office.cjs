const path = require('node:path');
const { xmlTree, attr, all, child, words, number } = require('./delivery-preflight-xml.cjs');
const { inspectOfficePreviewInput } = require('./office-preview-guard.cjs');
const { calculateSpreadsheet, validateSpreadsheetDocument } = require('./spreadsheet-engine.cjs');

function context(file, binding) {
  const target = extra => ({ projectId: file.projectId, artifactId: file.id, sha256: file.sha256, ...(Number.isSafeInteger(binding?.sourceRevision) ? { sourceRevision: binding.sourceRevision } : {}), ...extra });
  const checks = [], findings = [];
  const check = (id, label, status, detail) => checks.push({ id: file.id + '-' + id, artifactId: file.id, label, status, method: file.mimeType.includes('spreadsheetml') ? 'spreadsheet' : 'ooxml', detail });
  const finding = (id, severity, label, detail, location = {}) => { if (findings.length < 200) findings.push({ id: file.id + '-' + id, severity, label, detail, method: file.mimeType.includes('spreadsheetml') ? 'spreadsheet' : 'ooxml', target: target(location) }); };
  return { checks, findings, target, check, finding };
}
async function loadOffice(file, loadModule) { await inspectOfficePreviewInput(file, loadModule); return loadModule('jszip').loadAsync(file.buffer, { checkCRC32: true }); }
const readXml = async (zip, name, loadModule) => { const entry = zip.file(name); if (!entry) throw Error('正式文件缺少 ' + name); return xmlTree(await entry.async('string'), loadModule); };
function region(box, size) {
  const x = Math.max(0, box.x / size.width), y = Math.max(0, box.y / size.height), right = Math.min(1, (box.x + box.width) / size.width), bottom = Math.min(1, (box.y + box.height) / size.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : undefined;
}
function shapeBox(shape) {
  const transform = all(shape, 'xfrm')[0], offset = child(transform, 'off'), extent = child(transform, 'ext');
  const values = { x: number(attr(offset, 'x')), y: number(attr(offset, 'y')), width: number(attr(extent, 'cx')), height: number(attr(extent, 'cy')) };
  if (Object.values(values).some(value => value === undefined) || values.width < 0 || values.height < 0) return;
  const angle = (number(attr(transform, 'rot')) || 0) / 60000 * Math.PI / 180;
  if (!angle) return values;
  const cx = values.x + values.width / 2, cy = values.y + values.height / 2;
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => ({ x: cx + x * values.width / 2 * Math.cos(angle) - y * values.height / 2 * Math.sin(angle), y: cy + x * values.width / 2 * Math.sin(angle) + y * values.height / 2 * Math.cos(angle) }));
  const xs = corners.map(point => point.x), ys = corners.map(point => point.y); return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}
async function inspectPresentation(file, binding, loadModule = require) {
  const result = context(file, binding), zip = await loadOffice(file, loadModule), presentation = await readXml(zip, 'ppt/presentation.xml', loadModule), sizeNode = all(presentation, 'sldSz')[0];
  const size = { width: number(attr(sizeNode, 'cx')), height: number(attr(sizeNode, 'cy')) };
  if (!(size.width > 0 && size.height > 0)) throw Error('PPT 画布尺寸无效。');
  const relations = all(await readXml(zip, 'ppt/_rels/presentation.xml.rels', loadModule), 'Relationship');
  const ids = all(presentation, 'sldId'); if (!ids.length || ids.length > 200) throw Error('PPT 预检支持1–200页，请分批检查。');
  let outside = 0, small = 0, cropped = 0, unlocated = 0, grouped = 0;
  for (const [index, id] of ids.entries()) {
    const relation = relations.find(item => attr(item, 'Id') === id.attrs['r:id']);
    if (!relation || attr(relation, 'TargetMode') === 'External') throw Error('PPT 页面关系不可安全读取。');
    const target = attr(relation, 'Target'), part = target?.startsWith('/') ? target.slice(1) : path.posix.normalize('ppt/' + target);
    if (!/^ppt\/slides\/[^/]+\.xml$/.test(part || '')) throw Error('PPT 页面关系越界。');
    const page = await readXml(zip, part, loadModule), map = binding?.document?.kind === 'ppt' && binding.document.slides?.length === ids.length ? binding.document.slides[index] : undefined;
    const location = { pageNumber: index + 1, ...(map?.id ? { pageId: map.id } : {}) };
    const shapes = []; const visit = (node, inGroup = false) => { if (['sp', 'pic', 'graphicFrame'].includes(node.name)) shapes.push({ node, inGroup }); for (const item of node.children || []) visit(item, inGroup || node.name === 'grpSp'); }; visit(page);
    for (const [shapeIndex, entry] of shapes.entries()) {
      const label = words(entry.node).slice(0, 90) || `对象${shapeIndex + 1}`, box = shapeBox(entry.node);
      if (entry.inGroup) grouped++;
      if (!box || entry.inGroup) unlocated++;
      else if (box.x < -12700 || box.y < -12700 || box.x + box.width > size.width + 12700 || box.y + box.height > size.height + 12700) {
        outside++; result.finding(`bounds-${index}-${shapeIndex}`, 'warning', `第 ${index + 1} 页有对象超出画布`, `“${label}”的导出对象边界超出画布；可能是有意出血，请核对。`, { ...location, ...(region(box, size) ? { region: region(box, size) } : {}) });
      }
      const fonts = [...all(entry.node, 'rPr'), ...all(entry.node, 'defRPr')].map(item => number(attr(item, 'sz'))).filter(value => value !== undefined && value > 0);
      if (fonts.some(value => value < 1000)) { small++; result.finding(`font-${index}-${shapeIndex}`, 'warning', `第 ${index + 1} 页含小于10磅的文字`, `“${label}”最小显式字号 ${(Math.min(...fonts) / 100).toFixed(1)} 磅；自动缩放后的实际字号另看真实分页。`, location); }
      if (all(entry.node, 'srcRect').some(item => Object.values(item.attrs).some(value => Number(value) > 0))) { cropped++; result.finding(`crop-${index}-${shapeIndex}`, 'warning', `第 ${index + 1} 页图片使用了裁切`, '已读取到导出文件的图片裁切参数，请确认主体和边缘没有被误裁；此项不等于画面错误。', { ...location, ...(box && region(box, size) ? { region: region(box, size) } : {}) }); }
    }
  }
  result.check('bounds', 'PPT 导出对象边界', outside ? 'issues' : unlocated ? 'unverified' : 'passed', `读取 ${ids.length} 页实际OOXML；${outside}处越界，${unlocated}个对象无独立可确认坐标。组合变换或母版位置不据此判定通过。`);
  result.check('font', 'PPT 显式小字号', small ? 'issues' : 'passed', `${small}处小于10磅；只检查导出文件显式字号，继承字号与缩放后字号需结合实际PDF。`);
  result.check('crop', '图片裁切参数', cropped ? 'issues' : 'passed', `${cropped}处包含裁切参数；无参数不代表主体或留白已人工核对。`);
  if (grouped) result.finding('groups', 'unverified', '组合对象需要实际预览', `${grouped}个对象带组合坐标，未用未转换坐标误判为通过。`, {});
  return { checks: result.checks, findings: result.findings, facts: { pages: ids.length, width: size.width, height: size.height } };
}
async function inspectWord(file, binding, loadModule = require) {
  const result = context(file, binding), zip = await loadOffice(file, loadModule), document = await readXml(zip, 'word/document.xml', loadModule);
  const paragraphs = all(document, 'p'), sections = all(document, 'sectPr'); let small = 0, wide = 0, widthKnown = false;
  const blocks = binding?.document?.kind === 'word' ? binding.document.blocks || [] : [];
  for (const [index, paragraph] of paragraphs.entries()) {
    const content = words(paragraph), found = blocks.filter(block => block.type !== 'image' && content && String(block.text || '').replace(/\s+/g, ' ').includes(content));
    const fonts = all(paragraph, 'sz').map(item => number(attr(item, 'val'))).filter(value => value > 0);
    if (fonts.some(value => value < 16)) { small++; result.finding('font-' + index, 'warning', 'Word 含小于8磅的文字', `“${content.slice(0, 100) || '空段落'}”最小显式字号 ${(Math.min(...fonts) / 2).toFixed(1)} 磅。`, found.length === 1 ? { blockId: found[0].id } : {}); }
  }
  if (sections.length === 1) {
    const page = child(sections[0], 'pgSz'), margins = child(sections[0], 'pgMar'), usable = (number(attr(page, 'w')) - (number(attr(margins, 'left')) || 0) - (number(attr(margins, 'right')) || 0)) * 635;
    widthKnown = usable > 0;
    if (widthKnown) for (const [index, extent] of all(document, 'extent').entries()) if (number(attr(extent, 'cx')) > usable + 12700) { wide++; result.finding('wide-' + index, 'warning', 'Word 图片可能超出正文宽度', '实际导出图片宽度超过此节可用正文宽度，请在真实分页中核对。'); }
  }
  result.check('font', 'Word 显式小字号', small ? 'issues' : 'passed', `${small}处小于8磅；不包含样式继承和字体替代后的效果。`);
  result.check('image-width', 'Word 图片与正文宽度', !widthKnown ? 'unverified' : wide ? 'issues' : 'passed', !widthKnown ? '多节或缺少有效节布局，不能用单页参数代替实际分页。' : `${wide}处图片宽度需要核对；分页和浮动位置另看PDF。`);
  return { checks: result.checks, findings: result.findings, facts: { declaredBreaks: all(document, 'br').filter(item => attr(item, 'type') === 'page').length } };
}
function scalar(value) { if (value === null || value === undefined) return null; if (['string', 'number', 'boolean'].includes(typeof value)) return value; if (value instanceof Date) return value.toISOString(); if (value.richText) return value.richText.map(item => item.text).join(''); if (value.text !== undefined) return String(value.text); return null; }
async function inspectSpreadsheet(file, binding, loadModule = require) {
  const result = context(file, binding); await loadOffice(file, loadModule);
  const Excel = loadModule('exceljs'), workbook = new Excel.Workbook(); await workbook.xlsx.load(file.buffer);
  if (!workbook.worksheets.length || workbook.worksheets.length > 20) throw Error('工作簿预检支持1–20张工作表。');
  const sheets = [], caches = []; let count = 0, formulas = 0, exportedErrors = 0;
  for (const [index, sheet] of workbook.worksheets.entries()) {
    if (sheet.rowCount > 10000 || sheet.columnCount > 100) throw Error('工作表超过预检的10000行或100列上限，请分表检查。');
    const bound = binding?.document?.kind === 'excel' ? binding.document.sheets?.find(item => item.name === sheet.name) : undefined;
    const id = bound?.id || 'preflight-sheet-' + index, cells = {};
    sheet.eachRow({ includeEmpty: false }, row => row.eachCell({ includeEmpty: false }, cell => {
      if (++count > 100000) throw Error('工作簿预检超过100000个非空单元格。');
      const raw = cell.value, location = { ...(bound?.id ? { sheetId: bound.id } : {}), sheetName: sheet.name, cellAddress: cell.address };
      if (raw && typeof raw === 'object' && 'error' in raw) { exportedErrors++; result.finding('export-error-' + id + '-' + cell.address, 'error', `${sheet.name}!${cell.address} 含错误值`, String(raw.error), location); }
      const formula = cell.formula;
      if (formula) { formulas++; cells[cell.address] = { value: null, formula }; caches.push({ id, address: cell.address, cached: raw?.result, location }); if (raw?.result?.error) { exportedErrors++; result.finding('cache-error-' + id + '-' + cell.address, 'error', `${sheet.name}!${cell.address} 的公式缓存含错误`, String(raw.result.error), location); } }
      else cells[cell.address] = { value: scalar(raw) };
    }));
    sheets.push({ id, name: sheet.name, rowCount: Math.max(1, sheet.rowCount), columnCount: Math.max(1, sheet.columnCount), cells });
  }
  let calculation;
  try { calculation = calculateSpreadsheet(validateSpreadsheetDocument({ schemaVersion: 1, kind: 'excel', title: file.name.slice(0, 120) || '工作簿', sheets })); }
  catch (error) { result.check('formulas', '导出公式重算', 'unverified', '有当前引擎不能可靠处理的公式结构：' + error.message); result.finding('formula-scope', 'unverified', '部分公式不能自动核定', '已保留原文件；请在Excel/WPS重算后核对结果。'); }
  let mismatches = 0, absent = 0;
  if (calculation) {
    for (const issue of calculation.issues) { const cached = caches.find(item => item.id === issue.sheetId && item.address === issue.address); result.finding('formula-' + issue.sheetId + '-' + issue.address, issue.status === 'error' ? 'error' : 'unverified', `${cached?.location.sheetName || issue.sheetId}!${issue.address} ${issue.status === 'error' ? '公式错误' : '公式尚未核定'}`, issue.message || issue.code, cached?.location || { cellAddress: issue.address }); }
    for (const item of caches) {
      const calculated = calculation.cells[item.id]?.[item.address];
      if (item.cached === undefined || item.cached === null) { absent++; result.finding('absent-' + item.id + '-' + item.address, 'unverified', `${item.location.sheetName}!${item.address} 缺少导出公式缓存`, '此单元格没有可供交付软件直接读取的缓存结果；请在Excel/WPS中重算并保存。', item.location); continue; }
      if (calculated?.status !== 'calculated' && calculated?.status !== 'value' || item.cached?.error) continue;
      const equal = typeof calculated.value === 'number' && typeof item.cached === 'number' ? Math.abs(calculated.value - item.cached) <= Math.max(1e-9, Math.abs(calculated.value) * 1e-9) : calculated.value === item.cached;
      if (!equal) { mismatches++; result.finding('mismatch-' + item.id + '-' + item.address, 'warning', `${item.location.sheetName}!${item.address} 缓存与本地重算不一致`, `导出缓存 ${String(item.cached).slice(0, 100)}，当前引擎重算 ${String(calculated.value).slice(0, 100)}；请核对公式适用条件。`, item.location); }
    }
    result.check('formulas', '导出公式重算', calculation.issues.some(item => item.status === 'error') ? 'issues' : calculation.issues.length ? 'unverified' : 'passed', `读取实际XLSX ${formulas}个公式，${calculation.calculatedCount}个已按当前支持函数重算；外部数据与不支持函数不会冒充计算正确。`);
  }
  result.check('export-errors', '导出单元格错误值', exportedErrors ? 'issues' : 'passed', `在实际工作簿中发现 ${exportedErrors}处错误值。`);
  result.check('formula-cache', '公式缓存与重算', mismatches || exportedErrors ? 'issues' : absent || !calculation || calculation.issues.length ? 'unverified' : 'passed', `${mismatches}处不一致，${absent}处没有导出缓存；未重算的公式仍待核对。`);
  return { checks: result.checks, findings: result.findings, facts: { sheets: sheets.length, cells: count, formulas } };
}
module.exports = { inspectPresentation, inspectWord, inspectSpreadsheet };
