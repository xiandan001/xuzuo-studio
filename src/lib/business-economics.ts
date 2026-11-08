import type { BusinessEconomics, BusinessMetricSummary, BusinessState } from '../business-types';
import type { LedgerEntry } from '../types';
import { amountToQuoteCents, summarizeCosts } from './cost-display';

const safe = (value: bigint) => { const result = Number(value); if (!Number.isSafeInteger(result)) throw Error('汇总金额超过安全计算范围。'); return result; };
export function businessEconomics(state: BusinessState, orderId: string, ledger: readonly LedgerEntry[]): BusinessEconomics {
  const order = state.orders.find(item => item.id === orderId); if (!order) throw Error('制作单不存在。');
  const transactions = state.transactions.filter(item => item.orderId === orderId && !item.voidedAt), missing: string[] = [];
  const sum = (kind: string) => safe(transactions.filter(item => item.kind === kind).reduce((total, item) => total + BigInt(item.amountCents), 0n));
  const labor = transactions.filter(item => item.kind === 'labor');
  const laborCents = safe(labor.reduce((total, item) => total + (item.minutes === undefined ? BigInt(item.amountCents) : (BigInt(Math.round(item.minutes * 100)) * BigInt(item.hourlyRateCents!) + 5999n) / 6000n), 0n));
  const runIds = new Set(order.runIds), fees = [...new Map(ledger.filter(item => item.billingMode === 'live' && item.workflowRunId && runIds.has(item.workflowRunId)).map(item => [item.id, item])).values()], costs = summarizeCosts(fees);
  const apiCents = costs.quoteCents ?? amountToQuoteCents(costs.cnyAmount) ?? 0;
  if (costs.pendingCount || costs.missingFxCount) missing.push('部分API计费依据或人民币换算待补齐');
  if (costs.legacyCount) missing.push('部分历史API金额缺少精确计费明细');
  if (runIds.size && !fees.length) missing.push('制作运行尚无可关联的计费记录');
  if (order.tasks.some(task => task.submittedAt && !task.runId)) missing.push('有模型提交结果待确认，不能按零API成本结算');
  if (!labor.length) missing.push('尚未记录实际人工，可明确记录0分钟');
  if (!transactions.some(item => item.kind === 'receipt')) missing.push('尚未记录实际收款');
  if (order.status !== 'complete' || order.tasks.some(task => task.status !== 'complete')) missing.push('制作任务尚未结束，后续制作成本待确认');
  const receiptsCents = sum('receipt'), refundsCents = sum('refund'), feesCents = sum('fee'), expensesCents = sum('expense');
  const quantities = (kind: 'receipt' | 'refund') => { const rows = transactions.filter(item => item.kind === kind && item.quantity !== undefined); return rows.length ? safe(rows.reduce((total, item) => total + BigInt(item.quantity!), 0n)) : undefined; };
  const knownBalanceCents = safe(BigInt(receiptsCents) - BigInt(refundsCents) - BigInt(feesCents) - BigInt(expensesCents) - BigInt(laborCents) - BigInt(apiCents));
  return { receiptsCents, refundsCents, feesCents, expensesCents, laborCents, apiCents, receivedQuantity: quantities('receipt'), refundedQuantity: quantities('refund'), knownBalanceCents, complete: !missing.length, missing, approximate: costs.approximate };
}
export function businessMetrics(state: BusinessState, orderId: string): BusinessMetricSummary[] {
  const groups = new Map<string, BusinessState['metrics']>();
  for (const row of state.metrics.filter(item => item.orderId === orderId)) { const key = JSON.stringify([row.platform.trim().toLowerCase(), row.period.trim(), row.variant.trim()]); groups.set(key, [...(groups.get(key) || []), row]); }
  return [...groups.values()].map(rows => {
    const first = rows[0], result: BusinessMetricSummary = { platform: first.platform, period: first.period, variant: first.variant };
    for (const field of ['impressions', 'clicks', 'inquiries', 'orders', 'revenueCents'] as const) if (rows.every(row => row[field] !== undefined)) result[field] = safe(rows.reduce((total, row) => total + BigInt(row[field]!), 0n));
    if (result.impressions && result.clicks !== undefined) result.clickRate = result.clicks / result.impressions;
    if (result.impressions && result.inquiries !== undefined) result.inquiryRate = result.inquiries / result.impressions;
    if (result.clicks && result.orders !== undefined) result.conversionRate = result.orders / result.clicks;
    return result;
  });
}
