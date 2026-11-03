export interface QuoteInput {
  costCents: number;
  feeBasisPoints: number;
  targetProfitCents: number;
}

export interface QuoteResult {
  breakEvenCents: number;
  recommendedCents: number;
  feeCents: number;
  profitCents: number;
}

export interface BreakEvenInput {
  productionCostCents: number;
  salePriceCents: number;
  variableCostCents: number;
  feeBasisPoints: number;
}

export interface BreakEvenResult {
  feeCents: number;
  contributionCents: number;
  unitsNeeded: number | null;
}

const BASIS = 10_000n;

function nonNegativeInteger(value: number, name: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name}必须是非负整数`);
  }
  return BigInt(value);
}

function feeRate(value: number): bigint {
  const rate = nonNegativeInteger(value, '渠道费率');
  if (rate >= BASIS) throw new RangeError('渠道费率必须小于 100%');
  return rate;
}

function ceilingDivide(value: bigint, divisor: bigint): bigint {
  return (value + divisor - 1n) / divisor;
}

function safeNumber(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new RangeError('金额超出可计算范围');
  return result;
}

/** 金额以分存储；费率以基点存储。渠道费用保守地向上取分。 */
export function computeQuote(input: QuoteInput): QuoteResult {
  const cost = nonNegativeInteger(input.costCents, '成本');
  const profit = nonNegativeInteger(input.targetProfitCents, '目标利润');
  const rate = feeRate(input.feeBasisPoints);
  const breakEven = ceilingDivide(cost * BASIS, BASIS - rate);
  const recommended = ceilingDivide((cost + profit) * BASIS, BASIS - rate);
  const fee = ceilingDivide(recommended * rate, BASIS);
  return {
    breakEvenCents: safeNumber(breakEven),
    recommendedCents: safeNumber(recommended),
    feeCents: safeNumber(fee),
    profitCents: safeNumber(recommended - fee - cost),
  };
}

export function computeBreakEven(input: BreakEvenInput): BreakEvenResult {
  const production = nonNegativeInteger(input.productionCostCents, '制作成本');
  const price = nonNegativeInteger(input.salePriceCents, '假设售价');
  const variable = nonNegativeInteger(input.variableCostCents, '每单交付成本');
  const rate = feeRate(input.feeBasisPoints);
  const fee = ceilingDivide(price * rate, BASIS);
  const contribution = price - fee - variable;
  return {
    feeCents: safeNumber(fee),
    contributionCents: safeNumber(contribution),
    unitsNeeded: contribution > 0n ? safeNumber(ceilingDivide(production, contribution)) : null,
  };
}
