import { describe, expect, it } from 'vitest';
import type { BusinessOrder, BusinessState } from '../business-types';
import { newBusinessState, businessStateIssue } from './business-data';
import { businessReceivables } from './business-receivables';

const time = '2026-11-12T00:00:00Z';
function state(): BusinessState {
  const order: BusinessOrder = { id: 'order', name: '真实订单', recipe: 'documents', sourceProjectId: 'project', brief: '', productIds: [], projectIds: ['project'], runIds: ['paid-api-run'], outputIds: [], includedRevisions: 1, status: 'draft', factsRevision: 1, facts: {}, outputKinds: ['word'], imageCount: 1, sizes: [], tasks: [], bindings: {}, createdAt: time, updatedAt: time, paymentPlan: { currency: 'CNY', agreedCents: 10001, milestones: [{ id: 'deposit', label: '订金', amountCents: 3000, dueDate: '2026-11-11' }, { id: 'balance', label: '尾款', amountCents: 7001, dueDate: '2026-11-30' }] } };
  return { ...newBusinessState('workspace'), orders: [order] };
}
describe('真实流水推导的分期应收', () => {
  it('约定不冒充收款、按整数分计算、不改原始费用或流水', () => {
    const value = state(), before = structuredClone(value), result = businessReceivables(value, 'order', new Date(time));
    expect(result).toMatchObject({ agreedCents: 10001, netReceivedCents: 0, remainingCents: 10001, dueCents: 3000 });
    expect(result.milestones[0]).toMatchObject({ overdue: true, paidCents: 0 }); expect(value).toEqual(before);
  });
  it('旧流水自动归集、指定尾款和退款分开计算，作废流水不计入', () => {
    const value = state(); value.transactions = [
      { id: 'a', orderId: 'order', kind: 'receipt', amountCents: 4000, note: '', occurredAt: time },
      { id: 'b', orderId: 'order', kind: 'receipt', amountCents: 3000, paymentMilestoneId: 'balance', note: '', occurredAt: time },
      { id: 'c', orderId: 'order', kind: 'refund', amountCents: 1000, paymentMilestoneId: 'balance', note: '', occurredAt: time },
      { id: 'd', orderId: 'order', kind: 'receipt', amountCents: 9999, note: '', occurredAt: time, voidedAt: time },
    ];
    const before = structuredClone(value), result = businessReceivables(value, 'order', new Date(time));
    expect(result).toMatchObject({ netReceivedCents: 6000, remainingCents: 4001, dueCents: 0 });
    expect(result.milestones.map(row => row.paidCents)).toEqual([3000, 3000]); expect(value).toEqual(before);
  });
  it('超过某期金额会标记归属待核对，不把全单已收齐说成逾期欠款', () => {
    const value = state(); value.transactions = [{ id: 'a', orderId: 'order', kind: 'receipt', amountCents: 11000, paymentMilestoneId: 'deposit', note: '', occurredAt: time }];
    expect(businessReceivables(value, 'order', new Date('2026-12-01T00:00:00Z'))).toMatchObject({ remainingCents: 0, dueCents: 0, overpaidCents: 999, needsAllocation: true });
  });
  it('使用上海日期判断到期，旧数据没有计划时不伪造应收', () => {
    const value = state(); value.orders[0].paymentPlan!.milestones[0].dueDate = '2026-11-13';
    expect(businessReceivables(value, 'order', new Date('2026-11-12T16:01:00Z')).dueCents).toBe(3000);
    delete value.orders[0].paymentPlan; expect(businessReceivables(value, 'order').hasPlan).toBe(false); expect(businessStateIssue(value)).toBe('');
  });
  it('拒绝不相等分期合计、无效日期、未知归属和伪装收款字段', () => {
    const value = state(); expect(businessStateIssue(value)).toBe('');
    value.orders[0].paymentPlan!.milestones[0].dueDate = '2026-02-30'; expect(businessStateIssue(value)).not.toBe('');
    value.orders[0].paymentPlan!.milestones[0].dueDate = '2026-11-12'; value.orders[0].paymentPlan!.agreedCents = 1; expect(businessStateIssue(value)).not.toBe('');
    value.orders[0].paymentPlan!.agreedCents = 10001; value.transactions = [{ id: 'x', orderId: 'order', kind: 'receipt', amountCents: 10, paymentMilestoneId: 'foreign', note: '', occurredAt: time }]; expect(businessStateIssue(value)).not.toBe('');
  });
  it('既有流水改归属只追加审计，同笔不重复计入、可退回自动归集', () => {
    const value = state(); value.transactions = [{ id: 'receipt', orderId: 'order', kind: 'receipt', amountCents: 4000, note: '真实收款不改写', occurredAt: time }];
    const original = structuredClone(value.transactions);
    value.orders[0].paymentPlan!.assignments = [{ id: 'a', transactionId: 'receipt', milestoneId: 'balance', createdAt: time }];
    expect(businessStateIssue(value)).toBe(''); expect(businessReceivables(value, 'order', new Date(time)).milestones.map(row => row.paidCents)).toEqual([0, 4000]);
    value.orders[0].paymentPlan!.assignments[0].voidedAt = time;
    value.orders[0].paymentPlan!.assignments.push({ id: 'b', transactionId: 'receipt', createdAt: time });
    expect(businessReceivables(value, 'order', new Date(time)).milestones.map(row => row.paidCents)).toEqual([3000, 1000]); expect(value.transactions).toEqual(original);
    value.orders[0].paymentPlan!.assignments.push({ id: 'duplicate', transactionId: 'receipt', milestoneId: 'deposit', createdAt: time }); expect(businessStateIssue(value)).not.toBe('');
  });
});
