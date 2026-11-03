const { resolveOfficialBillingRule, calculateOfficialCost, calculateManualCost } = require('./official-billing.cjs');

function calculateCost(pricing, usage = {}, context = {}) {
  const official = calculateOfficialCost(pricing, usage, context);
  if (official) return official;
  const unknown = reason => ({ costCents: 0, costState: 'unknown', reason });
  if (context.ruleSnapshot) return unknown('已保存的官方计费规则快照与本次模型、连接或操作不匹配，未改用手动单价重算。');
  if (!pricing) return unknown('未设置模型价格。');
  if (pricing.officialUrl || pricing.verifiedAt) return unknown('官方价目尚未匹配适用于本次模型、连接和调用日期的完整规则，未改用手动平价核算；显式手动核算需清除官方价目认证。');
  if (pricing.referenceOnly !== undefined && pricing.referenceOnly !== false) return unknown(typeof pricing.referenceNote === 'string' && pricing.referenceNote.trim() ? '当前为参考价：' + pricing.referenceNote.trim().slice(0, 2000) + '；暂未匹配可自动核算的完整官方规则。' : '当前价格仅作参考，暂未匹配可自动核算的完整官方规则。');
  if ([pricing.input, pricing.output].every(value => typeof value !== 'string' || !value.trim())) return unknown('模型单价尚未填写，请先核对价格。');
  return calculateManualCost(pricing, usage, context);
}

function estimateCost(model, step, text = '', context = {}) {
  const resolved = resolveOfficialBillingRule(context, model?.pricing);
  if (resolved && resolved.rule.scheme === 'direct-image-tokens') return { costCents: 0, costState: 'unknown', reason: '已匹配官方图片计费规则；图片生成后按供应商返回的文字输入、图片输入和图片输出Token自动核算总费用。' };
  if (!resolved && model?.pricing?.referenceOnly !== undefined && model.pricing.referenceOnly !== false) return calculateCost(model.pricing);
  if (model?.pricing?.unit === 'million-tokens' && step.kind !== 'text') return { costCents: 0, costState: 'unknown', reason: '多模态Token用量需要供应商返回后自动核算。' };
  const usage = { inputTokens: Math.max(1, text.length * 2 + 256), outputTokens: step.maxOutputTokens || 2048, images: step.count || 1 };
  return calculateCost(model?.pricing, usage, { ...context, ...(resolved ? { ruleSnapshot: resolved } : {}) });
}

module.exports = { calculateCost, estimateCost };
