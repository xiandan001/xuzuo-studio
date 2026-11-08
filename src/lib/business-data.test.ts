import { describe, expect, it } from 'vitest';
import { newBusinessState, businessStateIssue, businessEconomics, businessMetrics, normalizeBusinessRows } from './business-data';
import type { BusinessOrder, BusinessState } from '../business-types';
import type { LedgerEntry } from '../types';

const time = '2026-11-08T00:00:00Z';
const order = (): BusinessOrder => ({ id: 'order', name: '新品物料', recipe: 'merchant', sourceProjectId: 'project', brief: '', productIds: [], projectIds: ['project'], runIds: [], outputIds: [], includedRevisions: 1, status: 'draft', factsRevision: 1, facts: {}, outputKinds: ['image'], imageCount: 1, sizes: [], tasks: [], bindings: {}, createdAt: time, updatedAt: time });
function state(): BusinessState { return { ...newBusinessState('workspace'), orders: [order()] }; }
describe('business data and actual revenue accounting', () => {
  it('creates isolated metadata and rejects duplicate IDs, unknown fields and foreign ownership', () => {
    const value = state(); expect(businessStateIssue(value)).toBe('');
    expect(businessStateIssue({ ...value, apiKey: 'do-not-store' })).not.toBe('');
    expect(businessStateIssue({ ...value, orders: [order(), order()] })).not.toBe('');
    expect(businessStateIssue({ ...value, transactions: [{ id: 't', orderId: 'missing', kind: 'receipt', amountCents: 10, note: '', occurredAt: time }] })).not.toBe('');
  });
  it('never charges the same native run twice and retains all charges after refunds and content changes', () => {
    const value = state(); value.orders[0].runIds = ['run'];
    value.transactions = [{ id: 'income', orderId: 'order', kind: 'receipt', amountCents: 10000, note: '', occurredAt: time }, { id: 'refund', orderId: 'order', kind: 'refund', amountCents: 2000, note: '', occurredAt: time }, { id: 'labor', orderId: 'order', kind: 'labor', amountCents: 0, minutes: 10, hourlyRateCents: 6000, note: '', occurredAt: time }];
    const fee = { id: 'fee', workflowRunId: 'run', projectId: 'project', billingMode: 'live', costState: 'calculated', costCents: 23 } as LedgerEntry;
    const copy = JSON.stringify(value), ledger = Object.freeze([Object.freeze(fee), Object.freeze(fee)]) as unknown as LedgerEntry[];
    const result = businessEconomics(value, 'order', ledger);
    expect(result).toMatchObject({ receiptsCents: 10000, refundsCents: 2000, laborCents: 1000, apiCents: 23, knownBalanceCents: 6977 });
    value.transactions[0].voidedAt = time;
    expect(businessEconomics(value, 'order', ledger)).toMatchObject({ apiCents: 23, knownBalanceCents: -3023 });
    expect(JSON.stringify(fee)).toBe(JSON.stringify(ledger[0])); expect(copy).not.toBe(JSON.stringify(value));
  });
  it('does not use shared project totals as API expense for an unrelated run', () => {
    const value = state(); value.orders[0].runIds = ['own'];
    const fees = [{ id: 'a', projectId: 'project', workflowRunId: 'other', billingMode: 'live', costState: 'calculated', costCents: 999 }] as LedgerEntry[];
    expect(businessEconomics(value, 'order', fees).apiCents).toBe(0);
    expect(businessEconomics(value, 'order', fees).complete).toBe(false);
  });
  it('adds precise CNY calculation amounts before rounding and marks missing costs or labor incomplete', () => {
    const value = state(); value.orders[0].runIds = ['run'];
    const fees = ['0.004', '0.004'].map((amount, index) => ({ id: 'a' + index, workflowRunId: 'run', billingMode: 'live', costState: 'calculated', costCents: 1, calculation: { version: 1, nativeCurrency: 'CNY', nativeAmount: amount, completeness: 'complete' } })) as LedgerEntry[];
    const result = businessEconomics(value, 'order', fees); expect(result.apiCents).toBe(1); expect(result.complete).toBe(false); expect(result.missing.join(' ')).toContain('人工');
    fees.push({ id: 'pending', workflowRunId: 'run', billingMode: 'live', costState: 'unknown', costCents: 0 } as unknown as LedgerEntry);
    expect(businessEconomics(value, 'order', fees).missing.join(' ')).toContain('计费');
  });
  it('forbids assigning one paid run to two production orders', () => {
    const value = state(); value.orders[0].runIds = ['run']; value.orders.push({ ...order(), id: 'second', runIds: ['run'] });
    expect(businessStateIssue(value)).toContain('运行');
  });
  it('uses two-decimal minutes and an explicit zero labor declaration without manufacturing completed profit', () => {
    const value = state(); value.orders[0].status = 'complete';
    value.transactions = [{ id: 'income', orderId: 'order', kind: 'receipt', amountCents: 100, note: '', occurredAt: time }, { id: 'labor', orderId: 'order', kind: 'labor', amountCents: 0, minutes: 0.25, hourlyRateCents: 6000, note: '', occurredAt: time }];
    expect(businessStateIssue(value)).toBe(''); expect(businessEconomics(value, 'order', [])).toMatchObject({ laborCents: 25, knownBalanceCents: 75, complete: true });
    value.transactions[1].minutes = 0; expect(businessEconomics(value, 'order', [])).toMatchObject({ laborCents: 0, complete: true });
    value.orders[0].tasks = [{ id: 'task', label: '待制作', kind: 'image', status: 'stale', artifactIds: [], factsRevision: 0 }];
    expect(businessEconomics(value, 'order', []).complete).toBe(false);
    expect(businessEconomics(value, 'order', []).missing.join(' ')).toContain('后续制作成本');
    value.orders[0].tasks[0] = { ...value.orders[0].tasks[0], status: 'complete', submittedAt: time };
    expect(businessEconomics(value, 'order', []).missing.join(' ')).toContain('提交结果待确认');
  });
  it('keeps platform, interval and variant groups separate and never invents rates for missing or zero denominators', () => {
    const value = state(); value.metrics = [
      { id: 'a', orderId: 'order', platform: '抖音', period: '2026-11-01~07', variant: 'A', impressions: 0, clicks: 0, source: '手动', createdAt: time },
      { id: 'b', orderId: 'order', platform: '小红书', period: '2026-11-01~07', variant: 'A', impressions: 100, clicks: 10, inquiries: 2, orders: 1, source: '手动', createdAt: time },
      { id: 'c', orderId: 'order', platform: '小红书', period: '2026-11-08~14', variant: 'A', clicks: 10, source: '手动', createdAt: time },
    ];
    const rows = businessMetrics(value, 'order'); expect(rows).toHaveLength(3);
    expect(rows.find(row => row.platform === '抖音')?.clickRate).toBeUndefined();
    expect(rows.find(row => row.platform === '小红书' && row.impressions === 100)).toMatchObject({ clickRate: 0.1, inquiryRate: 0.02, conversionRate: 0.1 });
    expect(rows.find(row => row.period === '2026-11-08~14')?.impressions).toBeUndefined();
  });
  it('imports transaction aliases, rejects no identity or conflict, and safely skips repeated external rows', () => {
    const value = state(), rows = [{ 流水号: '00012', 类型: '收入', 金额: '29.90', 日期: '2026-11-08', 来源: '店铺' }];
    const first = normalizeBusinessRows('transactions', rows, { state: value, orderId: 'order', now: time });
    expect(first.issues).toEqual([]); expect(first.records[0]).toMatchObject({ externalId: '00012', kind: 'receipt', amountCents: 2990 });
    value.transactions = first.records as BusinessState['transactions'];
    expect(normalizeBusinessRows('transactions', rows, { state: value, orderId: 'order', now: time }).duplicates).toBe(1);
    expect(normalizeBusinessRows('transactions', [{ ...rows[0], 金额: '30' }], { state: value, orderId: 'order', now: time }).conflicts).toHaveLength(1);
    expect(normalizeBusinessRows('transactions', [{ 类型: '收入', 金额: '30' }], { state: value, orderId: 'order', now: time }).issues).not.toEqual([]);
  });
  it('resolves product references by exact filename without pretending an ambiguous photo is the right SKU', () => {
    const value = state(), rows = [{ 商品编号: '0001', 商品名称: '红杯', 原图: 'cup.png', 材质: '陶瓷' }];
    const context = { state: value, projectId: 'project', now: time, artifacts: [{ id: 'image', name: 'cup.png', projectId: 'project', kind: 'image', mimeType: 'image/png' }] };
    const result = normalizeBusinessRows('products', rows, context);
    expect(result.issues).toEqual([]); expect(result.records[0]).toMatchObject({ sku: '0001', referenceArtifactIds: ['image'], facts: { material: '陶瓷' } });
    expect(normalizeBusinessRows('products', rows, { ...context, artifacts: [...context.artifacts, { ...context.artifacts[0], id: 'other' }] }).issues).not.toEqual([]);
  });
  it('keeps an external order identifier separate from the selected internal production order', () => {
    const value = state(), result = normalizeBusinessRows('transactions', [{ 订单ID: '00001234', 类型: '收入', 金额: '19.90', 交易日期: '2026-11-08' }], { state: value, orderId: 'order', now: time });
    expect(result.issues).toEqual([]); expect(result.records[0]).toMatchObject({ orderId: 'order', externalId: '00001234', amountCents: 1990 });
    expect(normalizeBusinessRows('transactions', [{ 制作单: '另一个单', 流水号: '123', 类型: '收入', 金额: '19.90', 日期: '2026-11-08' }], { state: value, orderId: 'order', now: time }).issues).toHaveLength(1);
  });
  it('rejects duplicate active external receipts even if a client bypasses the import preview', () => {
    const value = state(), first = { id: 'first', orderId: 'order', kind: 'receipt' as const, amountCents: 100, occurredAt: time, note: '', source: '店铺', externalId: '0123' };
    value.transactions = [first, { ...first, id: 'second' }]; expect(businessStateIssue(value)).toContain('流水号重复');
    value.transactions[0].voidedAt = time; expect(businessStateIssue(value)).toBe('');
  });
  it('counts only explicit sold and returned quantities, without treating payment records as units sold', () => {
    const value = state();
    value.transactions = [
      { id: 'sale', orderId: 'order', kind: 'receipt', amountCents: 100, quantity: 3, occurredAt: time, note: '' },
      { id: 'unknown-sale', orderId: 'order', kind: 'receipt', amountCents: 200, occurredAt: time, note: '' },
      { id: 'refund', orderId: 'order', kind: 'refund', amountCents: 50, occurredAt: time, note: '' },
    ];
    expect(businessStateIssue(value)).toBe(''); expect(businessEconomics(value, 'order', [])).toMatchObject({ receivedQuantity: 3, refundedQuantity: undefined });
    value.transactions[2].quantity = 1; expect(businessEconomics(value, 'order', []).refundedQuantity).toBe(1);
    value.transactions[0].voidedAt = time; expect(businessEconomics(value, 'order', []).receivedQuantity).toBeUndefined();
    value.transactions[2].quantity = 0; expect(businessStateIssue(value)).not.toBe('');
    value.transactions[2].quantity = 0.5; expect(businessStateIssue(value)).not.toBe('');
    value.transactions[2] = { ...value.transactions[2], quantity: 1, kind: 'fee' }; expect(businessStateIssue(value)).not.toBe('');
  });
  it('imports quantity aliases without inventing missing quantities and detects corrections as conflicts', () => {
    const value = state(), row = { 流水号: 'qty-1', 类型: '收入', 金额: '29.90', 数量: '3', 日期: '2026-11-08' };
    const parsed = normalizeBusinessRows('transactions', [row], { state: value, orderId: 'order', now: time });
    expect(parsed.issues).toEqual([]); expect(parsed.records[0]).toMatchObject({ quantity: 3 });
    value.transactions = parsed.records as BusinessState['transactions'];
    expect(normalizeBusinessRows('transactions', [{ ...row, 数量: '4' }], { state: value, orderId: 'order' }).conflicts).toHaveLength(1);
    expect(normalizeBusinessRows('transactions', [{ ...row, 流水号: 'qty-2', 类型: '退款', 数量: '' }], { state: value, orderId: 'order' }).records[0]).not.toHaveProperty('quantity');
    expect(normalizeBusinessRows('transactions', [{ ...row, 数量: '0.5' }], { state: value, orderId: 'order' }).issues).toHaveLength(1);
  });
});
