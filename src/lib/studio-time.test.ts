import { describe, expect, it } from 'vitest';
import { explicitTimestamp, monthlyEntries, projectTimeLabel, recentProjects, shanghaiMonth } from './studio-time';
import { summarizeCosts } from './cost-display';
import type { LedgerEntry } from '../types';

describe('北京时间月份与可靠更新时间', () => {
  it('北京时间月界、跨年和闰日按明确时区解析，旧相对时间不猜年份', () => {
    expect(shanghaiMonth(Date.parse('2026-10-31T15:59:59Z'))).toBe('2026-10');
    expect(shanghaiMonth(Date.parse('2026-10-31T16:00:00Z'))).toBe('2026-11');
    expect(shanghaiMonth(Date.parse('2026-12-31T16:00:00Z'))).toBe('2027-01');
    expect(explicitTimestamp('2024-02-29T00:00:00+08:00')).toBeDefined();
    for (const time of ['今天 10:30', '昨天 16:40', '10月27日', '2026/10/30 12:00:00', '2026-02-30T00:00:00Z', '2026-13-01T00:00:00Z', '']) expect(explicitTimestamp(time), time).toBeUndefined();
  });
  it('月统计保留取消后的费用、未知计费与缺汇率，不改账本、不纳入其他月份', () => {
    const base: LedgerEntry = { id: 'old', projectId: 'p', projectName: '独立测试', action: '初次生成', model: '元数据', billingMode: 'live', costState: 'manual', costCents: 5000, time: '2026-10-15T00:00:00Z', status: 'complete' };
    const entries = [base, { ...base, id: 'current', costCents: 200, time: '2026-10-31T16:00:00Z' }, { ...base, id: 'cancelled', costCents: 35, status: 'cancelled' as const, time: '2026-11-02T00:00:00+08:00' }, { ...base, id: 'unknown', costState: 'unknown' as const, costCents: 0, time: '2026-11-03T00:00:00Z' }, { ...base, id: 'relative', time: '今天 12:30' }];
    const original = JSON.stringify(entries), monthly = monthlyEntries(entries, Date.parse('2026-11-01T00:00:00+08:00'));
    expect(monthly.current.map(entry => entry.id)).toEqual(['current', 'cancelled', 'unknown']);
    expect(monthly.unassigned.map(entry => entry.id)).toEqual(['relative']);
    expect(summarizeCosts(monthly.current)).toMatchObject({ cnyAmount: '2.35', pendingCount: 1 });
    expect(JSON.stringify(entries)).toBe(original);
  });
  it('美元已知但无人民币汇率仍留在本月，不用零元冒充完整预算', () => {
    const usd: LedgerEntry = { id: 'usd', projectId: 'p', projectName: '本月美元记录', action: '初次生成', model: '元数据', billingMode: 'live', costState: 'calculated', costCents: 0, time: '2026-11-01T00:00:00Z', status: 'cancelled', calculation: { version: 1, ruleId: 'fixture', ruleVersion: 'fixture', nativeCurrency: 'USD', nativeAmount: '0.123456', basis: '隔离测试', completeness: 'complete', components: [] } };
    const month = monthlyEntries([usd], Date.parse('2026-11-01T00:00:00Z'));
    expect(summarizeCosts(month.current)).toMatchObject({ usdAmount: '0.123456', missingFxCount: 1 });
    expect(summarizeCosts(month.current).quoteCents).toBeUndefined();
  });
  it('真实ISO项目按最新排前，旧时间稳定排后，排序不变造历史', () => {
    const projects = [{ id: 'legacy-first', updatedAt: '昨天 10:00' }, { id: 'old', updatedAt: '2026-10-30T10:00:00Z' }, { id: 'recent', updatedAt: '2026-11-01T09:00:00Z' }, { id: 'legacy-last', updatedAt: '今天 12:00' }];
    const before = JSON.stringify(projects);
    expect(recentProjects(projects).map(project => project.id)).toEqual(['recent', 'old', 'legacy-first', 'legacy-last']);
    expect(JSON.stringify(projects)).toBe(before);
    expect(projectTimeLabel('今天 12:00')).toBe('历史时间未明确');
    expect(projectTimeLabel('2026-10-31T16:01:00Z')).toContain('2026/11/1');
  });
});
