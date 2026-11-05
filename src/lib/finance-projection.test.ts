import { describe, expect, it } from 'vitest';
import { financeMonth, financeProjection } from './finance-projection';
import { summarizeCosts } from './cost-display';
import { monthlyEntries } from './studio-time';
import type { LedgerEntry } from '../types';
const row = (id: string, time = '2026-11-04T00:00:00Z'): LedgerEntry => ({ id, projectId: 'project', projectName: 'Project', action: 'AI 精修', model: 'owned', costCents: 137, billingMode: 'live', costState: 'manual', status: 'complete', time });
describe('费用页按不可变账本复用汇总', () => {
  it('同份账本跨页面重用精确汇总，真实与模拟分开，原始行不变', () => {
    const ledger = [row('real'), { ...row('demo'), billingMode: undefined }], before = JSON.stringify(ledger);
    const view = financeProjection(ledger);
    expect(financeProjection(ledger)).toBe(view);
    expect(view.realSummary).toEqual(summarizeCosts([ledger[0]])); expect(view.simulationSummary).toEqual(summarizeCosts([ledger[1]]));
    expect(view.real[0]).toBe(ledger[0]); expect(JSON.stringify(ledger)).toBe(before);
  });
  it('新费、更正、移除条目均通过新数组重新计算，不复用旧金额', () => {
    const original = [row('one')], old = financeProjection(original);
    const changed = [{ ...original[0], costCents: 234 }, row('two')];
    expect(financeProjection(changed)).not.toBe(old); expect(financeProjection(changed).realSummary).toEqual(summarizeCosts(changed));
    expect(financeProjection([]).realSummary.count).toBe(0); expect(financeProjection(original)).toBe(old);
  });
  it('按上海月份换月重算，不将时间不明条目冒充当月，其他输入不触发重算', () => {
    const ledger = [row('november'), row('october', '2026-10-15T00:00:00Z'), row('unknown', '今天 14:00')], nov = Date.parse('2026-11-04T00:00:00Z');
    const month = financeMonth(ledger, nov);
    expect(financeMonth(ledger, nov + 60000)).toBe(month); expect(month.entries).toEqual(monthlyEntries(ledger, nov));
    const oct = financeMonth(ledger, Date.parse('2026-10-20T00:00:00Z')); expect(oct).not.toBe(month); expect(oct.summary).toEqual(summarizeCosts([ledger[1]]));
    expect(oct.entries.unassigned.map(entry => entry.time)).toEqual(['今天 14:00']);
  });
});
