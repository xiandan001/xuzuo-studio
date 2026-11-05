import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { it as test } from 'vitest';
const require = createRequire(import.meta.url);
const { calculateCost, estimateCost } = require('../../electron/live-cost.cjs');
const { resolveOfficialBillingRule } = require('../../electron/official-billing.cjs');
const rules = require('../../electron/billing-rules.json').rules;
const catalog = require('../model-catalog-data.json');

function fixture(id, changes = {}) {
  const rule = rules.find(r => r.id === id);
  assert.ok(rule, id);
  const entry = catalog.models.find(m => m.id === id);
  return { pricing: { ...rule.expectedPricing, referenceOnly: entry.pricing.referenceOnly, officialUrl: rule.officialUrl, verifiedAt: rule.verifiedAt }, context: { modelId: rule.modelId, connection: { providerId: rule.providerId, protocol: rule.protocols[0], baseUrl: entry.defaultBaseUrl, enabled: true }, operation: rule.scheme === 'direct-image-tokens' ? 'image-generation' : 'text', startedAt: `${rule.validFrom}T02:00:00.000Z`, ...changes } };
}
function cost(id, usage, changes) { const f = fixture(id, changes); return calculateCost(f.pricing, usage, f.context); }
const basic = { inputTokens: 1000, outputTokens: 1000 };

test('all 37 ready models have separately identified serializable official rules', () => {
  assert.equal(rules.length, 37);
  assert.equal(new Set(rules.map(r => r.id)).size, 37);
  for (const r of rules) {
    const f = fixture(r.id);
    const snapshot = resolveOfficialBillingRule(f.context, f.pricing);
    assert.equal(JSON.parse(JSON.stringify(snapshot)).ruleId, r.id);
    assert.equal(JSON.stringify(snapshot).includes('apiKey'), false);
    const usage = r.scheme === 'direct-image-tokens' ? { inputTokens: 30, inputTextTokens: 30, inputImageTokens: 0, outputTokens: 196, outputImageTokens: 196 } : basic;
    assert.equal(calculateCost(f.pricing, usage, f.context).costState, r.uncertainPromotion ? 'unknown' : 'calculated', r.id);
  }
});

test('direct Images reproduces 30 text input + 196 image output = $0.00603', () => {
  const result = cost('openai-gpt-image-2-5-sunburst', { inputTokens: 30, inputTextTokens: 30, inputImageTokens: 0, outputTokens: 196, outputImageTokens: 196 });
  assert.equal(result.costState, 'calculated');
  assert.equal(result.calculation.nativeAmount, '0.00603');
  assert.equal(result.costCents, 0);
  assert.equal(result.calculation.cnyAmount, undefined);
  assert.equal(result.calculation.completeness, 'complete');
  assert.deepEqual(result.calculation.components.find(c => c.code === 'input-text'), { code: 'input-text', label: '文字输入', quantity: 30, unit: 'million-tokens', unitPrice: '5', amount: '0.00015', currency: 'USD' });
});

test('image edits bill image inputs at $8/M and direct endpoints do not get cache discounts', () => {
  const usage = { inputTokens: 130, inputTextTokens: 30, inputImageTokens: 100, cachedInputTokens: 130, outputImageTokens: 196 };
  const result = cost('openai-gpt-image-2-5-flare', usage, { operation: 'image-editing' });
  assert.equal(result.calculation.nativeAmount, '0.00683');
  assert.equal(result.calculation.components.find(c => c.code === 'input-image').unitPrice, '8');
  assert.equal(result.calculation.components.some(c => /cache/.test(c.code)), false);
  assert.equal(cost('openai-gpt-image-2-5-flare', { inputTokens: 30, outputTokens: 196 }).calculation.nativeAmount, '0.00603');
});

test('missing image modality usage remains a partial amount, never a known per-image total', () => {
  const result = cost('openai-gpt-image-2-5-sunburst', { inputTokens: 130, outputTokens: 196 }, { operation: 'image-editing' });
  assert.equal(result.costState, 'unknown');
  assert.equal(result.calculation.completeness, 'partial');
  assert.equal(result.calculation.nativeAmount, '0.00588');
  const f = fixture('openai-gpt-image-2-5-sunburst');
  assert.match(estimateCost({ pricing: f.pricing }, { kind: 'image-generation' }, '猫', f.context).reason, /生成后.*自动核算/);
});

