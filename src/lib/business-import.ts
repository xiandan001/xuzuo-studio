import type { BusinessImportPreview, BusinessMetric, BusinessProduct, BusinessState, BusinessTransaction } from '../business-types';
import { businessId } from './business-validation';

type RecordRow = BusinessProduct | BusinessTransaction | BusinessMetric;
export interface BusinessRowContext {
  state: BusinessState; orderId?: string; projectId?: string; now?: string; idFactory?: () => string;
  artifacts?: { id: string; name: string; projectId?: string; kind?: string; mimeType?: string; trashedAt?: string }[];
}
const normalize = (text: string) => text.normalize('NFKC').trim().toLowerCase();
export function businessRecordIdentity(kind: BusinessImportPreview['kind'], record: RecordRow): string | undefined {
  if (kind === 'products') { const row = record as BusinessProduct; return 'product:' + row.projectId + ':' + normalize(row.sku); }
  if (kind === 'transactions') { const row = record as BusinessTransaction; return row.externalId ? JSON.stringify(['transaction', row.source || '表格导入', row.kind, row.externalId]) : undefined; }
  const row = record as BusinessMetric;
  return JSON.stringify(['metric', row.source, normalize(row.platform), row.externalId || [row.orderId, row.artifactId || '', row.period.trim(), row.variant.trim()]]);
}
const sameRecord = (left: RecordRow, right: RecordRow) => {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)])) : value;
  const clean = (value: RecordRow) => canonical(Object.fromEntries(Object.entries(value).filter(([key]) => !['id', 'createdAt', 'updatedAt', 'factsConfirmedAt', 'voidedAt'].includes(key))));
  return JSON.stringify(clean(left)) === JSON.stringify(clean(right));
};
function pick(row: Record<string, string>, aliases: string[]): string {
  for (const alias of aliases) { const key = Object.keys(row).find(key => normalize(key) === normalize(alias)); if (key !== undefined && row[key].trim()) return row[key].trim(); }
  return '';
}
function money(value: string): number {
  const text = value.replace(/[￥¥,\s]/g, '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw Error('金额需填写人民币数值，最多两位小数');
  const [whole, fraction = ''] = text.split('.'), result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(result) || result > 1_000_000_000_000) throw Error('金额超出可计算范围');
  return result;
}
function count(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const text = value.replace(/[,\s]/g, ''); if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) > 1_000_000_000_000) throw Error('指标需使用平台原始整数，不能用“万”等缩略数');
  return Number(text);
}
const date = (value: string) => {
  if (!value || !Number.isFinite(Date.parse(value)) || /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value).toISOString().slice(0, 10) !== value) throw Error('请填写有效的日期或ISO时间');
  return value;
};
const fields = { sku: ['商品编号', 'SKU', 'sku', '货号'], name: ['商品名称', '商品名', '名称', 'name'], images: ['原图', '参考图', '参考图片', '图片', 'referenceArtifactIds', 'image'], order: ['制作单ID', '制作单'], external: ['流水号', '外部流水号', '交易号', '退款单号', 'externalId', '订单号', '订单ID', '订单编号', 'Order ID', 'order_id', 'orderId'], source: ['来源', '渠道', 'source'], type: ['类型', '交易类型', 'kind'], amount: ['金额', '实收金额', 'amount'], date: ['日期', '交易日期', '发生时间', 'occurredAt', '时间'] };
const factAliases: Record<string, string[]> = { material: ['material', '材质', '材料'], dimensions: ['dimensions', '尺寸', '规格'], price: ['price', '价格', '售价', '单价'], features: ['features', '卖点', '特征', '产品卖点'] };

