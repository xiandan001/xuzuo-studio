import { describe, expect, it } from 'vitest';
import type { QuoteFields } from './project-quotes';
import { calculateProjectQuote, customerQuoteText, quoteHundredths } from './quote-calculator';

const fields: QuoteFields = { minutes: '0', rate: '60', remaining: '0', other: '0', reserve: '0', fee: '6', profit: '50', price: '19.90', variable: '0' };
describe('三步报价计算', () => {
  it('实际API、时长、修改预留各计一次，售价扣除渠道费后达到目标利润', () => {
    const value = calculateProjectQuote({ ...fields, minutes: '30', other: '10', reserve: '5', remaining: '5' }, 5000, 'single');
    expect(value.laborCents).toBe(3000);
    expect(value.costCents).toBe(10000);
    expect(value.quote).toEqual({ breakEvenCents: 10639, recommendedCents: 15958, feeCents: 958, profitCents: 5000 });
  });
  it('留空按0处理，计算到分时保守舍入，数字不能为负数、指数或超过精度', () => {
    const value = calculateProjectQuote({ ...fields, minutes: '0.01', rate: '0.01', other: '', remaining: '', reserve: '' }, 0, 'single');
    expect(value.laborCents).toBe(1);
    expect(value.costCents).toBe(1);
    expect(quoteHundredths('  ', '金额')).toBe(0);
    for (const invalid of ['-1', '1e2', '0.001', 'Infinity', '99999999999999']) expect(() => quoteHundredths(invalid, '金额')).toThrow();
    expect(() => calculateProjectQuote({ ...fields, fee: '100' }, 0, 'single')).toThrow('小于 100%');
  });
  it('重复销售扣除每单渠道费和交付成本后再算回本份数，贡献不为正不宣称回本', () => {
    const repeat = calculateProjectQuote({ ...fields, variable: '1' }, 3600, 'repeat');
    expect(repeat.repeat).toEqual({ feeCents: 120, contributionCents: 1770, unitsNeeded: 3 });
    expect(calculateProjectQuote({ ...fields, variable: '20' }, 3600, 'repeat').repeat?.unitsNeeded).toBeNull();
  });
  it('对客文字仅包含项目与售价，内部成本与利润不会复制出去', () => {
    expect(customerQuoteText('品牌手册', 15958)).toBe('项目：品牌手册\n报价：¥159.58\n按当前需求报价，新增需求另行协商。');
  });
});
