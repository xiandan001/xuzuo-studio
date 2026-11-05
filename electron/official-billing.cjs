const registry = require('./billing-rules.json');
const { freezeSvgAuthorRules, addSvgComponents } = require('./svg-billing.cjs');
const clone = value => JSON.parse(JSON.stringify(value));
const unknown = reason => ({ costCents: 0, costState: 'unknown', reason });
const count = value => Number.isSafeInteger(value) && value >= 0;
const normalizePath = value => value.replace(/\/+$/, '') || '/';

// Decimal pairs retain every digit in native charges and the frozen FX rate.
function decimal(value) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,18})?$/.test(value.trim()) || value.length > 80) return null;
  const [whole, fraction = ''] = value.trim().split('.');
  return { n: BigInt(whole + fraction), s: fraction.length };
}
function add(a, b) { const s = Math.max(a.s, b.s); return { n: a.n * 10n ** BigInt(s - a.s) + b.n * 10n ** BigInt(s - b.s), s }; }
function multiply(a, b) { return { n: a.n * b.n, s: a.s + b.s }; }
function format(a) {
  if (!a.s) return String(a.n);
  const raw = String(a.n).padStart(a.s + 1, '0');
  return `${raw.slice(0, -a.s)}.${raw.slice(-a.s)}`.replace(/\.?0+$/, '');
}
function rateMultiply(value, factor) { return format(multiply(decimal(value), decimal(factor))); }
function cleanUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash ? u : null; } catch { return null; }
}
function matchesConnection(rule, connection) {
  if (!connection || connection.demo || connection.enabled === false || connection.providerId !== rule.providerId || !rule.protocols.includes(connection.protocol)) return false;
  const url = cleanUrl(connection.baseUrl);
  return !!url && url.port === rule.port && rule.allowedHosts.some(host => host.startsWith('*.') ? url.hostname.endsWith(host.slice(1)) && url.hostname !== host.slice(2) : url.hostname === host) && rule.allowedPaths.some(p => normalizePath(p) === normalizePath(url.pathname));
}
function matchesPricing(rule, pricing) {
  return !!pricing && pricing.officialUrl === rule.officialUrl && pricing.verifiedAt === rule.verifiedAt && Object.entries(rule.expectedPricing).every(([k, v]) => pricing[k] === v);
}
function validDate(value) { return typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value; }
function validTime(value) { return typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && validDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value)); }
function ruleCoversTime(rule, startedAt) {
  const from = rule.validFrom || rule.verifiedAt;
  if (!validDate(from)) return false;
  return new Date(startedAt).toISOString().slice(0, 10) >= from;
}

/** Freeze this JSON-safe value before sending a request; store it with its usage. */
function resolveOfficialBillingRule(context = {}, pricing) {
  const saved = context.ruleSnapshot;
  if (saved) {
    if (saved.version !== 1 || !saved.rule || saved.rule.id !== saved.ruleId || saved.rule.version !== saved.ruleVersion || saved.modelId !== saved.rule.modelId || !validTime(saved.startedAt) || !Array.isArray(saved.rule.protocols) || !Array.isArray(saved.rule.allowedHosts) || !Array.isArray(saved.rule.allowedPaths)) return null;
    if (context.modelId && context.modelId !== saved.modelId) return null;
    if (context.connection && !matchesConnection(saved.rule, context.connection)) return null;
    if (context.operation && context.operation !== saved.operation) return null;
    if (!ruleCoversTime(saved.rule, saved.startedAt)) return null;
    return clone(saved);
  }
  const rule = registry.rules.find(r => r.modelId === context.modelId && matchesConnection(r, context.connection) && matchesPricing(r, pricing));
  if (!rule) return null;
  const startedAt = context.startedAt === undefined ? new Date().toISOString() : context.startedAt;
  if (!validTime(startedAt)) return null;
  if (!ruleCoversTime(rule, startedAt)) return null;
  const operation = context.operation || 'text';
  return { version: 1, ruleId: rule.id, ruleVersion: rule.version, modelId: rule.modelId, operation, startedAt, rule: clone(rule), ...(rule.svgAuthorBilling ? { svgAuthorRules: freezeSvgAuthorRules(registry.rules, startedAt) } : {}) };
}

