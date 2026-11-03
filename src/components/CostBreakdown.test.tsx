import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { LedgerEntry } from '../types';
import { CostBreakdown } from './CostBreakdown';

const entry: LedgerEntry = { id: 'cost', projectId: 'p', projectName: 'p', action: '初次生成', model: '图片模型', costCents: 5, billingMode: 'live', costState: 'calculated', status: 'complete', time: '', calculation: { version: 1, ruleId: 'official-image', ruleVersion: '2026-10-30', nativeCurrency: 'USD', nativeAmount: '0.00603', cnyAmount: '0.043416', completeness: 'complete', basis: '30 × $5/M + 196 × $30/M', components: [{ code: 'text-input', label: '文字输入', quantity: 30, unit: 'million-tokens', unitPrice: '5', amount: '0.00015', currency: 'USD' }, { code: 'image-output', label: '图片输出', quantity: 196, unit: 'million-tokens', unitPrice: '30', amount: '0.00588', currency: 'USD' }], fx: { base: 'USD', quote: 'CNY', rate: '7.2', date: '2026-10-29', source: '公共参考汇率来源', kind: 'reference' } } };
describe('只读自动费用明细', () => {
  it('展示真实用量、每百万单价、原币及汇率日期来源，不要求填写金额', () => {
    const html = renderToStaticMarkup(<CostBreakdown entry={entry} />);
    for (const value of ['$0.00603', '≈¥0.043416', '文字输入', '30', 'Token', '$5.00', '百万 Token', '$0.00015', '2026-10-29', '公共参考汇率来源', 'official-image']) expect(html).toContain(value);
    expect(html).not.toContain('<input'); expect(html).not.toContain('<form'); expect(html).not.toContain('请先对照供应商账单');
  });
  it('缺少汇率仍显示已知美元，人工校正说明原始自动凭据用途', () => {
    const noFx = renderToStaticMarkup(<CostBreakdown entry={{ ...entry, calculation: { ...entry.calculation!, cnyAmount: undefined, fx: undefined } }} />);
    expect(noFx).toContain('$0.00603'); expect(noFx).toContain('美元费用已经计算'); expect(noFx).not.toContain('≈¥');
    const manual = renderToStaticMarkup(<CostBreakdown entry={{ ...entry, costState: 'manual', costCents: 8 }} />);
    expect(manual).toContain('¥0.08'); expect(manual).toContain('仅保留为原始记录');
  });
  it('未知记录直接展示后端具体缺项，避免要求用户逐次查价填金额', () => {
    const html = renderToStaticMarkup(<CostBreakdown entry={{ ...entry, calculation: undefined, costState: 'unknown', costReason: '旧版图片编辑缺少图片输入 Token 拆分，不能推断为文字输入。' }} />);
    expect(html).toContain('旧版图片编辑缺少图片输入 Token 拆分'); expect(html).not.toContain('<input');
  });
});
