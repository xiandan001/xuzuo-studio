const { checkedBeadDocument } = require('./bead-document.cjs');
const core = require('./bead-pattern.runtime.cjs');
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const kindName = kind => ({ solid: '普通实心', transparent: '透明珠', special: '特殊材质' })[kind];
function snapshot(value) {
  const document = checkedBeadDocument(value), totals = core.beadTotals(document.pattern), usage = core.beadUsage(document.pattern, document.procurement);
  if (usage.reduce((sum, row) => sum + row.cells, 0) !== totals.beads) throw Error('图纸和用量统计不一致，未导出成品。');
  return { document, totals, usage, symbols: document.pattern.palette.colors.some(color => color.code.length > 3) };
}
function metadata(context) {
  const { document: document, totals } = context, palette = document.pattern.palette;
  return [
    ['title', '完整标题', document.title], ['revision', '工程修订', String(document.revision)], ['updated', '保存时间', document.updatedAt],
    ['grid', '网格', `${document.pattern.columns} 列 × ${document.pattern.rows} 行`], ['total', '统计', `总格数 ${totals.totalCells}；空格 ${totals.emptyCells}；实物珠子 ${totals.beads}；用色 ${totals.colorsUsed}`],
    ['palette', '色卡', palette.name], ['brand', '品牌', palette.brand], ['paletteId', '色卡 ID', palette.id], ['version', '完整色卡版本', palette.version],
    ['sourceUrl', '来源网址', palette.sourceUrl || '用户提供，无网址'], ['sourceNote', '来源说明', palette.sourceNote || '无补充说明'], ['licence', '完整许可', palette.license],
    ['printing', '打印说明', '按 100% 比例打印可读符号图纸，每格 6mm；这不是针对某种底板孔距的等比例垫纸。按全局行列和底板分界摆珠。'],
    ['quantity', '数量说明', '图纸没有色号或短号的空白格不计珠；JSON 格子索引 0 才表示空格。透明珠和特殊材质实际占格时仍按一颗统计。采购数为当前修订快照，变更格子、份数或库存后请重新导出。'],
  ];
}
function splitLines(value, width = 86) {
  const result = [];
  for (const line of String(value).replace(/\r\n?|\u2028|\u2029/g, '\n').replace(/\t/g, '    ').split('\n')) {
    let part = '', units = 0;
    for (const char of line) {
      const size = char.codePointAt(0) > 127 ? 2 : 1;
      if (units + size > width) { result.push(part); part = ''; units = 0; }
      part += char; units += size;
    }
    result.push(part);
  }
  return result;
}
const safeCsv = value => typeof value === 'string' && (/^[\s\uFEFF]*[=+\-@]/.test(value) || /^0\d+$/.test(value)) ? "'" + value : String(value ?? '');
const csvRow = values => values.map(value => '"' + safeCsv(value).replace(/"/g, '""') + '"').join(',');
const usageHeaders = ['色号', '颜色名称', '材质', 'HEX', '格子数', '制作份数', '需用量', '预留', '库存', '缺口', '每包粒数', '采购包数'];
const usageValues = (row, document) => [row.code, row.name, kindName(row.kind), row.hex, row.cells, document.procurement.copies, row.required, row.reserve, row.stock, row.shortage, row.packSize, row.bags];
function readme(context) {
  const { document, totals } = context, palette = document.pattern.palette;
  return `${document.title}\n工程修订：${document.revision}\n网格：${document.pattern.columns}×${document.pattern.rows}\n实物珠子：${totals.beads}；空格：${totals.emptyCells}；用色：${totals.colorsUsed}\n色卡：${palette.brand} / ${palette.name}\n版本：${palette.version}\n\n预览 PNG 显示珠色与底板分界；PDF 为带全局行列的可读符号图纸，请按 100% 比例打印（每格 6mm，不是特定底板孔距的垫纸）。长色号使用统一短号，完整对应关系见 PDF 图例。\n\n用量和采购表来自同一修订的格子数据；空格不计珠，手动透明珠仍计一颗。份数、预留损耗、库存和每包粒数均采用当前工程设置。变更后请在工作台重新导出，XLSX 当前数值不冒充已自动重算的公式。\n\nJSON 是可继续编辑的工程文件；本套件不包含原底图、Key、费用账本或对话提示词。色卡 RGB 为屏幕参考，备料请核对实物品牌、系列和色号；不要只按相似屏幕颜色混用其他品牌。来源与完整许可保存在 JSON、XLSX 说明页、PDF 信息页及 LICENSE.txt。\n`;
}
module.exports = { snapshot, metadata, splitLines, escapeHtml, kindName, csvRow, usageHeaders, usageValues, readme };