function validatedFx(fx, pricing, date) {
  const value = decimal(pricing?.exchangeRate);
  const user = value && value.n > 0n ? { base: 'USD', quote: 'CNY', rate: format(value), date: date.slice(0, 10), source: '用户填写的换算汇率', kind: 'user' } : null;
  if (user) return user;
  if (fx && fx.base === 'USD' && fx.quote === 'CNY' && ['reference', 'user'].includes(fx.kind) && /^\d{4}-\d\d-\d\d$/.test(fx.date) && typeof fx.source === 'string' && fx.source.length <= 2048) {
    const value = decimal(fx.rate);
    if (value && value.n > 0n) return { base: 'USD', quote: 'CNY', rate: format(value), date: fx.date, source: fx.source, kind: fx.kind };
  }
  return user;
}
function receipt(snapshot, pricing, context) {
  const rule = snapshot.rule;
  const calculation = { version: 1, ruleId: snapshot.ruleId, ruleVersion: snapshot.ruleVersion, nativeCurrency: rule.currency, nativeAmount: '0', components: [], basis: rule.basis, completeness: 'partial' };
  let total = { n: 0n, s: 0 };
  return {
    add(code, label, quantity, unitPrice, unit = 'million-tokens') {
      const quantityValue = unit === 'million-tokens' ? (count(quantity) ? { n: BigInt(quantity), s: 0 } : null) : typeof quantity === 'number' && Number.isFinite(quantity) && quantity >= 0 ? decimal(quantity.toFixed(6)) : null;
      if (!quantityValue) throw new Error('供应商未返回完整、有效的计费用量。');
      const price = decimal(unitPrice);
      if (!price) throw new Error('该用量项目的官方单价尚未核实。');
      const amount = { n: price.n * quantityValue.n, s: price.s + quantityValue.s + (unit === 'million-tokens' ? 6 : 0) };
      total = add(total, amount);
      calculation.components.push({ code, label, quantity, unit, unitPrice: format(price), amount: format(amount), currency: rule.currency });
    },
    finish(reason, complete = true) {
      calculation.nativeAmount = format(total);
      calculation.basis = rule.basis;
      calculation.completeness = complete ? 'complete' : 'partial';
      const fx = rule.currency === 'USD' ? validatedFx(context.fx, pricing, snapshot.startedAt) : null;
      const cny = rule.currency === 'CNY' ? total : fx ? multiply(total, decimal(fx.rate)) : null;
      if (fx) calculation.fx = fx;
      if (cny) calculation.cnyAmount = format(cny);
      if (!complete) return { ...unknown(reason), calculation };
      let cents = 0n;
      if (cny) { const divisor = 10n ** BigInt(cny.s); cents = (cny.n * 100n + divisor - 1n) / divisor; }
      if (cents > BigInt(Number.MAX_SAFE_INTEGER)) return { ...unknown('费用超过可核算范围。'), calculation: { ...calculation, completeness: 'partial' } };
      return { costCents: Number(cents), costState: 'calculated', reason: reason + (rule.currency === 'USD' && !fx ? ' 美元费用已核算，尚无人民币汇率，人民币金额待换算。' : ''), calculation };
    },
  };
}

function selectedRates(rule, usage, time) {
  let rates = { ...rule.rates };
  let basis = '';
  if (rule.phases) {
    const date = time.slice(0, 10);
    for (const phase of rule.phases) if (date >= phase.from) { rates = { ...rates, ...phase.rates }; basis += ` 使用${phase.from}起已公告价格。`; }
  }
  if (rule.schedule) {
    const date = new Date(Date.parse(time) + 8 * 3600_000);
    const day = date.toISOString().slice(0, 10);
    const minute = date.getUTCHours() * 60 + date.getUTCMinutes();
    const week = date.getUTCDay();
    const possiblePeak = week >= 1 && week <= 5 && ((minute >= 540 && minute < 720) || (minute >= 840 && minute < 1080));
    if (possiblePeak && date.getUTCFullYear() !== rule.schedule.calendarYear) throw new Error('该年份的中国节假日日历尚未核实，无法确定高峰或空闲价格。');
    const holiday = rule.schedule.holidays.some(([from, to]) => day >= from && day <= to);
    const peak = possiblePeak && !holiday;
    if (!peak) rates = { ...rates, ...rule.schedule.offPeakRates };
    basis += peak ? ' 北京时间工作日高峰价。' : ' 北京时间空闲/周末/节假日价格。';
  }
  const input = usage.inputTokens;
  if (!count(input)) throw new Error('供应商未返回完整输入 Token 用量，无法选择计价档位。');
  if (rule.ambiguousThreshold && input > rule.ambiguousThreshold.lower && input <= rule.ambiguousThreshold.upper) throw new Error('官方512K门槛尚未确认十进制或二进制，此输入长度暂不能可靠选择档位。');
  if (rule.maxInput && input > rule.maxInput) throw new Error('输入超出已核实官方价格范围。');
  if (rule.tiers) {
    const tier = rule.tiers.find(t => t.upTo === null || input <= t.upTo);
    if (!tier) throw new Error('输入超出已核实官方阶梯价格范围。');
    rates = { ...rates, ...tier.rates };
    basis += ` 按整次${input}输入Token选择档位。`;
  }
  if (rule.longContext && input > rule.longContext.threshold) {
    for (const key of Object.keys(rates)) rates[key] = rateMultiply(rates[key], key === 'output' ? rule.longContext.outputMultiplier : rule.longContext.inputMultiplier);
    basis += ` 输入超过${rule.longContext.threshold}Token，整次请求应用长上下文价。`;
  }
  return { rates, basis };
}

