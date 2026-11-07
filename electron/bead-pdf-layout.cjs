const { metadata, splitLines, escapeHtml: h, kindName } = require('./bead-export-helpers.cjs');
const CHART_COLUMNS = 30, CHART_ROWS = 40, LEGEND_ROWS = 40, INFO_LINES = 44;
const shortened = (value, length) => { const text = String(value).replace(/\s+/g, ' ').trim(), chars = Array.from(text); return chars.length > length ? chars.slice(0, length).join('') + '…' : text; };
function textColor(color) {
  const linear = channel => { const value = channel / 255; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; };
  const luminance = linear(color.rgb[0]) * 0.2126 + linear(color.rgb[1]) * 0.7152 + linear(color.rgb[2]) * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#FFFFFF';
}
function chartPage(context, left, top) {
  const { document, symbols } = context, pattern = document.pattern, settings = document.settings;
  const columns = Math.min(CHART_COLUMNS, pattern.columns - left), rows = Math.min(CHART_ROWS, pattern.rows - top);
  let grid = '<b class="axis"></b>';
  for (let x = 0; x < columns; x++) grid += `<b class="axis">${left + x + 1}</b>`;
  for (let y = 0; y < rows; y++) {
    grid += `<b class="axis">${top + y + 1}</b>`;
    for (let x = 0; x < columns; x++) {
      const index = pattern.cells[(top + y) * pattern.columns + left + x], color = index ? pattern.palette.colors[index - 1] : undefined;
      const classes = ['c', !color ? 'e' : '', color?.kind === 'transparent' ? 't' : '', (left + x) % settings.boardColumns === 0 ? 'bl' : '', (top + y) % settings.boardRows === 0 ? 'bt' : ''].filter(Boolean).join(' ');
      grid += color ? `<b class="${classes}" style="background-color:${color.hex};color:${textColor(color)}">${symbols ? index : h(color.code)}</b>` : `<b class="${classes}"></b>`;
    }
  }
  return { kind: 'chart', title: `列 ${left + 1}–${left + columns} · 行 ${top + 1}–${top + rows}`, body: `<div class="chart-grid" style="grid-template-columns:6mm repeat(${columns},6mm)">${grid}</div>` };
}
function legendPages(context) {
  const { document, usage, symbols } = context, indexByCode = new Map(document.pattern.palette.colors.map((color, index) => [color.code, index + 1])), pages = [];
  for (let start = 0; start < usage.length; start += LEGEND_ROWS) {
    const rows = usage.slice(start, start + LEGEND_ROWS).map(row => `<tr><td>${symbols ? indexByCode.get(row.code) : h(row.code)}</td><td><i class="swatch ${row.kind === 'transparent' ? 't' : ''}" style="background-color:${row.hex}"></i></td><td class="full-code">${h(row.code)}</td><td>${h(shortened(row.name, 15))}</td><td>${h(kindName(row.kind))}</td><td>${row.cells}</td></tr>`).join('');
    pages.push({ kind: 'legend', title: `${symbols ? '短号与完整色号图例' : '色号图例'} · ${start + 1}–${Math.min(start + LEGEND_ROWS, usage.length)}`, body: `<p class="note">名称较长时已简写，完整名称保留在材料表与 JSON；色号没有简写。透明珠仍计一颗。</p><table class="legend"><thead><tr><th>${symbols ? '短号' : '图内码'}</th><th>珠色</th><th>完整色号</th><th>名称</th><th>材质</th><th>格子数</th></tr></thead><tbody>${rows}</tbody></table>` });
  }
  return pages;
}
function infoPages(context) {
  const lines = metadata(context).flatMap(([field, label, value]) => [{ field: '', text: `【${label}】` }, ...splitLines(value).map(text => ({ field, text })), { field: '', text: '' }]);
  const pages = [];
  for (let start = 0; start < lines.length; start += INFO_LINES) pages.push({ kind: 'info', title: `完整来源与许可信息 · ${Math.floor(start / INFO_LINES) + 1}`, body: `<div class="info-lines">${lines.slice(start, start + INFO_LINES).map(line => `<div data-field="${line.field}">${h(line.text) || '&nbsp;'}</div>`).join('')}</div>` });
  return pages;
}
function createBeadPdf(context) {
  const { document, totals } = context, pattern = document.pattern, planned = [];
  for (let top = 0; top < pattern.rows; top += CHART_ROWS) for (let left = 0; left < pattern.columns; left += CHART_COLUMNS) planned.push(chartPage(context, left, top));
  planned.push(...legendPages(context), ...infoPages(context));
  if (planned.length > 100) throw Error('完整图纸和许可说明超过100页，请减少格数或精简来源说明后重试；许可内容没有裁切。');
  const title = shortened(document.title, 30), titleNote = title !== document.title ? '标题已简写，完整标题见信息页' : '完整标题与来源见信息页';
  const sheets = planned.map((page, index) => `<section class="sheet ${page.kind}-sheet"><header><h1>${h(title)}</h1><div>${h(titleNote)} · 工程修订 ${document.revision}</div><strong>${h(page.title)}</strong></header>${page.body}<footer><span>${pattern.columns}×${pattern.rows} · 珠子 ${totals.beads} · 空格 ${totals.emptyCells}</span><span>第 ${index + 1} / ${planned.length} 页</span></footer></section>`).join('');
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>拼豆图纸</title><style>@page{size:A4;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;color:#151515;font-family:Arial,"Microsoft YaHei",sans-serif}.sheet{width:210mm;min-height:297mm;padding:10mm 12mm 12mm;position:relative;break-after:page;page-break-after:always;break-inside:avoid}.sheet:last-child{break-after:auto;page-break-after:auto}header{height:20mm}h1{font-size:12pt;line-height:5mm;margin:0}header div{font-size:7.5pt;line-height:4mm}header strong{font-size:9pt;line-height:5mm}.chart-grid{display:grid;grid-auto-rows:6mm;width:max-content}.axis,.c{height:6mm;width:6mm;display:flex;align-items:center;justify-content:center;min-width:0;line-height:1;font-size:7pt;font-weight:400}.axis{color:#333;font-size:7pt}.c{border:.12mm solid #9a9a9a}.e{background:#fafafa}.bl{border-left:.45mm solid #111}.bt{border-top:.45mm solid #111}.t{background-image:repeating-linear-gradient(135deg,transparent 0,transparent 1mm,#b4b4b4 1mm,#b4b4b4 1.15mm)}footer{position:absolute;left:12mm;right:12mm;bottom:5mm;height:4mm;display:flex;justify-content:space-between;font-size:7pt;color:#444}.note{font-size:8pt;line-height:4mm;margin:0 0 2mm}.legend{border-collapse:collapse;width:186mm;table-layout:fixed;font-size:8pt}.legend tr{height:5.7mm}.legend th,.legend td{border:.15mm solid #bbb;padding:.4mm .6mm;line-height:1.1}.legend th:nth-child(1){width:16mm}.legend th:nth-child(2){width:11mm}.legend th:nth-child(3){width:35mm}.legend th:nth-child(4){width:69mm}.legend th:nth-child(5){width:35mm}.legend th:nth-child(6){width:20mm}.full-code{white-space:nowrap;font-family:monospace}.swatch{display:block;width:7mm;height:3.5mm;border:.15mm solid #888}.info-lines{font-family:Consolas,"Microsoft YaHei",monospace;font-size:9pt;line-height:5mm}.info-lines>div{height:5mm;white-space:pre;min-width:0}</style></head><body>${sheets}</body></html>`;
  if (Buffer.byteLength(html, 'utf8') > 16 * 1024 * 1024) throw Error('PDF图纸内容过大，请减少格数后重试。');
  return { html, pages: planned.length };
}
module.exports = { createBeadPdf };
