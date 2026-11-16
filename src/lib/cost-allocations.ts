import type { BusinessCostAllocation } from '../business-types';
import type { LedgerEntry } from '../types';
import type { CostCalculation } from '../billing-types';
import { displayCost } from './cost-display';

const SCALE = 10n ** 42n;
function units(value: string): bigint { if (!/^\d+(?:\.\d{1,42})?$/.test(value)) throw Error('费用金额格式无效。'); const [whole, fraction = ''] = value.split('.'); return BigInt(whole) * SCALE + BigInt(fraction.padEnd(42, '0')); }
function decimal(value: bigint): string { const fraction = (value % SCALE).toString().padStart(42, '0').replace(/0+$/, ''); return `${value / SCALE}${fraction ? '.' + fraction : ''}`; }
export function allocatedAmount(value: string, basisPoints: number): string {
  if (!Number.isInteger(basisPoints) || basisPoints < 1 || basisPoints > 10000) throw Error('分摊比例须为0.01%至100%。');
  return decimal(units(value) * BigInt(basisPoints) / 10000n);
}
export function allocationPercent(value: string): number {
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(value.trim())) throw Error('比例最多两位小数。');
  const [whole, fraction = ''] = value.trim().split('.'), result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (result < 1 || result > 10000) throw Error('分摊比例须为0.01%至100%。'); return result;
}
export function allocationCosts(ledger: readonly LedgerEntry[], allocations: readonly BusinessCostAllocation[], target: { projectId?: string; orderId?: string; projectIds?: string[] }): LedgerEntry[] {
  const known = new Map(ledger.map(entry => [entry.id, entry]));
  const offsets = new Map<string, number>(), totals = new Map<string, number>();
  for (const row of allocations) if (!row.voidedAt) { const before = totals.get(row.entryId) || 0; offsets.set(row.id, before); totals.set(row.entryId, before + row.basisPoints); }
  const share = (amount: string, row: BusinessCostAllocation) => { const before = offsets.get(row.id) || 0, value = units(amount); return decimal(value * BigInt(before + row.basisPoints) / 10000n - value * BigInt(before) / 10000n); };
  return allocations.filter(row => !row.voidedAt && (target.orderId ? row.orderId === target.orderId || !row.orderId && !!row.projectId && target.projectIds?.includes(row.projectId) : row.projectId === target.projectId)).map(row => {
    const source = known.get(row.entryId);
    if (!source) return { id: `allocated-${row.id}`, projectId: row.projectId || '', projectName: '前期费用', action: 'AI 复核', model: '原计费记录暂不可用', costCents: 0, costState: 'unknown', billingMode: 'live', time: row.createdAt, status: 'complete', costReason: '已保存费用归属，但原调用记录暂不可用，不能按零成本报价。' };
    const display = displayCost(source);
    let calculation: CostCalculation | undefined;
    if (display.nativeAmount !== undefined && display.nativeCurrency) calculation = { version: 1, ruleId: 'cost-allocation', ruleVersion: '1', nativeCurrency: display.nativeCurrency, nativeAmount: share(display.nativeAmount, row), ...(display.cnyAmount !== undefined ? { cnyAmount: share(display.cnyAmount, row) } : {}), fx: source.calculation?.fx, components: [], basis: `原调用 ${source.id} 的 ${row.basisPoints / 100}% 费用归属；原计费规则 ${source.calculation?.ruleId || '已保存金额'}。不产生新调用，不重复计入工作区总额。`, completeness: display.pending ? 'partial' : 'complete' };
    return { ...source, id: `allocated-${row.id}`, projectId: row.projectId || '', projectName: `前期费用 · ${source.projectName}`, costCents: Number(BigInt(source.costCents) * BigInt(row.basisPoints) / 10000n), costState: calculation && !display.pending ? 'calculated' : 'unknown', calculation, quantity: undefined, usage: undefined };
  });
}
export function checkAllocationShares(rows: readonly BusinessCostAllocation[]) {
  const totals = new Map<string, number>();
  for (const row of rows.filter(row => !row.voidedAt)) { const sum = (totals.get(row.entryId) || 0) + row.basisPoints; if (sum > 10000) throw Error('同一笔费用的分摊合计不能超过100%。'); totals.set(row.entryId, sum); }
}
