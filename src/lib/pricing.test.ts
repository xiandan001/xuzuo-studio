import { describe, expect, it } from 'vitest';
import { computeBreakEven, computeQuote } from './pricing';

describe('按单报价：整数分与基点', () => {
  it('成本50元、抽成10%、目标利润20元时向上取分', () => {
    expect(computeQuote({ costCents: 5000, feeBasisPoints: 1000, targetProfitCents: 2000 })).toEqual({
      breakEvenCents: 5556,
      recommendedCents: 7778,
      feeCents: 778,
      profitCents: 2000,
    });
  });

  it('没有渠道费用时不会增加隐藏加价', () => {
    expect(computeQuote({ costCents: 1286, feeBasisPoints: 0, targetProfitCents: 500 }).recommendedCents).toBe(1786);
  });

  it('正确处理零成本和零目标利润', () => {
    expect(computeQuote({ costCents: 0, feeBasisPoints: 1000, targetProfitCents: 0 })).toEqual({
      breakEvenCents: 0, recommendedCents: 0, feeCents: 0, profitCents: 0,
    });
  });

  it('小额报价仍覆盖按分向上收取的渠道费用', () => {
    expect(computeQuote({ costCents: 1, feeBasisPoints: 1, targetProfitCents: 0 })).toEqual({
      breakEvenCents: 2, recommendedCents: 2, feeCents: 1, profitCents: 0,
    });
  });

  it('拒绝100%费率、负数和非整数分', () => {
    expect(() => computeQuote({ costCents: 100, feeBasisPoints: 10000, targetProfitCents: 0 })).toThrow('小于 100%');
    expect(() => computeQuote({ costCents: -1, feeBasisPoints: 0, targetProfitCents: 0 })).toThrow();
    expect(() => computeQuote({ costCents: 0.5, feeBasisPoints: 0, targetProfitCents: 0 })).toThrow();
  });
});

describe('数字成品回本：销量假设不等于销售预测', () => {
  it('制作30元、定价9.9元、抽成13%需要4份覆盖制作成本', () => {
    expect(computeBreakEven({ productionCostCents: 3000, salePriceCents: 990, variableCostCents: 0, feeBasisPoints: 1300 })).toEqual({
      feeCents: 129, contributionCents: 861, unitsNeeded: 4,
    });
  });

  it('零售价或单份贡献不为正时不伪造可回本数量', () => {
    expect(computeBreakEven({ productionCostCents: 3000, salePriceCents: 0, variableCostCents: 0, feeBasisPoints: 0 }).unitsNeeded).toBeNull();
    expect(computeBreakEven({ productionCostCents: 3000, salePriceCents: 100, variableCostCents: 100, feeBasisPoints: 0 }).unitsNeeded).toBeNull();
    expect(computeBreakEven({ productionCostCents: 3000, salePriceCents: 100, variableCostCents: 200, feeBasisPoints: 0 }).contributionCents).toBe(-100);
  });

  it('零制作成本、正贡献对应0份待回收成本', () => {
    expect(computeBreakEven({ productionCostCents: 0, salePriceCents: 500, variableCostCents: 0, feeBasisPoints: 0 }).unitsNeeded).toBe(0);
  });

  it('拒绝无效费率和负数售价', () => {
    expect(() => computeBreakEven({ productionCostCents: 3000, salePriceCents: -1, variableCostCents: 0, feeBasisPoints: 0 })).toThrow();
    expect(() => computeBreakEven({ productionCostCents: 3000, salePriceCents: 990, variableCostCents: 0, feeBasisPoints: 10000 })).toThrow();
  });
});
