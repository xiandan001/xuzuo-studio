const kindName = value => ({ solid: '普通实心', transparent: '透明珠', special: '特殊材质' })[value];
const platformName = value => ({ '1688': '1688', taobao: '淘宝/天猫', pdd: '拼多多' })[value];
const cash = value => value === undefined ? '未核实' : value / 100;
const csvCell = value => { let text = String(value ?? ''); if (/^\s*[=+\-@\t\r]/.test(text)) text = "'" + text; return /[,"\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text; };
const headers = ['色号', '品牌', '系列', '珠径mm', '珠种', '缺口粒数', '每包粒数', '采购包数', '实际购入粒数', '单价元', '材料小计元', '店铺', '平台', '商品链接', '采集时间', '核对状态', '购买条件'];
function exportRows(snapshot) {
  const offers = new Map(snapshot.state.offers.map(offer => [offer.id, offer])), selected = new Map((snapshot.cart?.lines || []).map(line => [line.code, line]));
  return (snapshot.demand?.rows || []).map(need => {
    const line = selected.get(need.code), offer = line && offers.get(line.offerId);
    return [need.code, offer?.brand || snapshot.state.spec.brand, offer?.series || snapshot.state.spec.series, offer?.diameterMm || snapshot.state.spec.diameterMm, kindName(offer?.beadKind || need.kind), need.shortage, offer?.packCount ?? '', line?.packs ?? '', line?.beads ?? '', line?.packs ? line.materialCents / line.packs / 100 : '未核实', cash(line?.materialCents), offer?.sellerName || '待选择', offer ? platformName(offer.platform) : '', offer?.url || '', offer?.evidence.capturedAt || '', offer ? offer.verification === 'reviewed' ? '已人工核对' : '已读取来源规格' : '无可采用报价', offer?.conditions.join('；') || ''];
  });
}
async function createBeadMarketExport({ snapshot, format, title }, loadModule = require) {
  if (!snapshot?.demand) throw Error('请先保存拼豆图纸，再导出材料采购比较。');
  if (!['csv', 'xlsx'].includes(format)) throw Error('请选择CSV或Excel采购清单。');
  const rows = exportRows(snapshot), cart = snapshot.cart;
  if (format === 'csv') {
    const table = [headers, ...rows, [], ['材料小计元', cash(cart?.materialCents)], ['店铺运费合计元', cash(cart?.shippingCents)], ['采购总价元', cash(cart?.totalCents)], ['说明', '运费按明确店铺合并一次；运费或规格未核实的项目不计为完整总价。'], [], ['平台', '店铺', '材料小计元', '合单运费元'], ...(cart?.stores || []).map(store => [platformName(store.platform), store.sellerName, cash(store.materialCents), cash(store.shippingCents)])];
    return { buffer: Buffer.from('\uFEFF' + table.map(row => row.map(csvCell).join(',')).join('\n') + '\n'), mimeType: 'text/csv', extension: 'csv' };
  }
  const Excel = loadModule('exceljs'), workbook = new Excel.Workbook(); workbook.creator = '序作工作台'; workbook.created = new Date();
  const selected = workbook.addWorksheet('采购明细', { views: [{ state: 'frozen', ySplit: 1 }] }); selected.addRow(headers); for (const row of rows) selected.addRow(row);
  for (let index = 0; index < rows.length; index++) { const url = rows[index][13]; if (url) selected.getCell(index + 2, 14).value = { text: String(url), hyperlink: String(url) }; for (const column of [10, 11]) if (typeof selected.getCell(index + 2, column).value === 'number') selected.getCell(index + 2, column).numFmt = '0.00'; }
  selected.autoFilter = { from: 'A1', to: 'Q1' }; selected.getRow(1).font = { bold: true }; selected.columns.forEach((column, index) => { column.width = index === 13 ? 65 : [11, 14, 16].includes(index) ? 26 : 16; });
  const storeSheet = workbook.addWorksheet('店铺运费'); storeSheet.addRow(['平台', '店铺', '材料小计元', '合单运费元', '采购总额是否完整']); for (const store of cart?.stores || []) storeSheet.addRow([platformName(store.platform), store.sellerName, cash(store.materialCents), cash(store.shippingCents), store.shippingCents === undefined ? '运费待核实' : '运费已明确']);
  storeSheet.addRow([]); storeSheet.addRow(['材料小计元', cash(cart?.materialCents)]); storeSheet.addRow(['店铺运费合计元', cash(cart?.shippingCents)]); storeSheet.addRow(['完整采购总价元', cash(cart?.totalCents)]); storeSheet.columns.forEach(column => { column.width = 24; }); storeSheet.getRow(1).font = { bold: true };
  const quotes = workbook.addWorksheet('报价与来源', { views: [{ state: 'frozen', ySplit: 1 }] }); quotes.addRow(['平台', '店铺', '商品', '品牌', '兼容色卡', '系列', '珠径mm', '色号', '珠种', '每包粒数', '每包克数', '单价元', '起订包数', '阶梯价', '店铺运费参考元', '满免门槛元', '价格类型', '条件', '条件已确认', '核对状态', '来源类型', '采集时间', '有效至', '商品链接', '当前不采用原因']);
  const prices = new Map(snapshot.prices.map(price => [price.offerId, price]));
  for (const offer of snapshot.state.offers) { const row = quotes.addRow([platformName(offer.platform), offer.sellerName, offer.title, offer.brand, offer.compatibleWith || '', offer.series, offer.diameterMm, offer.code, kindName(offer.beadKind), offer.packCount ?? '', offer.packWeightGrams || '', cash(offer.priceCents), offer.minPacks, offer.tiers.map(tier => `${tier.minPacks}包起:¥${(tier.priceCents / 100).toFixed(2)}`).join('；'), cash(offer.shippingCents), offer.freeShippingAboveCents === undefined ? '' : cash(offer.freeShippingAboveCents), offer.priceKind, offer.conditions.join('；'), offer.conditionsAccepted ? '是' : '否', offer.verification, offer.evidence.kind, offer.evidence.capturedAt, offer.evidence.expiresAt || '', offer.url, prices.get(offer.id)?.reasons.join('；') || '']); if (offer.url) row.getCell(24).value = { text: offer.url, hyperlink: offer.url }; }
  quotes.columns.forEach((column, index) => { column.width = index === 23 ? 65 : index === 24 || index === 2 ? 36 : 18; }); quotes.getRow(1).font = { bold: true };
  const notes = workbook.addWorksheet('说明'); for (const row of [['项目', title || '拼豆采购比较'], ['图纸版本', String(snapshot.demand.documentRevision)], ['图纸ID', snapshot.demand.documentId], ['生成时间', new Date().toISOString()], ['价格依据', '价格来自保存的报价证据，导出为当前快照，不会假称已经下单或扣款。'], ['合单规则', '同平台且明确同店铺ID的运费合并一次；来源矛盾/未知运费时保留未核实，不按0计算。'], ['匹配规则', '品牌、系列、珠径、色号、珠种及每包粒数匹配；按重量包装没有明确粒数时不能换算。'], ['条件价', '只有明确确认可用的优惠条件才参与计算，结算前仍需核对实际SKU及数量。'], ['来源与成本', '商品链接、证据时间及核对状态见报价页；本地采购计算/导出不调用模型、不产生API费用。'], ['推荐范围', '材料低价与少分店为当前已保存报价的建议，不代表全网最优。'], ...(cart?.warnings || []).map(message => ['当前提示', message])]) notes.addRow(row);
  notes.getColumn(1).width = 20; notes.getColumn(2).width = 100; notes.eachRow(row => { row.alignment = { vertical: 'top', wrapText: true }; });
  return { buffer: Buffer.from(await workbook.xlsx.writeBuffer()), mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx' };
}
module.exports = { createBeadMarketExport, exportRows, csvCell };
