const count = value => Number.isSafeInteger(value) && value >= 0;

// The default SVG author is only known after the response. Freeze eligible rates
// with the image request rather than resolving historical usage at today's price.
function freezeSvgAuthorRules(rules, startedAt) {
  const date = startedAt.slice(0, 10);
  return structuredClone(rules.filter(rule => rule.providerId === 'openai' && rule.scheme === 'tokens' && rule.currency === 'USD' && rule.operations?.includes('text') && rule.allowedHosts?.includes('api.openai.com') && (rule.validFrom || rule.verifiedAt) <= date));
}

function addSvgComponents(bill, snapshot, usage, { selectedRates, tokenComponents }) {
  if (usage.imageOutputFormat !== 'svg' && usage.svgUsage === undefined) return;
  if (!snapshot.rule.svgAuthorBilling) throw new Error('此图片型号的SVG作者计费尚未核实，已保留可核算的图片费用。');
  const author = usage.svgUsage;
  if (!author || typeof author !== 'object' || !count(author.inputTokens) || !count(author.outputTokens) || typeof author.model !== 'string') throw new Error('SVG参考图片费用已核算；供应商未返回完整作者模型与Token用量，总费用暂不完整。');
  if (author.totalTokens !== undefined && (!count(author.totalTokens) || author.totalTokens !== author.inputTokens + author.outputTokens)) throw new Error('SVG作者Token明细与总量不一致，已保留参考图片费用。');
  if (author.reasoningTokens !== undefined && (!count(author.reasoningTokens) || author.reasoningTokens > author.outputTokens)) throw new Error('SVG作者思考Token与输出总量不一致，已保留参考图片费用。');
  const rule = snapshot.svgAuthorRules?.find(item => item.modelId === author.model && item.providerId === 'openai' && item.scheme === 'tokens' && item.currency === snapshot.rule.currency);
  if (!rule) throw new Error(`SVG参考图片费用已核算；作者模型${author.model}的冻结官方费率尚未核实，总费用暂不完整。`);
  const selected = selectedRates(rule, author, snapshot.startedAt);
  const prefixed = { add: (code, label, quantity, price, unit) => bill.add(`svg-${code}`, `SVG作者 ${author.model} · ${label}`, quantity, price, unit) };
  tokenComponents(prefixed, rule, author, selected.rates);
  snapshot.rule.basis += ` SVG作者${author.model}按冻结规则${rule.id}/${rule.version}核算；输出已含思考Token。${selected.basis}`;
}

module.exports = { freezeSvgAuthorRules, addSvgComponents };
