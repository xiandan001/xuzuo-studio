const { randomUUID } = require('node:crypto');
function beadMarketAIRows(result, { core, projectId, spec, artifactId, platform }) {
  const rawText = String(result.text || '').trim(); if (!rawText || rawText.length > 120000) throw Error('报价识读内容为空或过长，原截图与调用记录保留。');
  let parsed; try { parsed = JSON.parse(rawText.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { return { projectId, source: 'image', artifactId, offers: [], issues: [], warnings: ['识读返回的不是结构化报价，可根据原截图手动填写；完整原文在任务中心保留。'], rawText: rawText.slice(0, 20000) }; }
  const rows = Array.isArray(parsed) ? parsed : parsed.rows;
  if (!Array.isArray(rows) || rows.length > 50) return { projectId, source: 'image', artifactId, offers: [], issues: [], warnings: ['没有读取到可核对的报价行，请手动补充；完整原文在任务中心保留。'], rawText: rawText.slice(0, 20000) };
  const currencyWarnings = [], allowed = ['platform', 'url', 'title', 'sellerId', 'sellerName', 'brand', 'series', 'diameterMm', 'code', 'beadKind', 'packCount', 'packWeightGrams', 'price', 'minPacks', 'shipping', 'priceKind', 'conditions'];
  const accepted = rows.filter(row => row && typeof row === 'object' && !Array.isArray(row)).map((row, index) => {
    const currency = String(row.currency || '').toUpperCase(), clearPrice = !['CNY', 'RMB', '人民币', '元'].includes(currency) || /USD|JPY|EUR|US\$|美元|日元|欧元|\$/i.test(String(row.priceText || '') + String(row.shippingText || ''));
    if (clearPrice) currencyWarnings.push(`第${index + 1}行未明确为人民币，价格与运费留空，请对照截图填写。`);
    const value = Object.fromEntries(allowed.filter(key => row[key] !== undefined).map(key => [key, row[key]]));
    return { ...value, ...(row.platform || !platform ? {} : { platform }), ...(clearPrice ? { price: '', shipping: '' } : {}) };
  });
  const normalized = core.normalizeBeadMarketRows(accepted, { projectId, spec, artifactId, now: result.capturedAt, idFactory: randomUUID });
  return { projectId, source: 'image', artifactId, offers: normalized.offers, issues: normalized.issues, warnings: [...normalized.warnings, ...currencyWarnings, ...(rawText.length > 20000 ? ['预览原文仅显示前2万字，完整识读记录与费用保留在任务中心。'] : []), 'AI只转录截图，不核实平台结算价；请检查色号、包装、优惠条件和运费。', ...(Array.isArray(parsed.missing) ? parsed.missing.filter(value => typeof value === 'string').slice(0, 30) : [])], rawText: rawText.slice(0, 20000) };
}
module.exports = { beadMarketAIRows };
