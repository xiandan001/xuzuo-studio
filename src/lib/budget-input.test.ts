import { describe, expect, it } from 'vitest';
import { INITIAL_PREFERENCES, budgetLabel, budgetPercent, parseOptionalBudget } from '../data';

describe('可选金额上限输入与展示', () => {
  it('留空表示不设上限，不转换成零元', () => {
    expect(parseOptionalBudget('')).toBeUndefined();
    expect(parseOptionalBudget('  ')).toBeUndefined();
    expect(INITIAL_PREFERENCES.monthlyBudget).toBeUndefined();
  });
  it('保留明确的零上限和精确到分的已填金额', () => {
    expect(parseOptionalBudget('0')).toBe(0);
    expect(parseOptionalBudget('0.00')).toBe(0);
    expect(parseOptionalBudget('0.07')).toBe(7);
    expect(parseOptionalBudget('5.00')).toBe(500);
  });
  it.each(['-1', 'NaN', 'Infinity', '1e3', '1.001', '9007199254740992'])('拒绝无效或不精确的金额 %s', value => {
    expect(() => parseOptionalBudget(value)).toThrow();
  });
  it('未设上限与零元上限使用不同标签', () => {
    expect(budgetLabel(undefined)).toBe('未设上限');
    expect(budgetLabel(null)).toBe('未设上限');
    expect(budgetLabel(0)).toBe('¥0.00');
    expect(budgetLabel(500)).toBe('¥5.00');
  });
  it('无上限不生成百分比，零上限不发生除零', () => {
    expect(budgetPercent(7, undefined)).toBeUndefined();
    expect(budgetPercent(7, null)).toBeUndefined();
    expect(budgetPercent(0, 0)).toBe(0);
    expect(budgetPercent(7, 0)).toBe(100);
    expect(budgetPercent(7, 500)).toBeCloseTo(1.4);
  });
});