function tokenComponents(bill, rule, usage, rates) {
  const input = usage.inputTokens;
  const output = usage.outputTokens;
  if (!count(input) || !count(output)) throw new Error('供应商未返回完整输入与输出 Token 用量。');
  const cached = usage.cachedInputTokens ?? ((usage.cachedInputTextTokens ?? 0) + (usage.cachedInputImageTokens ?? 0));
  if (usage.cachedInputTextTokens !== undefined && usage.cachedInputImageTokens !== undefined && usage.cachedInputTextTokens + usage.cachedInputImageTokens !== cached) throw new Error('缓存输入模态拆分与缓存总用量不一致。');
  const writeKeys = ['cacheWrite5mTokens', 'cacheWrite1hTokens', 'cacheWrite30mTokens', 'cacheWrite12hTokens'];
  const writes = Object.fromEntries(writeKeys.map(k => [k, usage[k] ?? 0]));
  const sumWrites = Object.values(writes).reduce((a, b) => a + b, 0);
  if (usage.cacheWriteInputTokens !== undefined && usage.cacheWriteInputTokens !== sumWrites) {
    const available = writeKeys.filter(k => rates[k.replace('Tokens', '')] !== undefined);
    if (sumWrites || available.length !== 1) throw new Error('缓存写入用量缺少已核实的TTL拆分，无法确定缓存写入费。');
    writes[available[0]] = usage.cacheWriteInputTokens;
  }
  const writeTotal = Object.values(writes).reduce((a, b) => a + b, 0);
  if (![cached, ...Object.values(writes)].every(count) || cached + writeTotal > input) throw new Error('供应商返回的缓存拆分与输入总用量不一致。');
  const ordinary = input - cached - writeTotal;
  if (usage.uncachedInputTokens !== undefined && usage.uncachedInputTokens !== ordinary) throw new Error('普通未缓存输入与缓存读写拆分不一致。');
  if (usage.reasoningTokens !== undefined && (!count(usage.reasoningTokens) || usage.reasoningTokens > output)) throw new Error('思考 Token 用量与输出总用量不一致。');
  bill.add('input', '普通输入', ordinary, rates.input);
  if (cached) bill.add('cached-input', '缓存读取输入', cached, rates.cachedInput);
  for (const [key, value] of Object.entries(writes)) if (value) bill.add(key, key.replace('cacheWrite', '缓存写入 ').replace('Tokens', ''), value, rates[key.replace('Tokens', '')]);
  bill.add('output', '输出（含思考）', output, rates.output);
  if (rule.uncertainPromotion) throw new Error(rule.uncertainPromotion);
}

function imageComponents(bill, usage, operation, rates) {
  let text = usage.inputTextTokens;
  let image = usage.inputImageTokens;
  if (operation === 'image-generation' && text === undefined && image === undefined && count(usage.inputTokens)) { text = usage.inputTokens; image = 0; }
  if (count(usage.inputTokens)) {
    if (count(text) && image === undefined) image = usage.inputTokens - text;
    if (count(image) && text === undefined) text = usage.inputTokens - image;
  }
  if (image === undefined && operation === 'image-generation' && count(text)) image = 0;
  const output = usage.outputImageTokens ?? usage.outputTokens;
  if (count(text)) bill.add('input-text', '文字输入', text, rates.inputText);
  if (count(image)) bill.add('input-image', '图片输入', image, rates.inputImage);
  if (count(output)) bill.add('output-image', '图片输出', output, rates.outputImage);
  if (!count(text) || !count(image) || !count(output)) throw new Error('图片已生成；供应商未返回完整文字/图片输入及图片输出Token，完整费用暂待用量补齐。');
  if (count(usage.inputTokens) && text + image !== usage.inputTokens) throw new Error('图片输入明细与总Token用量不一致。');
  if (usage.outputImageTokens !== undefined && usage.outputTokens !== undefined && usage.outputImageTokens !== usage.outputTokens) throw new Error('直接Images接口的图片输出明细与输出总Token不一致。');
  if (usage.outputTextTokens > 0 || usage.reasoningTokens > 0) throw new Error('直接Images接口返回了未核实单价的文字或思考输出项目。');
}

