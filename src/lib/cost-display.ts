import type { CostCalculation } from '../billing-types';
import type { WorkflowAttempt, WorkflowRun } from '../configuration-types';
import type { LedgerEntry } from '../types';

const DECIMAL_PLACES = 42;
const SCALE = 10n ** BigInt(DECIMAL_PLACES);
const DISPLAY_SCALE = 100000000n;
export type CostRecord = Pick<LedgerEntry, 'costCents' | 'costState' | 'billingMode' | 'calculation' | 'costReason'>;
export interface DisplayCost {
  nativeCurrency?: 'USD' | 'CNY'; nativeAmount?: string; cnyAmount?: string;
  pending: boolean; missingFx: boolean; approximate: boolean; legacy: boolean; partial: boolean;
  calculation?: CostCalculation;
}
export interface CostSummary {
  usdAmount: string; nativeCnyAmount: string; cnyAmount: string;
  usdCount: number; cnyCount: number; pendingCount: number; missingFxCount: number; legacyCount: number;
  approximate: boolean; count: number; quoteCents?: number;
}

function decimal(value: unknown): bigint | undefined {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,42})?$/.test(value)) return undefined;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(DECIMAL_PLACES, '0'));
}
function decimalString(value: bigint): string {
  const fraction = (value % SCALE).toString().padStart(DECIMAL_PLACES, '0').replace(/0+$/, '');
  return `${value / SCALE}${fraction ? `.${fraction}` : ''}`;
}
export function addCostAmounts(values: string[]): string {
  return decimalString(values.reduce((sum, value) => { const parsed = decimal(value); if (parsed === undefined) throw new Error('无效的十进制费用'); return sum + parsed; }, 0n));
}
export function formatCostAmount(value: string, currency: 'USD' | 'CNY'): string {
  const amount = decimal(value); if (amount === undefined) return '金额暂不可用';
  const symbol = currency === 'USD' ? '$' : '¥';
  const precision = SCALE / DISPLAY_SCALE;
  if (amount > 0n && amount < precision) return `<${symbol}0.00000001`;
  const rounded = (amount + precision / 2n) / precision;
  const fraction = (rounded % DISPLAY_SCALE).toString().padStart(8, '0').replace(/0+$/, '').padEnd(2, '0');
  return `${symbol}${rounded / DISPLAY_SCALE}.${fraction}`;
}
export function amountToQuoteCents(value: string): number | undefined {
  const amount = decimal(value); if (amount === undefined) return undefined;
  const cents = (amount + SCALE / 100n - 1n) / (SCALE / 100n);
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : undefined;
}
function recordedAmount(cents: number): string | undefined {
  return Number.isSafeInteger(cents) && cents >= 0 ? `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}` : undefined;
}
export function displayCost(entry: CostRecord): DisplayCost {
  const base = { pending: false, missingFx: false, approximate: false, legacy: false, partial: false };
  if (entry.billingMode !== 'live' || entry.costState === 'manual' || entry.costState === 'not-incurred') {
    const amount = entry.costState === 'not-incurred' ? '0' : recordedAmount(entry.costCents);
    return { ...base, ...(amount === undefined ? { pending: true } : { nativeCurrency: 'CNY', nativeAmount: amount, cnyAmount: amount }), calculation: entry.calculation };
  }
  const receipt = entry.calculation;
  if (receipt && receipt.version === 1 && ['USD', 'CNY'].includes(receipt.nativeCurrency) && decimal(receipt.nativeAmount) !== undefined) {
    const cny = receipt.nativeCurrency === 'CNY' ? receipt.nativeAmount : decimal(receipt.cnyAmount) !== undefined ? receipt.cnyAmount : undefined;
    const partial = receipt.completeness !== 'complete';
    return { ...base, nativeCurrency: receipt.nativeCurrency, nativeAmount: receipt.nativeAmount, cnyAmount: cny,
      pending: partial || entry.costState !== 'calculated', missingFx: receipt.nativeCurrency === 'USD' && cny === undefined,
      approximate: receipt.nativeCurrency === 'USD' && cny !== undefined, partial, calculation: receipt };
  }
  const legacy = entry.costState === 'calculated' ? recordedAmount(entry.costCents) : undefined;
  return legacy === undefined ? { ...base, pending: true } : { ...base, legacy: true, nativeCurrency: 'CNY', nativeAmount: legacy, cnyAmount: legacy };
}
export function costPrimary(entry: CostRecord): string {
  const value = displayCost(entry);
  if (!value.nativeCurrency || value.nativeAmount === undefined) return '计费依据待补齐';
  return `${formatCostAmount(value.nativeAmount, value.nativeCurrency)}${value.partial ? '（部分）' : value.legacy ? '（历史记录）' : ''}`;
}
export function costSecondary(entry: CostRecord): string {
  const value = displayCost(entry);
  const details = [];
  if (value.missingFx) details.push(`${value.partial ? '已知部分美元费用已保留' : '美元费用已知'}，人民币换算暂不可用`);
  else if (value.approximate && value.cnyAmount !== undefined) details.push(`≈${formatCostAmount(value.cnyAmount, 'CNY')}`);
  if (value.pending) details.push(`计费依据待补齐：${entry.costReason?.trim() || '用量、单价或适用规则尚未完整确认'}`);
  if (details.length) return details.join(' · ');
  if (value.legacy) return '旧版分值记录，缺少精确计算明细';
  return entry.costState === 'manual' ? '人工账单校正' : entry.costState === 'not-incurred' ? '未发出收费请求' : '';
}
export function summarizeCosts(entries: CostRecord[]): CostSummary {
  const values = entries.map(displayCost);
  const sum = (currency: 'USD' | 'CNY') => addCostAmounts(values.filter(value => value.nativeCurrency === currency && value.nativeAmount !== undefined).map(value => value.nativeAmount!));
  const cnyAmount = addCostAmounts(values.filter(value => value.cnyAmount !== undefined).map(value => value.cnyAmount!));
  const pendingCount = values.filter(value => value.pending).length, missingFxCount = values.filter(value => value.missingFx).length;
  return { usdAmount: sum('USD'), nativeCnyAmount: sum('CNY'), cnyAmount, usdCount: values.filter(value => value.nativeCurrency === 'USD').length, cnyCount: values.filter(value => value.nativeCurrency === 'CNY').length,
    pendingCount, missingFxCount, legacyCount: values.filter(value => value.legacy).length, approximate: values.some(value => value.approximate), count: entries.length,
    ...(!pendingCount && !missingFxCount ? { quoteCents: amountToQuoteCents(cnyAmount) } : {}) };
}
export function costSummaryPrimary(summary: CostSummary): string {
  const native = [summary.usdCount ? formatCostAmount(summary.usdAmount, 'USD') : '', summary.cnyCount && (!summary.usdCount || decimal(summary.nativeCnyAmount)! > 0n) ? formatCostAmount(summary.nativeCnyAmount, 'CNY') : ''].filter(Boolean).join(' + ');
  return native || (summary.pendingCount ? '计费依据待补齐' : '¥0.00');
}
export function costSummarySecondary(summary: CostSummary): string {
  return [summary.usdCount && !summary.missingFxCount ? `${summary.approximate ? '≈' : ''}${formatCostAmount(summary.cnyAmount, 'CNY')}` : '', summary.missingFxCount ? `${summary.missingFxCount} 笔待换算人民币` : '', summary.pendingCount ? `${summary.pendingCount} 笔计费依据待补齐` : '', summary.legacyCount ? `含 ${summary.legacyCount} 笔历史分值记录` : ''].filter(Boolean).join(' · ');
}
export function attemptCostRecord(attempt: WorkflowAttempt, ledger: LedgerEntry[], live: boolean): CostRecord {
  return live ? ledger.find(entry => entry.workflowAttemptId === attempt.id) || { ...attempt, billingMode: 'live' } : { ...attempt, billingMode: 'simulation' };
}
export function runCostRecords(run: WorkflowRun, ledger: LedgerEntry[]): CostRecord[] {
  if (run.mode !== 'live') return run.attempts.map(attempt => ({ ...attempt, billingMode: 'simulation' }));
  const entries = ledger.filter(entry => entry.workflowRunId === run.id);
  const missing = run.attempts.filter(attempt => !entries.some(entry => entry.workflowAttemptId === attempt.id) && run.snapshot.steps.some(step => step.id === attempt.stepId && !['manual-review', 'export', 'animation-compose'].includes(step.kind)));
  return [...entries, ...missing.map(attempt => ({ ...attempt, billingMode: 'live' as const }))];
}