function selectedOrder(row: Record<string, string>, context: BusinessRowContext): string {
  const explicit = pick(row, fields.order);
  if (explicit && context.orderId && !context.state.orders.some(order => order.id === context.orderId && (order.id === explicit || order.name === explicit))) throw Error('表格制作单与当前选中制作单不一致');
  const raw = context.orderId || explicit || pick(row, ['orderId']) || '', found = context.state.orders.filter(order => order.id === raw || order.name === raw);
  if (found.length !== 1) throw Error('请指定当前工作区中唯一的制作单');
  return found[0].id;
}
function resolveImages(text: string, projectId: string, context: BusinessRowContext): string[] {
  if (!text) return [];
  const images = (context.artifacts || []).filter(item => item.projectId === projectId && !item.trashedAt && ['image/png', 'image/jpeg', 'image/webp'].includes(item.mimeType || ''));
  const exact = images.filter(item => item.id === text || normalize(item.name) === normalize(text));
  const parts = exact.length ? [text] : text.split(/[;；|,\n]/).map(value => value.trim()).filter(Boolean);
  return [...new Set(parts.map(value => {
    const found = images.filter(item => item.id === value || normalize(item.name) === normalize(value));
    if (found.length !== 1) throw Error('参考图“' + value + '”未导入当前项目或有同名文件，请先导入原图或使用明确的产物编号');
    return found[0].id;
  }))];
}
function productRow(row: Record<string, string>, context: BusinessRowContext, id: string, now: string): BusinessProduct {
  const sku = pick(row, fields.sku), name = pick(row, fields.name), projectId = context.projectId || '';
  if (!sku || !name || !businessId(projectId)) throw Error('商品编号、商品名称和目标图片项目需要填写');
  const facts: Record<string, string> = {}, reserved = new Set([...fields.sku, ...fields.name, ...fields.images].map(normalize));
  for (const [key, value] of Object.entries(row)) if (!reserved.has(normalize(key)) && value.trim()) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw Error('表格包含不支持的字段名称');
    const canonical = Object.entries(factAliases).find(([, aliases]) => aliases.some(alias => normalize(alias) === normalize(key)))?.[0] || key.trim();
    if (facts[canonical] !== undefined && facts[canonical] !== value.trim()) throw Error('同一商品字段存在不同内容：' + canonical);
    facts[canonical] = value.trim();
  }
  return { id, sku, name, projectId, referenceArtifactIds: resolveImages(pick(row, fields.images), projectId, context), facts, updatedAt: now };
}
function transactionRow(row: Record<string, string>, context: BusinessRowContext, id: string): BusinessTransaction {
  const kindRaw = pick(row, fields.type), kinds: Record<string, BusinessTransaction['kind']> = { receipt: 'receipt', 收入: 'receipt', 收款: 'receipt', refund: 'refund', 退款: 'refund', fee: 'fee', 渠道费: 'fee', 手续费: 'fee', expense: 'expense', 其他费用: 'expense', 支出: 'expense', labor: 'labor', 人工: 'labor' }, kind = kinds[kindRaw];
  if (!kind) throw Error('类型应为收入、退款、渠道费、其他费用或人工');
  const externalId = pick(row, fields.external); if (!externalId) throw Error('流水号为必填，以免重复入账');
  const orderId = selectedOrder(row, context), amountRaw = pick(row, fields.amount);
  const minutesRaw = pick(row, ['分钟', '实际分钟', 'minutes']), rateRaw = pick(row, ['时薪', 'hourlyRate']);
  if (minutesRaw && (!/^\d+(?:\.\d{1,2})?$/.test(minutesRaw) || Number(minutesRaw) > 10000000)) throw Error('人工分钟数最多两位小数');
  const minutes = minutesRaw ? Number(minutesRaw) : undefined, hourlyRateCents = rateRaw ? money(rateRaw) : undefined;
  if ((minutes === undefined) !== (hourlyRateCents === undefined) || kind !== 'labor' && minutes !== undefined) throw Error('人工时长与时薪需同时填写，仅用于人工记录');
  const amountCents = amountRaw ? money(kind === 'refund' && amountRaw.startsWith('-') ? amountRaw.slice(1) : amountRaw) : kind === 'labor' && minutes !== undefined ? 0 : money(amountRaw);
  const quantity = count(pick(row, ['件数', '数量', '成交件数', '商品数量', '退货件数', 'quantity']));
  if (quantity !== undefined && (!quantity || !['receipt', 'refund'].includes(kind))) throw Error('件数需填写正整数，仅用于收款或退款流水');
  return { id, orderId, kind, amountCents, ...(quantity !== undefined ? { quantity } : {}), ...(minutes !== undefined ? { minutes, hourlyRateCents } : {}), occurredAt: date(pick(row, fields.date)), note: pick(row, ['备注', '说明', 'note']), source: pick(row, fields.source) || '表格导入', externalId };
}
function metricRow(row: Record<string, string>, context: BusinessRowContext, id: string, now: string): BusinessMetric {
  const orderId = selectedOrder(row, context), platform = pick(row, ['平台', 'platform']), variant = pick(row, ['版本', '素材版本', '作品名称', '素材名称', 'variant']), period = pick(row, ['周期', '统计周期', '统计日期', '日期', 'period']);
  if (!platform || !variant || !period) throw Error('平台、素材版本和统计周期需要填写');
  const result: BusinessMetric = { id, orderId, platform, variant, period, source: pick(row, fields.source) || '表格导入', createdAt: now };
  const columns = { impressions: ['曝光', '曝光量', 'impressions'], clicks: ['点击', '点击量', 'clicks'], inquiries: ['咨询', '咨询数', 'inquiries'], orders: ['成交', '成交数', 'orders'] };
  for (const [field, aliases] of Object.entries(columns)) { const value = count(pick(row, aliases)); if (value !== undefined) (result as unknown as Record<string, unknown>)[field] = value; }
  const revenue = pick(row, ['收入', '成交金额', 'revenue']); if (revenue) result.revenueCents = money(revenue);
  const external = pick(row, fields.external); if (external) result.externalId = external;
  const published = pick(row, ['发布时间', 'publishedAt']); if (published) result.publishedAt = date(published);
  if (['impressions', 'clicks', 'inquiries', 'orders', 'revenueCents'].every(key => (result as unknown as Record<string, unknown>)[key] === undefined)) throw Error('至少填写一项真实表现指标');
  return result;
}
export function normalizeBusinessRows(kind: BusinessImportPreview['kind'], rows: Record<string, string>[], context: BusinessRowContext) {
  const records: RecordRow[] = [], issues: string[] = [], conflicts: string[] = [], matchedIds: string[] = [], now = context.now || new Date().toISOString();
  let duplicates = 0;
  if (!['products', 'transactions', 'metrics'].includes(kind) || !Array.isArray(rows) || !rows.length || rows.length > 500) return { records, issues: ['请选择1–500行的有效业务表格'], conflicts, duplicates, matchedIds };
  const existing = new Map<string, RecordRow>();
  for (const record of context.state[kind]) { const key = businessRecordIdentity(kind, record); if (key) existing.set(key, record); }
  rows.forEach((row, index) => {
    try {
      if (!row || typeof row !== 'object' || Object.keys(row).length > 50 || Object.values(row).some(value => typeof value !== 'string' || value.length > 10000)) throw Error('表格行内容超过容量或包含非文本值');
      const id = context.idFactory?.() || crypto.randomUUID(), record = kind === 'products' ? productRow(row, context, id, now) : kind === 'transactions' ? transactionRow(row, context, id) : metricRow(row, context, id, now);
      const key = businessRecordIdentity(kind, record)!;
      const prior = existing.get(key);
      if (prior) { if (sameRecord(prior, record)) { duplicates++; matchedIds.push(prior.id); } else conflicts.push('第' + (index + 2) + '行与已有同号记录内容不同，请先核对，未覆盖原记录'); }
      else { existing.set(key, record); records.push(record); matchedIds.push(record.id); }
    } catch (error) { issues.push('第' + (index + 2) + '行：' + (error instanceof Error ? error.message : '无法读取该行')); }
  });
  return { records, issues, conflicts, duplicates, matchedIds: [...new Set(matchedIds)] };
}
