import { computeBreakEven, computeQuote } from './pricing';
import type { QuoteFields, QuoteMode } from './project-quotes';

export function quoteHundredths(value: string, label: string): number {
  const text = value.trim() || '0';
  if (!/^\d+(?:\.\d{0,2})?$/.test(text)) throw new Error(`请填写有效的${label}，最多保留两位小数`);
  const [whole, fraction = ''] = text.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(amount) || amount > 1_000_000_000) throw new Error(`${label}超出可计算范围`);
  return amount;
}

export function calculateProjectQuote(fields: QuoteFields, apiCostCents: number, mode: QuoteMode) {
  const minutes = quoteHundredths(fields.minutes, '制作时长');
  const rate = quoteHundredths(fields.rate, '人工时薪');
  const laborCents = Number((BigInt(minutes) * BigInt(rate) + 5999n) / 6000n);
  const otherCents = quoteHundredths(fields.other, '其他制作成本');
  const reserveCents = quoteHundredths(fields.reserve, '返工预留');
  const remainingCents = quoteHundredths(fields.remaining, '预计后续生成费');
  const feeBasisPoints = quoteHundredths(fields.fee, '渠道费用比例');
  const profitCents = mode === 'single' ? quoteHundredths(fields.profit, '目标利润') : 0;
  const costCents = apiCostCents + laborCents + otherCents + reserveCents + remainingCents;
  const quote = computeQuote({ costCents, feeBasisPoints, targetProfitCents: profitCents });
  const repeat = mode === 'repeat' ? computeBreakEven({ productionCostCents: costCents, salePriceCents: quoteHundredths(fields.price, '假设单份售价'), variableCostCents: quoteHundredths(fields.variable, '每单交付成本'), feeBasisPoints }) : undefined;
  return { laborCents, otherCents, reserveCents, remainingCents, feeBasisPoints, costCents, quote, repeat };
}

export function customerQuoteText(project: string, priceCents: number): string {
  return `项目：${project}\n报价：¥${(priceCents / 100).toFixed(2)}\n按当前需求报价，新增需求另行协商。`;
}