function calculateOfficialCost(pricing, usage = {}, context = {}) {
  const snapshot = resolveOfficialBillingRule(context, pricing);
  if (!snapshot) return null;
  const bill = receipt(snapshot, pricing, context);
  try {
    if (!Array.isArray(snapshot.rule.operations) || !snapshot.rule.operations.includes(snapshot.operation)) throw new Error('此模型操作的模态计费尚未核实，不能使用文字单价代替。');
    const tokenKeys = ['inputTokens', 'outputTokens', 'inputTextTokens', 'inputImageTokens', 'cachedInputTokens', 'cachedInputTextTokens', 'cachedInputImageTokens', 'cacheWriteInputTokens', 'cacheWrite5mTokens', 'cacheWrite1hTokens', 'cacheWrite30mTokens', 'cacheWrite12hTokens', 'outputImageTokens', 'outputTextTokens', 'reasoningTokens', 'uncachedInputTokens'];
    if (tokenKeys.some(key => usage[key] !== undefined && !count(usage[key]))) throw new Error('供应商返回的Token计费用量无效。');
    if (snapshot.rule.scheme === 'direct-image-tokens') {
      imageComponents(bill, usage, snapshot.operation, snapshot.rule.rates);
      addSvgComponents(bill, snapshot, usage, { selectedRates, tokenComponents });
    }
    else {
      const selected = selectedRates(snapshot.rule, usage, snapshot.startedAt);
      snapshot.rule.basis += selected.basis;
      tokenComponents(bill, snapshot.rule, usage, selected.rates);
    }
    return bill.finish('已按冻结的官方规则及供应商实际返回用量自动核算，账户优惠和最终账单以供应商为准。');
  } catch (error) { return bill.finish(error.message, false); }
}

function calculateManualCost(pricing, usage = {}, context = {}) {
  if (!['CNY', 'USD'].includes(pricing.currency)) return unknown('价格货币未设置为人民币或美元。');
  const snapshot = { ruleId: 'user-pricing', ruleVersion: '1', startedAt: validTime(context.startedAt) ? context.startedAt : new Date().toISOString(), rule: { currency: pricing.currency, basis: '用户填写的单价；不套用官方模型目录规则。' } };
  const bill = receipt(snapshot, pricing, context);
  try {
    if (pricing.unit === 'million-tokens') {
      if (!count(usage.inputTokens) || !count(usage.outputTokens)) throw new Error('供应商未返回完整输入与输出 Token 用量。');
      for (const [code, label, quantity, price] of [['input', '输入', usage.inputTokens, pricing.input], ['output', '输出', usage.outputTokens, pricing.output]]) {
        if (quantity || decimal(price)) bill.add(code, label, quantity, price);
      }
    } else {
      const quantity = pricing.unit === 'image' ? usage.images : pricing.unit === 'second' ? usage.seconds : pricing.unit === 'request' ? 1 : undefined;
      if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity < 0) throw new Error('供应商未返回可核算的数量或时长。');
      const price = decimal(pricing.output?.trim() ? pricing.output : pricing.input);
      if (!price) throw new Error('单价尚未填写。');
      bill.add('quantity', '数量/时长', quantity, format(price), pricing.unit);
    }
    if (usage.imageOutputFormat === 'svg' || usage.svgUsage !== undefined) throw new Error('已按手动单价保留可核算部分；SVG作者模型另行计费，完整费用尚未核实。');
    return bill.finish('按供应商返回用量与用户填写的单价核算，实际账单仍需核对。');
  } catch (error) { return bill.finish(error.message, false); }
}

module.exports = { resolveOfficialBillingRule, calculateOfficialCost, calculateManualCost };
