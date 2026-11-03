import { describe, expect, it } from 'vitest';
import type { CostCalculation } from '../billing-types';
import type { LedgerEntry } from '../types';
import { addCostAmounts, amountToQuoteCents, costPrimary, costSecondary, costSummaryPrimary, costSummarySecondary, displayCost, formatCostAmount, runCostRecords, summarizeCosts } from './cost-display';
import type { WorkflowRun } from '../configuration-types';

const calculation: CostCalculation = { version: 1, ruleId: 'image-official', ruleVersion: '2026-10-30', nativeCurrency: 'USD', nativeAmount: '0.00603', cnyAmount: '0.043416', completeness: 'complete', basis: '实际文字输入与图片输出分别计费',
  fx: { base: 'USD', quote: 'CNY', rate: '7.2', date: '2026-10-29', source: '公共汇率测试样本', kind: 'reference' },
  components: [{ code: 'text-input', label: '文字输入', quantity: 30, unit: 'million-tokens', unitPrice: '5', amount: '0.00015', currency: 'USD' }, { code: 'image-output', label: '图片输出', quantity: 196, unit: 'million-tokens', unitPrice: '30', amount: '0.00588', currency: 'USD' }] };
const entry: LedgerEntry = { id: 'receipt-1', projectId: 'p', projectName: '测试', action: '初次生成', model: '图像型号', costCents: 5, time: '', status: 'complete', billingMode: 'live', costState: 'calculated', calculation };

