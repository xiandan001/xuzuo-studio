import type { Preferences } from '../types';
import { parseOptionalBudget } from '../data';
import { quoteHundredths } from './quote-calculator';

export function settingsPreferenceError(draft: Preferences): string {
  if (!draft.studioName.trim() || draft.studioName.trim().length > 30) return '工作区名称需为 1–30 个字。';
  try {
    for (const [label, value] of [['人工时薪', draft.hourlyRate], ['目标利润', draft.targetProfit], ['渠道费率', draft.channelFeePercent]] as const) {
      if (!Number.isFinite(value) || value < 0) return `请填写有效的${label}。`;
      quoteHundredths(String(value), label);
    }
    if (draft.channelFeePercent >= 100) return '渠道费率应小于 100%。';
    if (draft.monthlyBudget != null) parseOptionalBudget(String(draft.monthlyBudget));
    return '';
  } catch (cause) { return cause instanceof Error ? cause.message : '请检查金额与费率。'; }
}
