import { describe, expect, it } from 'vitest';
import type { LedgerEntry } from '../types';
import { allocatedAmount, allocationCosts, allocationPercent, checkAllocationShares } from './cost-allocations';
import { summarizeCosts } from './cost-display';
const source = { id: 'chat-fee', projectId: '', workspaceId: 'workspace', scope: 'chat', projectName: '准备方案', action: 'AI 复核', model: 'local fixture', costCents: 10, costState: 'calculated', billingMode: 'live', time: '2026-11-12T00:00:00Z', status: 'complete', calculation: { version: 1, ruleId: 'fixture', ruleVersion: '1', nativeCurrency: 'USD', nativeAmount: '0.013560123456789', cnyAmount: '0.09040966666666667', components: [], basis: 'fixture', completeness: 'complete' } } as LedgerEntry;
const row = (id: string, projectId: string, basisPoints: number) => ({ id, entryId: source.id, projectId, basisPoints, note: '', createdAt: source.time });
describe('聊天费用归属', () => {
  it('uses integer percentages and decimal arithmetic without binary floating loss', () => { expect(allocationPercent('33.33')).toBe(3333); expect(allocatedAmount('0.013560123456789', 3333)).toBe('0.0045195891481477737'); expect(allocatedAmount('0.00000000000000000001', 5000)).toBe('0.000000000000000000005'); expect(() => allocationPercent('100.01')).toThrow(); expect(() => allocationPercent('0')).toThrow(); });
  it('keeps workspace ledger exact once, derives project and order quote costs, and retains missing-source warnings', () => {
    const original = structuredClone(source), allocations = [row('a', 'p1', 5000), { ...row('b', 'p2', 5000), orderId: 'order' }];
    expect(summarizeCosts([source]).usdAmount).toBe('0.013560123456789');
    expect(summarizeCosts(allocationCosts([source], allocations, { projectId: 'p1' })).usdAmount).toBe('0.0067800617283945');
    expect(summarizeCosts(allocationCosts([source], allocations, { orderId: 'order', projectIds: ['p1', 'p2'] })).usdAmount).toBe(source.calculation?.nativeAmount);
    expect(summarizeCosts(allocationCosts([], allocations, { projectId: 'p1' })).pendingCount).toBe(1);
    expect(source).toEqual(original); expect(allocationCosts([source], [{ ...allocations[0], voidedAt: source.time }], { projectId: 'p1' })).toEqual([]);
  });
  it('rejects over-allocation and ignores historical voided shares', () => { expect(() => checkAllocationShares([row('a', 'p1', 5000), row('b', 'p2', 5001)])).toThrow('100%'); expect(() => checkAllocationShares([{ ...row('a', 'p1', 10000), voidedAt: source.time }, row('b', 'p2', 10000)])).not.toThrow(); });
  it('conserves the full original amount even at the supported 42-decimal boundary', () => { const tiny = { ...source, calculation: { ...source.calculation!, nativeAmount: '0.' + '0'.repeat(41) + '1' } }, allocations = [row('a', 'p1', 3333), row('b', 'p1', 6667)]; expect(summarizeCosts(allocationCosts([tiny], allocations, { projectId: 'p1' })).usdAmount).toBe(tiny.calculation.nativeAmount); });
});