test('exact decimals and frozen FX preserve tiny native charges before rounding budget cents up', () => {
  const fx = { base: 'USD', quote: 'CNY', rate: '7.123456789123456789', date: '2026-10-29', source: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml', kind: 'reference' };
  const result = cost('openai-gpt-image-2-5-sunburst', { inputTextTokens: 30, inputImageTokens: 0, outputImageTokens: 196 }, { fx });
  assert.equal(result.calculation.nativeAmount, '0.00603');
  assert.equal(result.calculation.cnyAmount, '0.04295444443841444443767');
  assert.deepEqual(result.calculation.fx, fx);
  assert.equal(result.costCents, 5);
  const tiny = cost('openai-gpt-6-luna', { inputTokens: 1, outputTokens: 0 }, { fx });
  assert.equal(tiny.calculation.nativeAmount, '0.0000001');
  assert.equal(tiny.costCents, 1);
});

test('OpenAI long input applies whole-request multipliers and splits cache TTL writes', () => {
  const short = cost('openai-gpt-6-1-sol', { inputTokens: 272000, outputTokens: 1000 });
  const long = cost('openai-gpt-6-1-sol', { inputTokens: 272001, outputTokens: 1000 });
  assert.equal(short.calculation.nativeAmount, '0.554');
  assert.equal(long.calculation.nativeAmount, '1.103004');
  assert.match(long.calculation.basis, /长上下文/);
  const cached = cost('openai-gpt-6-1-sol', { inputTokens: 1000, cachedInputTokens: 200, cacheWriteInputTokens: 300, cacheWrite30mTokens: 100, cacheWrite12hTokens: 200, uncachedInputTokens: 500, outputTokens: 50 });
  assert.equal(cached.calculation.nativeAmount, '0.00277');
  assert.equal(cost('openai-gpt-6-1-sol', { inputTokens: 1000, outputTokens: 50, cacheWriteInputTokens: 300 }).costState, 'unknown');
});

test('Anthropic thresholds include cache reads and writes and output already includes thinking', () => {
  const result = cost('anthropic-claude-haiku-5-5', { inputTokens: 100001, cachedInputTokens: 50000, cacheWriteInputTokens: 10000, cacheWrite5mTokens: 5000, cacheWrite1hTokens: 5000, uncachedInputTokens: 40001, outputTokens: 1000, reasoningTokens: 700 });
  assert.equal(result.calculation.nativeAmount, '0.0331255');
  assert.equal(result.calculation.components.find(c => c.code === 'output').quantity, 1000);
  assert.equal(result.calculation.components.find(c => c.code === 'input').quantity, 40001);
  assert.equal(cost('anthropic-claude-haiku-5-5', { inputTokens: 100000, outputTokens: 1000 }).calculation.nativeAmount, '0.0105');
});

test('Gemini announced promotional price rollover is selected by frozen start date', () => {
  assert.equal(cost('google-gemini-4-argon', basic).calculation.nativeAmount, '0.012');
  assert.equal(cost('google-gemini-4-argon', basic, { startedAt: '2026-12-01T00:00:00.000Z' }).calculation.nativeAmount, '0.024');
  assert.equal(cost('google-gemini-3-8-flash', basic, { startedAt: '2027-01-01T00:00:00.000Z' }).calculation.nativeAmount, '0.009');
});

test('verified image-understanding uses image input tokens at official input rates; unverified audio/video never falls back to flat text pricing', () => {
  assert.equal(cost('openai-gpt-6-1-sol', basic, { operation: 'vision' }).calculation.nativeAmount, '0.012');
  assert.equal(cost('google-gemini-3-5-flash-lite', basic, { operation: 'vision' }).calculation.nativeAmount, '0.0028');
  const video = cost('google-gemini-3-5-flash-lite', basic, { operation: 'video-understanding' });
  assert.equal(video.costState, 'unknown');
  assert.match(video.reason, /模态计费尚未核实/);
  assert.equal(cost('zhipu-glm-5-3', basic, { operation: 'vision' }).costState, 'unknown');
});

test('DeepSeek peak, midday, weekend, public holiday and unknown-year peak are distinct', () => {
  assert.equal(cost('deepseek-deepseek-flash', basic).calculation.nativeAmount, '0.0015');
  assert.equal(cost('deepseek-deepseek-flash', basic, { startedAt: '2026-10-30T04:00:00.000Z' }).calculation.nativeAmount, '0.00075');
  assert.equal(cost('deepseek-deepseek-flash', basic, { startedAt: '2026-10-31T02:00:00.000Z' }).calculation.nativeAmount, '0.00075');
  const holiday = fixture('deepseek-deepseek-flash');
  const saved = resolveOfficialBillingRule(holiday.context, holiday.pricing);
  saved.startedAt = '2026-10-01T02:00:00.000Z'; saved.rule.validFrom = '2026-10-01';
  assert.equal(calculateCost(holiday.pricing, basic, { ruleSnapshot: saved }).calculation.nativeAmount, '0.00075');
  assert.equal(cost('deepseek-deepseek-flash', basic, { startedAt: '2027-01-01T02:00:00.000Z' }).costState, 'unknown');
});

test('domestic tiers, cache hits, regions and uncertain activity are kept explicit', () => {
  assert.equal(cost('aliyun-qwen3-7-flash', { inputTokens: 32000, outputTokens: 1000 }).calculation.nativeAmount, '0.0072');
  assert.equal(cost('aliyun-qwen3-7-flash', { inputTokens: 32001, outputTokens: 1000 }).calculation.nativeAmount, '0.0216006');
  assert.equal(cost('aliyun-qwen3-7-flash', { inputTokens: 1000001, outputTokens: 1 }).costState, 'unknown');
  assert.equal(cost('aliyun-qwen3-7-plus', basic).costState, 'unknown');
  assert.equal(cost('volcengine-doubao-seed-2-0-mini-260428', { inputTokens: 128001, cachedInputTokens: 100000, outputTokens: 1000 }).calculation.nativeAmount, '0.0464008');
  assert.equal(cost('minimax-minimax-m3-cn', { inputTokens: 512001, outputTokens: 1 }).costState, 'unknown');
  assert.equal(cost('minimax-minimax-m3-cn', { inputTokens: 524289, outputTokens: 1000 }).calculation.nativeAmount, '2.2188138');
  assert.equal(cost('minimax-minimax-m3-1-flash-cn', basic).calculation.nativeAmount, '0.005');
  assert.equal(cost('minimax-minimax-m3-1-flash-io', basic).calculation.nativeAmount, '0.00075');
});

test('official matching rejects proxy, wrong port/path/protocol/source/date or manually changed price', () => {
  const f = fixture('openai-gpt-6-1-sol');
  for (const changes of [{ baseUrl: 'https://proxy.example.com/v1' }, { baseUrl: 'https://api.openai.com:444/v1' }, { baseUrl: 'https://api.openai.com/v2' }, { baseUrl: 'https://api.openai.com/v1?key=secret' }, { protocol: 'gemini' }, { providerId: 'custom' }]) {
    assert.equal(resolveOfficialBillingRule({ ...f.context, connection: { ...f.context.connection, ...changes } }, f.pricing), null);
  }
  for (const changes of [{ officialUrl: 'https://example.com/pricing' }, { verifiedAt: '2026-10-29' }, { input: '3' }, { currency: 'CNY' }]) assert.equal(resolveOfficialBillingRule(f.context, { ...f.pricing, ...changes }), null);
  assert.equal(resolveOfficialBillingRule(f.context, { ...f.pricing, officialUrl: undefined }), null);
});

test('unmatched official simple pricing cannot silently become user flat pricing, while explicit manual still works', () => {
  const f = fixture('anthropic-claude-sonnet-5-5');
  const usage = { inputTokens: 1000, cachedInputTokens: 900, outputTokens: 1000 };
  assert.equal(calculateCost(f.pricing, usage, f.context).calculation.nativeAmount, '0.01029');
  assert.equal(calculateCost({ ...f.pricing, verifiedAt: '2026-10-29' }, usage, f.context).costState, 'unknown');
  assert.equal(calculateCost(f.pricing, usage, { ...f.context, connection: { ...f.context.connection, baseUrl: 'https://proxy.example.com' } }).costState, 'unknown');
  const manual = { ...f.pricing, officialUrl: undefined, verifiedAt: undefined, referenceOnly: false };
  assert.equal(calculateCost(manual, usage, f.context).calculation.nativeAmount, '0.012');
});

test('new official binding never applies the first verified current price to an earlier historical call', () => {
  const f = fixture('anthropic-claude-sonnet-5-5', { startedAt: '2026-10-29T02:00:00Z' });
  assert.equal(resolveOfficialBillingRule(f.context, f.pricing), null);
  assert.equal(calculateCost(f.pricing, basic, f.context).costState, 'unknown');
  assert.equal(resolveOfficialBillingRule({ ...f.context, startedAt: '2027-02-31T02:00:00Z' }, f.pricing), null);
  const current = fixture('anthropic-claude-sonnet-5-5');
  const snapshot = resolveOfficialBillingRule(current.context, current.pricing);
  snapshot.startedAt = '2026-10-29T02:00:00Z';
  assert.equal(calculateCost(current.pricing, basic, { ruleSnapshot: snapshot }).costState, 'unknown');
  // A genuinely saved earlier version must carry its own known validity start.
  snapshot.rule.validFrom = '2026-10-01';
  snapshot.rule.version = snapshot.ruleVersion = '2026-10-01.saved';
  snapshot.rule.rates.input = '1';
  assert.equal(calculateCost(undefined, basic, { ruleSnapshot: snapshot }).calculation.nativeAmount, '0.011');
});

test('frozen rule snapshots reproduce historical native rates without current model metadata', () => {
  const f = fixture('google-gemini-4-argon');
  const snapshot = resolveOfficialBillingRule(f.context, f.pricing);
  const original = JSON.stringify(snapshot);
  const historical = calculateCost(undefined, basic, { ruleSnapshot: JSON.parse(original) });
  assert.equal(historical.calculation.nativeAmount, '0.012');
  assert.equal(JSON.stringify(snapshot), original);
  assert.equal(resolveOfficialBillingRule({ ...f.context, modelId: 'different', ruleSnapshot: snapshot }, f.pricing), null);
  assert.equal(calculateCost({ unit: 'million-tokens', currency: 'CNY', input: '0', output: '0' }, basic, { ...f.context, modelId: 'different', ruleSnapshot: snapshot }).costState, 'unknown');
});

test('legacy manual pricing remains isolated, precise and known in USD without FX', () => {
  const pricing = { unit: 'million-tokens', currency: 'CNY', input: '1', output: '2' };
  assert.equal(calculateCost(pricing, { inputTokens: 1000000, outputTokens: 1000000 }).costCents, 300);
  assert.equal(calculateCost({ ...pricing, referenceOnly: true }, basic).costState, 'unknown');
  const usd = calculateCost({ ...pricing, currency: 'USD' }, basic);
  assert.equal(usd.costState, 'calculated');
  assert.equal(usd.calculation.nativeAmount, '0.003');
  assert.equal(usd.calculation.cnyAmount, undefined);
  const withUserFx = calculateCost({ ...pricing, currency: 'USD', exchangeRate: '8' }, basic, { fx: { base: 'USD', quote: 'CNY', rate: '7', date: '2026-10-29', source: 'https://www.ecb.europa.eu/', kind: 'reference' } });
  assert.equal(withUserFx.calculation.cnyAmount, '0.024');
  assert.equal(withUserFx.calculation.fx.kind, 'user');
  const duration = calculateCost({ unit: 'second', currency: 'CNY', input: '', output: '0.123456' }, { seconds: 1.234567 });
  assert.equal(duration.calculation.nativeAmount, '0.152414703552');
  assert.equal(duration.calculation.components[0].quantity, 1.234567);
  assert.equal(duration.costCents, 16);
});

test('an explicit valid user FX also overrides public FX for an official catalog model', () => {
  const f = fixture('anthropic-claude-sonnet-5-5');
  const fx = { base: 'USD', quote: 'CNY', rate: '7', date: '2026-10-29', source: 'https://www.ecb.europa.eu/', kind: 'reference' };
  const result = calculateCost({ ...f.pricing, exchangeRate: '8' }, basic, { ...f.context, fx });
  assert.equal(result.calculation.nativeAmount, '0.012');
  assert.equal(result.calculation.cnyAmount, '0.096');
  assert.equal(result.calculation.fx.kind, 'user');
  assert.equal(calculateCost({ ...f.pricing, exchangeRate: '' }, basic, { ...f.context, fx }).calculation.fx.kind, 'reference');
});

test('invalid or inconsistent usage never becomes a calculated charge', () => {
  for (const usage of [{ inputTokens: 1, outputTokens: -1 }, { inputTokens: 1.2, outputTokens: 0 }, { inputTokens: 1, outputTokens: 1, cachedInputTokens: 2 }, { inputTokens: 1, outputTokens: 1, reasoningTokens: 2 }, { inputTokens: 100, outputTokens: 1, cachedInputTokens: 10, cachedInputTextTokens: 9, cachedInputImageTokens: 2 }]) assert.equal(cost('openai-gpt-6-1-sol', usage).costState, 'unknown');
});
