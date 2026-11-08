import type { BeadDocument, BeadUsageRow } from '../bead-types';
import type { BeadMaterialSpec, BeadMarketCart, BeadMarketDemand, BeadMarketOffer, BeadMarketOfferPrice, BeadMarketSnapshot, BeadMarketState } from '../bead-market-types';
import { beadUsage } from './bead-procurement';
import { beadDocumentIssue } from './bead-validation';
import { beadMarketDiameter, beadMarketNormalized, checkedBeadMaterialSpec, checkedBeadMarketOffer, checkedBeadMarketState } from './bead-market-validation';

const nowValue = (now?: string | number) => typeof now === 'number' ? now : now ? Date.parse(now) : Date.now();
export function newBeadMarketState(projectId: string, document?: BeadDocument): BeadMarketState { return { version: 1, projectId, revision: 0, spec: { brand: document?.pattern.palette.brand || '', series: '', diameterMm: '', paletteId: document?.pattern.palette.id || '', paletteVersion: document?.pattern.palette.version || '', allowCompatible: false }, offers: [], selections: {} }; }
export function beadMarketSpecForDocument(spec: BeadMaterialSpec, document: BeadDocument): BeadMaterialSpec { const palette = document.pattern.palette; return { ...spec, brand: palette.brand, series: beadMarketNormalized(spec.brand) === beadMarketNormalized(palette.brand) ? spec.series : '', paletteId: palette.id, paletteVersion: palette.version }; }
export function beadMarketDemand(document: BeadDocument, input: BeadMaterialSpec): BeadMarketDemand {
  const issue = beadDocumentIssue(document); if (issue) throw Error(issue);
  const spec = checkedBeadMaterialSpec(beadMarketSpecForDocument(input, document)), rows = beadUsage(document.pattern, document.procurement).filter(row => row.shortage > 0);
  return { documentId: document.id, documentRevision: document.revision, spec, rows, fingerprint: JSON.stringify([document.id, document.revision, spec.brand, spec.series, spec.diameterMm, spec.paletteId, spec.paletteVersion, spec.allowCompatible, rows.map(row => [row.code, row.kind, row.shortage, row.packSize])]) };
}
function matchingIssues(offer: BeadMarketOffer, demand: BeadMarketDemand, row: BeadUsageRow | undefined, now: number): string[] {
  const issues: string[] = [], spec = demand.spec, brand = beadMarketNormalized(offer.brand), wanted = beadMarketNormalized(spec.brand);
  if (!row) issues.push('色号不在当前缺料清单');
  if (!wanted || brand !== wanted) { if (!(spec.allowCompatible && wanted && beadMarketNormalized(offer.compatibleWith || '') === wanted)) issues.push('品牌不一致或尚未核实，兼容料需明确允许'); }
  if (!beadMarketDiameter(spec.diameterMm)) issues.push('请先选择豆子珠径');
  if (!offer.diameterMm || beadMarketDiameter(offer.diameterMm) !== beadMarketDiameter(spec.diameterMm)) issues.push('豆子珠径不一致或未提供');
  if (spec.series && beadMarketNormalized(spec.series) !== beadMarketNormalized(offer.series)) issues.push('系列不一致或未提供');
  if (row && offer.beadKind !== row.kind) issues.push('普通、透明或特殊珠种不一致');
  if (!offer.url) issues.push('缺少可打开的商品详情链接');
  if (!offer.packCount) issues.push(offer.packWeightGrams ? '按重量销售，缺少明确粒数，不能推算包数' : '缺少每包粒数');
  if (offer.verification === 'candidate') issues.push('候选报价尚未核对具体SKU');
  if (offer.verification === 'reviewed' && !offer.reviewedAt) issues.push('缺少人工核对时间');
  if (['image', 'table'].includes(offer.evidence.kind) && !offer.evidence.artifactId) issues.push('缺少原始截图或报价表证据');
  if (offer.priceKind === 'range' || offer.priceKind === 'unknown') issues.push('尚无所选规格的确定单价');
  if ((offer.priceKind === 'conditional' || offer.conditions.length > 0) && !offer.conditionsAccepted) issues.push('优惠或购买条件尚未确认可用');
  if (offer.priceCents === undefined && !offer.tiers.length) issues.push('缺少确定商品价格');
  const captured = Date.parse(offer.evidence.capturedAt), expires = offer.evidence.expiresAt ? Date.parse(offer.evidence.expiresAt) : captured + 24 * 60 * 60 * 1000;
  if (captured > now + 5 * 60 * 1000 || expires <= now || captured + 24 * 60 * 60 * 1000 <= now) issues.push('报价已过期或采集时间异常，请重新核对');
  return issues;
}
export function beadMarketOfferPrice(input: BeadMarketOffer, demand: BeadMarketDemand, now?: string | number): BeadMarketOfferPrice {
  const offer = checkedBeadMarketOffer(input), row = demand.rows.find(row => row.code.toUpperCase() === offer.code.toUpperCase()), reasons = matchingIssues(offer, demand, row, nowValue(now));
  const result: BeadMarketOfferPrice = { offerId: offer.id, code: offer.code, eligible: false, reasons, warnings: [] };
  if (reasons.length || !row || !offer.packCount) return result;
  const packs = Math.max(Math.ceil(row.shortage / offer.packCount), offer.minPacks), tier = offer.tiers.filter(item => item.minPacks <= packs).at(-1), price = tier?.priceCents ?? offer.priceCents;
  if (price === undefined) { reasons.push('实际采购包数未达到任何已知价格档位'); return result; }
  const materialCents = packs * price, beads = packs * offer.packCount;
  if (![packs, materialCents, beads].every(Number.isSafeInteger) || materialCents > 1000000000000) { reasons.push('采购数量或金额超过安全计算范围'); return result; }
  const shippingCents = offer.freeShippingAboveCents !== undefined && materialCents >= offer.freeShippingAboveCents ? 0 : offer.shippingCents;
  Object.assign(result, { eligible: true, packs, beads, materialCents, perThousandCents: price * 1000 / offer.packCount, ...(shippingCents !== undefined ? { shippingCents, totalCents: materialCents + shippingCents } : {}) });
  if (shippingCents === undefined) result.warnings.push('运费未核实，只能比较材料小计');
  if (beadMarketNormalized(offer.brand) !== beadMarketNormalized(demand.spec.brand)) result.warnings.push('兼容色卡材料，并非所选品牌正品');
  if (offer.priceKind === 'conditional') result.warnings.push('按已确认购买条件使用优惠价');
  return result;
}
const storeKey = (offer: BeadMarketOffer) => `${offer.platform}:${offer.sellerId ? 'id:' + offer.sellerId : 'unconfirmed:' + offer.id}`;
function quoteIssues(offers: BeadMarketOffer[]): Map<string, string> {
  const groups = new Map<string, BeadMarketOffer[]>(), issues = new Map<string, string>();
  for (const offer of offers) {
    let identity = offer.id;
    if (offer.url) { const url = new URL(offer.url); identity = JSON.stringify([offer.platform, url.hostname, url.pathname, url.searchParams.get('id') || url.searchParams.get('goods_id'), url.searchParams.get('skuId') || url.searchParams.get('sku_id'), offer.sellerId, beadMarketNormalized(offer.brand), beadMarketNormalized(offer.compatibleWith || ''), beadMarketNormalized(offer.series), offer.diameterMm, offer.code, offer.beadKind, offer.packCount, offer.packWeightGrams, offer.priceKind, [...offer.conditions].sort()]); }
    groups.set(identity, [...(groups.get(identity) || []), offer]);
  }
  for (const group of groups.values()) {
    const latest = Math.max(...group.map(offer => Date.parse(offer.evidence.capturedAt))), current = group.filter(offer => Date.parse(offer.evidence.capturedAt) === latest), amounts = new Set(current.map(offer => JSON.stringify([offer.priceCents, offer.minPacks, offer.tiers, offer.shippingCents, offer.freeShippingAboveCents])));
    for (const offer of group) if (Date.parse(offer.evidence.capturedAt) < latest) issues.set(offer.id, '同一商品规格已有更新报价，请采用或核对新记录');
    if (amounts.size > 1) for (const offer of current) issues.set(offer.id, '同一商品规格在相同时间有冲突价格，请核实后移除错误报价');
  }
  return issues;
}
function buildCart(demand: BeadMarketDemand, offers: BeadMarketOffer[], selections: Record<string, string>, now?: string | number, cached?: Map<string, BeadMarketOfferPrice>): BeadMarketCart {
  const byId = new Map(offers.map(offer => [offer.id, offer])), rows = new Map(demand.rows.map(row => [row.code, row]));
  const lines: BeadMarketOfferPrice[] = [], missingCodes: string[] = [];
  for (const code of rows.keys()) { const selected = byId.get(selections[code]), price = selected && (cached?.get(selected.id) || beadMarketOfferPrice(selected, demand, now)); if (price?.eligible && selected?.code === code) lines.push(price); else missingCodes.push(code); }
  const groups = new Map<string, BeadMarketOffer[]>(); for (const line of lines) { const offer = byId.get(line.offerId)!; const key = storeKey(offer); groups.set(key, [...(groups.get(key) || []), offer]); }
  const warnings: string[] = [], stores: BeadMarketCart['stores'] = [];
  for (const [key, group] of groups) {
    const offerIds = group.map(offer => offer.id), materialCents = lines.filter(line => offerIds.includes(line.offerId)).reduce((sum, line) => sum + line.materialCents!, 0), fees = new Set(group.map(offer => offer.shippingCents)), thresholds = new Set(group.map(offer => offer.freeShippingAboveCents));
    let shippingCents: number | undefined;
    if (group.length > 1 && !group[0].sellerId) warnings.push('店铺身份不明确，未自动跨商品合并运费');
    if (thresholds.size === 1 && group[0].freeShippingAboveCents !== undefined && materialCents >= group[0].freeShippingAboveCents) shippingCents = 0;
    else if (fees.size === 1 && group[0].shippingCents !== undefined) shippingCents = group[0].shippingCents;
    else warnings.push(`${group[0].sellerName || group[0].platform}运费缺失或不同报价不一致，需核实合单运费`);
    stores.push({ key, platform: group[0].platform, sellerName: group[0].sellerName || '店铺待核实', materialCents, ...(shippingCents !== undefined ? { shippingCents } : {}), offerIds });
  }
  const materialCents = lines.reduce((sum, line) => sum + line.materialCents!, 0), shippingKnown = stores.every(store => store.shippingCents !== undefined), shippingCents = shippingKnown ? stores.reduce((sum, store) => sum + store.shippingCents!, 0) : undefined;
  if (!Number.isSafeInteger(materialCents) || materialCents > 1000000000000) throw Error('整单金额超出安全计算范围。');
  if (missingCodes.length) warnings.push(`${missingCodes.length}个色号尚无可采用报价`);
  const complete = !missingCodes.length && shippingKnown;
  return { lines, materialCents, ...(shippingCents !== undefined ? { shippingCents } : {}), ...(complete ? { totalCents: materialCents + shippingCents! } : {}), complete, missingCodes, warnings: [...new Set([...warnings, ...lines.flatMap(line => line.warnings)])], stores };
}
function pricedOffers(offers: BeadMarketOffer[], demand: BeadMarketDemand, now?: string | number) {
  const superseded = quoteIssues(offers);
  return offers.map(offer => { const price = beadMarketOfferPrice(offer, demand, now), reason = superseded.get(offer.id); return { offer, price: reason ? { ...price, eligible: false, reasons: [reason, ...price.reasons] } : price }; });
}
function plannedCart(demand: BeadMarketDemand, offers: BeadMarketOffer[], priced: ReturnType<typeof pricedOffers>, selections: Record<string, string>, strategy: 'material' | 'few-stores', now?: string | number): BeadMarketCart {
  const eligible = priced.filter(item => item.price.eligible), automatic: Record<string, string> = {};
  const cached = new Map(priced.map(item => [item.offer.id, item.price]));
  const ranked = [...eligible].sort((a, b) => a.price.materialCents! - b.price.materialCents! || (a.price.shippingCents ?? Infinity) - (b.price.shippingCents ?? Infinity) || a.offer.id.localeCompare(b.offer.id));
  for (const row of demand.rows) { const best = ranked.find(item => item.offer.code === row.code); if (best) automatic[row.code] = best.offer.id; }
  if (strategy === 'material') return buildCart(demand, offers, { ...automatic, ...selections }, now, cached);
  const candidates: Record<string, string>[] = [automatic];
  const coverage = new Map<string, Set<string>>(); for (const item of eligible) { const key = storeKey(item.offer); if (!coverage.has(key)) coverage.set(key, new Set()); coverage.get(key)!.add(item.offer.code); }
  const relevantStores = [...coverage].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0])).slice(0, 24).map(([key]) => key);
  for (const key of relevantStores) {
    const next = { ...automatic }; for (const row of demand.rows) { const preferred = ranked.find(item => item.offer.code === row.code && storeKey(item.offer) === key); if (preferred) next[row.code] = preferred.offer.id; } candidates.push(next);
  }
  const scored = candidates.map(candidate => buildCart(demand, offers, { ...candidate, ...selections }, now, cached));
  scored.sort((a, b) => a.missingCodes.length - b.missingCodes.length || a.stores.length - b.stores.length || Number(b.complete) - Number(a.complete) || (a.totalCents ?? a.materialCents) - (b.totalCents ?? b.materialCents));
  return scored[0];
}
export function beadMarketCart(demand: BeadMarketDemand, offers: BeadMarketOffer[], selections: Record<string, string> = {}, strategy: 'material' | 'few-stores' = 'material', now?: string | number): BeadMarketCart { return plannedCart(demand, offers, pricedOffers(offers, demand, now), selections, strategy, now); }
export function beadMarketComparison(input: BeadMarketState, document?: BeadDocument, now?: string | number): BeadMarketSnapshot {
  const state = checkedBeadMarketState(input); if (!document) return { state, prices: [] };
  const demand = beadMarketDemand(document, state.spec), priced = pricedOffers(state.offers, demand, now), prices = priced.map(item => item.price), material = plannedCart(demand, state.offers, priced, {}, 'material', now);
  return { state, demand, prices, cart: Object.keys(state.selections).length ? plannedCart(demand, state.offers, priced, state.selections, 'material', now) : material, suggestions: { material, fewStores: plannedCart(demand, state.offers, priced, {}, 'few-stores', now) } };
}
