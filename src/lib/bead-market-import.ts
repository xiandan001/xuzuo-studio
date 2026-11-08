import type { BeadMaterialSpec, BeadMarketOffer, BeadMarketPlatform } from '../bead-market-types';
import { beadMarketDiameter, beadMarketPlatformUrl, checkedBeadMarketOffer } from './bead-market-validation';

export interface BeadMarketRowContext { projectId: string; spec: BeadMaterialSpec; now?: string; idFactory?: () => string; artifactId?: string; }
const aliases = {
  platform: ['平台', '来源平台', 'platform'], url: ['商品链接', '商品URL', '购买链接', '链接', 'url'], title: ['商品名称', '标题', '商品', 'title'], sellerId: ['店铺ID', '商家ID', 'sellerId'], sellerName: ['店铺', '店铺名称', '商家', 'sellerName'], brand: ['品牌', 'brand'], compatibleWith: ['兼容品牌', '兼容色卡', 'compatibleWith'], series: ['系列', 'series'], diameterMm: ['珠径', '豆子尺寸', '珠径mm', '尺寸', 'diameterMm'], code: ['色号', '颜色编号', 'code'], beadKind: ['珠种', '类型', '材质', 'beadKind'], packCount: ['每包粒数', '每袋粒数', '包装粒数', '粒数', 'packCount'], packWeightGrams: ['每包克数', '重量g', '克数', 'packWeightGrams'], price: ['价格', '单价', '每包价格', '袋价', '售价', '价格元', 'price'], priceCents: ['价格分', 'priceCents'], minPacks: ['起订包数', '起订量', 'minPacks'], shipping: ['运费', '运费元', 'shipping'], shippingCents: ['运费分', 'shippingCents'], freeShippingAbove: ['包邮门槛', '满免金额', 'freeShippingAbove'], freeShippingAboveCents: ['包邮门槛分', 'freeShippingAboveCents'], priceKind: ['价格类型', 'priceKind'], conditions: ['使用条件', '优惠条件', '条件', 'conditions'], capturedAt: ['报价时间', '采集时间', '查询时间', 'capturedAt'], expiresAt: ['有效期至', '失效时间', 'expiresAt'], tiers: ['阶梯价', 'tiers'],
} as const;
function pick(row: Record<string, unknown>, field: keyof typeof aliases): unknown { const found = aliases[field].filter(alias => row[alias] !== undefined && row[alias] !== null && row[alias] !== ''); if (found.length > 1 && new Set(found.map(alias => String(row[alias]).trim())).size > 1) throw Error(`同义字段“${found.join('/')}”内容不一致，请只保留准确的一列`); return found.length ? row[found[0]] : undefined; }
const plain = (value: unknown) => value === undefined || value === null ? '' : String(value).trim();
export function beadMarketMoneyCents(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return;
  const text = String(value).normalize('NFKC').trim().replace(/^(?:¥|￥|CNY|人民币)\s*/i, '').replace(/\s*元(?:\s*\/\s*(?:袋|包))?$/, '').replace(/\s*\/\s*(?:袋|包)$/, '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return;
  const [whole, fraction = ''] = text.split('.'), result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return result <= 1000000000n ? Number(result) : undefined;
}
function quantity(value: unknown, suffix = '(?:粒|颗|个|包|袋)'): number | undefined { const text = plain(value).normalize('NFKC').replace(new RegExp('\\s*' + suffix + '$'), ''); return /^\d+$/.test(text) && Number.isSafeInteger(Number(text)) && Number(text) <= 1000000000 ? Number(text) : undefined; }
function timestamp(value: unknown, fallback: string): string { if (!plain(value)) return fallback; let text = plain(value); if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/.test(text)) text = text.replace(' ', 'T') + '+08:00'; if (!/T/.test(text) || !Number.isFinite(Date.parse(text))) throw Error('报价时间需填写含日期和时区的有效时间'); return new Date(text).toISOString(); }
function platform(value: unknown): BeadMarketPlatform | undefined { const text = plain(value).toLowerCase(); return /^(?:1688|阿里巴巴)$/.test(text) ? '1688' : /^(?:taobao|淘宝|天猫|tmall)$/.test(text) ? 'taobao' : /^(?:pdd|拼多多|pinduoduo)$/.test(text) ? 'pdd' : undefined; }
export function normalizeBeadMarketRows(rows: Record<string, unknown>[], context: BeadMarketRowContext): { offers: BeadMarketOffer[]; issues: string[]; warnings: string[] } {
  if (!Array.isArray(rows) || rows.length > 500) throw Error('报价表一次最多500行。');
  const now = context.now || new Date().toISOString(), offers: BeadMarketOffer[] = [], issues: string[] = [], warnings: string[] = [], seen = new Set<string>();
  rows.forEach((row, index) => {
    try {
      if (!row || typeof row !== 'object' || Array.isArray(row) || Object.values(row).some(value => typeof value === 'string' && value.length > 20000)) throw Error('行内容无效或过长');
      const rawUrl = plain(pick(row, 'url')), link = rawUrl ? beadMarketPlatformUrl(rawUrl) : undefined, explicitPlatform = platform(pick(row, 'platform')), chosen = explicitPlatform || link?.platform;
      if (!chosen) throw Error('请填写平台或真实商品详情链接');
      if (explicitPlatform && link && explicitPlatform !== link.platform) throw Error('平台和商品链接不对应');
      if (rawUrl && !link) warnings.push(`第${index + 2}行链接不是可识别的官方商品详情，已留空，需先解析短链接或更正`);
      const priceRaw = pick(row, 'price'), centsRaw = pick(row, 'priceCents'), priceCents = centsRaw !== undefined ? quantity(centsRaw, '分') : beadMarketMoneyCents(priceRaw), shippingRaw = pick(row, 'shipping'), shippingCentRaw = pick(row, 'shippingCents'), shippingCents = shippingCentRaw !== undefined ? quantity(shippingCentRaw, '分') : /^(包邮|免运费|免费|free)$/i.test(plain(shippingRaw)) ? 0 : beadMarketMoneyCents(shippingRaw);
      if (priceRaw !== undefined && centsRaw !== undefined && beadMarketMoneyCents(priceRaw) !== priceCents || shippingRaw !== undefined && shippingCentRaw !== undefined && beadMarketMoneyCents(shippingRaw) !== shippingCents) throw Error('同一金额的元/分字段不一致，请核对单位');
      if ((priceRaw !== undefined || centsRaw !== undefined) && priceCents === undefined) warnings.push(`第${index + 2}行价格未识别为确定金额，已留空`);
      if ((shippingRaw !== undefined || shippingCentRaw !== undefined) && shippingCents === undefined) warnings.push(`第${index + 2}行运费无法识别，已留空，不按0处理`);
      const conditionsValue = pick(row, 'conditions'), conditions = (Array.isArray(conditionsValue) ? conditionsValue.map(plain) : plain(conditionsValue).split(/[\n；;]/)).filter(Boolean), kind = plain(pick(row, 'beadKind'));
      const beadKind = /^(?:透明|透明珠|transparent)$/.test(kind) ? 'transparent' : /^(?:特殊|特殊材质|special)$/.test(kind) ? 'special' : 'solid';
      if (kind && !/^(?:普通|普通实心|实心|solid|透明|透明珠|transparent|特殊|特殊材质|special)$/.test(kind)) warnings.push(`第${index + 2}行珠种“${kind}”请人工核对`);
      const rawKind = plain(pick(row, 'priceKind')), priceKind = /^(?:conditional|条件价|优惠价)$/.test(rawKind) || conditions.length ? 'conditional' : /^(?:range|区间|起价)$/.test(rawKind) || /[~～至]|\d\s*[-－]\s*\d|起/.test(plain(priceRaw)) ? 'range' : priceCents !== undefined ? 'regular' : 'unknown';
      const packCountRaw = pick(row, 'packCount'), packCount = quantity(packCountRaw, '(?:粒|颗|个)'), weight = plain(pick(row, 'packWeightGrams')).replace(/\s*(?:g|克)$/i, ''), diameterRaw = plain(pick(row, 'diameterMm'));
      if (packCountRaw !== undefined && (!packCount || packCount <= 0)) warnings.push(`第${index + 2}行每包粒数无效，已留空`);
      if (diameterRaw && !beadMarketDiameter(diameterRaw)) warnings.push(`第${index + 2}行珠径无效，需填写例如2.6或5`);
      const thresholdRaw = pick(row, 'freeShippingAbove'), thresholdCents = pick(row, 'freeShippingAboveCents'), freeShippingAboveCents = thresholdCents !== undefined ? quantity(thresholdCents, '分') : beadMarketMoneyCents(thresholdRaw), minRaw = pick(row, 'minPacks'), minPacks = minRaw === undefined ? 1 : quantity(minRaw, '(?:包|袋)');
      if (!minPacks) throw Error('起订包数需为正整数');
      const tiersValue = pick(row, 'tiers'), tiersRaw = typeof tiersValue === 'string' && tiersValue.trim() ? JSON.parse(tiersValue) : tiersValue || [];
      if (!Array.isArray(tiersRaw)) throw Error('阶梯价需为JSON数组');
      const tiers = tiersRaw.map(tier => ({ minPacks: quantity(tier.minPacks, '(?:包|袋)')!, priceCents: tier.priceCents !== undefined ? quantity(tier.priceCents, '分')! : beadMarketMoneyCents(tier.price)! }));
      const offer = checkedBeadMarketOffer({ id: context.idFactory?.() || crypto.randomUUID(), platform: chosen, url: link?.url || '', title: plain(pick(row, 'title')), sellerId: plain(pick(row, 'sellerId')), sellerName: plain(pick(row, 'sellerName')), brand: plain(pick(row, 'brand')), compatibleWith: plain(pick(row, 'compatibleWith')) || undefined, series: plain(pick(row, 'series')), diameterMm: beadMarketDiameter(diameterRaw), code: plain(pick(row, 'code')).toUpperCase(), beadKind, ...(packCount && packCount > 0 ? { packCount } : {}), ...(weight ? { packWeightGrams: weight } : {}), ...(priceCents !== undefined && priceCents > 0 ? { priceCents } : {}), minPacks, tiers, ...(shippingCents !== undefined ? { shippingCents } : {}), ...(freeShippingAboveCents !== undefined ? { freeShippingAboveCents } : {}), priceKind, conditions, conditionsAccepted: false, verification: 'candidate', evidence: { kind: 'table', capturedAt: timestamp(pick(row, 'capturedAt'), now), ...(pick(row, 'expiresAt') ? { expiresAt: timestamp(pick(row, 'expiresAt'), now) } : {}), ...(context.artifactId ? { artifactId: context.artifactId } : {}), ...(link ? { url: link.url } : {}) } });
      const identity = JSON.stringify({ ...offer, id: '' }); if (seen.has(identity)) { warnings.push(`第${index + 2}行与本表已有报价重复，已跳过`); return; } seen.add(identity); offers.push(offer);
    } catch (cause) { issues.push(`第${index + 2}行：${cause instanceof Error ? cause.message : '无法读取报价'}`); }
  });
  return { offers, issues, warnings };
}