describe('真实费用精确展示与汇总', () => {
  it('忽略兼容预算分值，展示完整原币与不足一分的人民币', () => {
    expect(costPrimary(entry)).toBe('$0.00603'); expect(costSecondary(entry)).toBe('≈¥0.043416');
    expect(displayCost(entry)).toMatchObject({ pending: false, missingFx: false, cnyAmount: '0.043416' });
    expect(formatCostAmount('0.00000321', 'CNY')).toBe('¥0.00000321');
    expect(formatCostAmount('0.00000000001', 'USD')).toBe('<$0.00000001');
  });
  it('先精确相加，再显示和一次取整用于报价，不逐笔向上取整', () => {
    const total = summarizeCosts([entry, { ...entry, id: 'receipt-2' }]);
    expect(total.usdAmount).toBe('0.01206'); expect(total.cnyAmount).toBe('0.086832');
    expect(total.quoteCents).toBe(9); expect(costSummaryPrimary(total)).toBe('$0.01206');
    expect(total.quoteCents).not.toBe(entry.costCents * 2);
    expect(addCostAmounts(['0.1', '0.2', '0.00000000000000000001'])).toBe('0.30000000000000000001');
    expect(amountToQuoteCents('0')).toBe(0); expect(amountToQuoteCents('0.01')).toBe(1);
  });
  it('保留后端汇率乘积的30位小数，汇总不截断且不误判缺少人民币换算', () => {
    const precise = { ...entry, calculation: { ...calculation, nativeAmount: '0.000000123456', cnyAmount: '0.000000879433481358025481342784', fx: { ...calculation.fx!, rate: '7.123456789123456789' } } };
    expect(displayCost(precise)).toMatchObject({ pending: false, missingFx: false, cnyAmount: '0.000000879433481358025481342784' });
    expect(costSecondary(precise)).toBe('≈¥0.00000088');
    const summary = summarizeCosts([precise, precise]);
    expect(summary.cnyAmount).toBe('0.000001758866962716050962685568');
    expect(summary.missingFxCount).toBe(0); expect(summary.quoteCents).toBe(1);
  });
  it('美元已知但缺汇率时保持原币可见，只阻止人民币报价', () => {
    const noFx = { ...entry, calculation: { ...calculation, cnyAmount: undefined, fx: undefined } };
    expect(costPrimary(noFx)).toBe('$0.00603'); expect(costSecondary(noFx)).toContain('美元费用已知');
    expect(displayCost(noFx)).toMatchObject({ pending: false, missingFx: true });
    expect(summarizeCosts([noFx])).toMatchObject({ usdAmount: '0.00603', missingFxCount: 1, pendingCount: 0 });
    expect(summarizeCosts([noFx]).quoteCents).toBeUndefined();
  });
  it('部分费用保留已知部分但不能给完整报价，未知不能显示为免费', () => {
    const partial = { ...entry, calculation: { ...calculation, completeness: 'partial' as const } };
    expect(costPrimary(partial)).toBe('$0.00603（部分）'); expect(summarizeCosts([partial]).quoteCents).toBeUndefined();
    const unknown = summarizeCosts([{ ...entry, calculation: undefined, costState: 'unknown' }]);
    expect(unknown.pendingCount).toBe(1); expect(unknown.quoteCents).toBeUndefined();
    expect(costPrimary({ ...entry, calculation: undefined, costState: 'unknown' })).toBe('计费依据待补齐');
  });
  it('部分费用同时展示精确原币、参考人民币和具体缺项，不暗示用户计算', () => {
    const partial = { ...entry, costState: 'unknown' as const, costReason: '缺少缓存写入 TTL，尚不能应用对应费率。', calculation: { ...calculation, completeness: 'partial' as const } };
    expect(costPrimary(partial)).toBe('$0.00603（部分）');
    expect(costSecondary(partial)).toBe('≈¥0.043416 · 计费依据待补齐：缺少缓存写入 TTL，尚不能应用对应费率。');
    expect(summarizeCosts([partial]).quoteCents).toBeUndefined();
    expect(costSummarySecondary(summarizeCosts([partial]))).toContain('1 笔计费依据待补齐');
    expect(costSecondary(partial)).not.toContain('自动核算中');
  });
  it('人民币汇率缺失不掩盖另一个待补齐原因，未知总额不会显示成零元', () => {
    const partial = { ...entry, costState: 'unknown' as const, costReason: '服务商未返回完整用量', calculation: { ...calculation, completeness: 'partial' as const, cnyAmount: undefined, fx: undefined } };
    expect(costSecondary(partial)).toContain('已知部分美元费用已保留');
    expect(costSecondary(partial)).toContain('人民币换算暂不可用');
    expect(costSecondary(partial)).toContain('服务商未返回完整用量');
    const unknown = summarizeCosts([{ ...entry, costState: 'unknown', calculation: undefined }]);
    expect(costSummaryPrimary(unknown)).toBe('计费依据待补齐');
    expect(unknown.quoteCents).toBeUndefined();
  });
  it('人工账单校正优先于旧自动凭据，旧 calculated 明确保留历史性质', () => {
    const manual = { ...entry, costState: 'manual' as const, costCents: 8 };
    expect(costPrimary(manual)).toBe('¥0.08'); expect(summarizeCosts([manual]).usdCount).toBe(0);
    expect(displayCost(manual).calculation).toBe(calculation);
    const legacy = { ...entry, calculation: undefined, costCents: 1 };
    expect(costPrimary(legacy)).toBe('¥0.01（历史记录）'); expect(summarizeCosts([legacy])).toMatchObject({ legacyCount: 1, quoteCents: 1, pendingCount: 0 });
    expect(costPrimary({ ...entry, costState: 'not-incurred' })).toBe('¥0.00');
  });
  it('混合美元与人民币分别汇总，运行记录不重复计入同一次尝试', () => {
    const cny = { ...entry, id: 'cn', calculation: { ...calculation, nativeCurrency: 'CNY' as const, nativeAmount: '0.02', cnyAmount: '0.02', fx: undefined } };
    expect(costSummaryPrimary(summarizeCosts([entry, cny]))).toBe('$0.00603 + ¥0.02');
    const run: WorkflowRun = { id: 'run', workspaceId: 'w', projectId: 'p', workflowId: 'flow', workflowName: 'flow', mode: 'live', status: 'complete', stepIndex: 2, snapshot: { id: 'flow', workspaceId: 'w', name: 'flow', description: '', outputKind: 'image', updatedAt: '', steps: [{ id: 'step', name: '生成', kind: 'image-generation', enabled: true, prompt: '', inputSource: 'project' }, { id: 'human', name: '检查', kind: 'manual-review', enabled: true, prompt: '', inputSource: 'project' }] }, attempts: [{ id: 'attempt', stepId: 'step', stepName: '生成', modelLabel: '', status: 'complete', costCents: 5, summary: '', input: '', prompt: '', action: '初次生成', calculation }, { id: 'human-a', stepId: 'human', stepName: '检查', modelLabel: '', status: 'complete', costCents: 0, summary: '', input: '', prompt: '', action: 'AI 复核' }], variables: {}, input: '', createdAt: '', updatedAt: '' };
    const records = runCostRecords(run, [{ ...entry, workflowRunId: 'run', workflowAttemptId: 'attempt' }]);
    expect(records).toHaveLength(1); expect(summarizeCosts(records).usdAmount).toBe('0.00603');
  });
});
