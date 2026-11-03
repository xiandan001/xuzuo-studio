import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { ModelPricing } from '../configuration-types';

interface Cost { costCents: number; costState: string; reason: string; }
const require = createRequire(import.meta.url);
const { calculateCost, estimateCost } = require('../../electron/live-cost.cjs') as {
  calculateCost: (pricing?: unknown, usage?: Record<string, number>) => Cost;
  estimateCost: (model: { pricing?: ModelPricing }, step: { kind: string; count?: number; maxOutputTokens?: number }, text?: string) => Cost;
};
const tokenPricing: ModelPricing = { unit: 'million-tokens', currency: 'CNY', input: '1', output: '2' };

describe('官方参考价不冒充实际核算价', () => {
  it('输入输出价格与用量都完整时，参考标记仍使金额保持待核对', () => {
    const cost = calculateCost({ ...tokenPricing, referenceOnly: true, referenceNote: '包含长上下文阶梯计价' }, { inputTokens: 1000000, outputTokens: 1000000 });
    expect(cost).toMatchObject({ costCents: 0, costState: 'unknown' });
    expect(cost.reason).toContain('长上下文阶梯');
    expect(cost.costState).not.toBe('not-incurred');
  });

  it.each(['image', 'second', 'request'] as const)('%s 参考价即使填入数值也不直接计为已知费用', unit => {
    expect(calculateCost({ unit, currency: 'CNY', input: '1', output: '2', referenceOnly: true }, { images: 2, seconds: 3 })).toMatchObject({ costCents: 0, costState: 'unknown' });
  });

  it('费用预估同样沿用参考状态，包括图片和零单价', () => {
    expect(estimateCost({ pricing: { ...tokenPricing, referenceOnly: true } }, { kind: 'text', maxOutputTokens: 1000 }, '内容')).toMatchObject({ costState: 'unknown' });
    expect(estimateCost({ pricing: { unit: 'image', currency: 'CNY', input: '', output: '0', referenceOnly: true } }, { kind: 'image-generation', count: 2 })).toMatchObject({ costCents: 0, costState: 'unknown' });
  });

  it('旧手动单价与明确关闭参考标记的配置保持原核算结果', () => {
    const usage = { inputTokens: 1000000, outputTokens: 1000000 };
    expect(calculateCost(tokenPricing, usage)).toMatchObject({ costCents: 300, costState: 'calculated' });
    expect(calculateCost({ ...tokenPricing, referenceOnly: false }, usage)).toEqual(calculateCost(tokenPricing, usage));
    expect(calculateCost({ unit: 'million-tokens', currency: 'USD', input: '2', output: '8', exchangeRate: '7.2' }, { inputTokens: 1000, outputTokens: 500 })).toMatchObject({ costCents: 5, costState: 'calculated' });
  });

  it('缺少价格、用量或汇率继续待核对，非法参考标记保守处理', () => {
    expect(calculateCost(undefined, {})).toMatchObject({ costState: 'unknown' });
    expect(calculateCost(tokenPricing, {})).toMatchObject({ costState: 'unknown' });
    expect(calculateCost({ ...tokenPricing, input: '', output: '' }, { inputTokens: 1, outputTokens: 1 })).toMatchObject({ costCents: 0, costState: 'unknown' });
    expect(calculateCost({ ...tokenPricing, input: '', output: '' }, { inputTokens: 0, outputTokens: 0 })).toMatchObject({ costCents: 0, costState: 'unknown' });
    const usd = calculateCost({ ...tokenPricing, currency: 'USD' }, { inputTokens: 1, outputTokens: 1 });
    expect(usd).toMatchObject({ costState: 'calculated', costCents: 0 });
    expect(usd.reason).toContain('人民币金额待换算');
    expect(calculateCost({ ...tokenPricing, referenceOnly: 'true' }, { inputTokens: 1000000, outputTokens: 1000000 })).toMatchObject({ costState: 'unknown' });
  });
});
