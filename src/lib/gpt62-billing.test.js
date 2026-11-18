import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const catalog = require('../model-catalog-data.json'), registry = require('../../electron/billing-rules.json');
const { calculateCost } = require('../../electron/live-cost.cjs');
const { resolveOfficialBillingRule } = require('../../electron/official-billing.cjs');
const { createBillingRequestSnapshot, completeBillingUsage } = require('../../electron/billing-request-shape.cjs');
function fixture(slug, changes = {}) {
  const entry = catalog.models.find(item => item.id === 'openai-gpt-6-2-' + slug), rule = registry.rules.find(item => item.id === entry.id);
  const pricing = { ...rule.expectedPricing, officialUrl: rule.officialUrl, verifiedAt: entry.checkedAt, referenceOnly: true };
  return { entry, rule, pricing, context: { modelId: entry.modelId, operation: 'text', startedAt: '2026-11-18T02:00:00.000Z', connection: { providerId: 'openai', protocol: 'openai-responses', baseUrl: entry.defaultBaseUrl, enabled: true }, ...changes } };
}
function cost(slug, usage, changes) { const f = fixture(slug, changes); return calculateCost(f.pricing, usage, f.context); }
describe('GPT-6.2官方全球Standard实际用量规则', () => {
  it('两型号准确目录ID/价格/来源与独立规则绑定，不新增地区或覆盖旧型号单价', () => {
    const expected = { astra: { input: '8', output: '40', cachedInput: '0.40', cacheWrite30m: '10', cacheWrite12h: '20' }, sol: { input: '2', output: '10', cachedInput: '0.10', cacheWrite30m: '2.50', cacheWrite12h: '5' } };
    for (const slug of ['astra', 'sol']) {
      const f = fixture(slug); expect(f.entry).toMatchObject({ modelId: 'gpt-6.2-' + slug, checkedAt: '2026-11-18', releaseDate: '2026-11-17', region: '官方全球 API · USD', allowedHosts: ['api.openai.com'], capabilities: ['text', 'vision'] });
      expect(f.entry.pricing).toMatchObject({ input: expected[slug].input, output: expected[slug].output, referenceOnly: true }); expect(f.rule.rates).toEqual(expected[slug]);
      expect(f.rule.longContext).toEqual({ threshold: 272000, inputMultiplier: '2', outputMultiplier: '1.5' }); expect(f.rule.sources).toContain('https://developers.openai.com/api/docs/models/' + f.entry.modelId);
      expect(catalog.models.filter(item => item.modelId === f.entry.modelId)).toHaveLength(1); expect(resolveOfficialBillingRule(f.context, f.pricing)?.ruleId).toBe(f.entry.id);
    }
    expect(registry.rules.find(item => item.modelId === 'gpt-6-astra').rates.input).toBe('10'); expect(registry.rules.find(item => item.modelId === 'gpt-6.1-sol').rates.input).toBe('2');
  });
  it('272000保持短上下文，272001整请求输入/缓存双倍和输出1.5倍；思考包含在输出内', () => {
    for (const [slug, short, long] of [['astra', '2.216', '4.412016'], ['sol', '0.554', '1.103004']]) {
      expect(cost(slug, { inputTokens: 272000, outputTokens: 1000, reasoningTokens: 600 }).calculation.nativeAmount).toBe(short);
      const value = cost(slug, { inputTokens: 272001, outputTokens: 1000, reasoningTokens: 600 }); expect(value.calculation.nativeAmount).toBe(long); expect(value.costState).toBe('calculated');
      expect(value.calculation.components.find(item => item.code === 'output').quantity).toBe(1000); expect(value.calculation.basis).toContain('长上下文');
    }
  });
  it('实际普通输入、缓存读取和两种写入分开计费，不重复加写入Token，vision保持相同Token价格', () => {
    const short = { inputTokens: 1000, cachedInputTokens: 200, cacheWriteInputTokens: 300, cacheWrite30mTokens: 100, cacheWrite12hTokens: 200, uncachedInputTokens: 500, outputTokens: 50 };
    const long = { inputTokens: 272001, cachedInputTokens: 100000, cacheWriteInputTokens: 100000, cacheWrite30mTokens: 60000, cacheWrite12hTokens: 40000, uncachedInputTokens: 72001, outputTokens: 1000 };
    for (const [slug, shortTotal, longTotal] of [['astra', '0.01108', '4.092016'], ['sol', '0.00277', '1.023004']]) {
      const result = cost(slug, short); expect(result.calculation.nativeAmount).toBe(shortTotal); expect(cost(slug, short, { operation: 'vision' }).calculation.nativeAmount).toBe(shortTotal);
      expect(result.calculation.components.find(item => item.code === 'input').quantity).toBe(500); expect(cost(slug, long).calculation.nativeAmount).toBe(longTotal);
    }
    expect(cost('astra', { inputTokens: 100, cachedInputTokens: 80, cacheWrite30mTokens: 30, outputTokens: 10 }).costState).toBe('unknown');
  });
  it('未返回TTL拆分仍未知，仅冻结的本应用官方Responses默认30m请求形状可补实际写入分类', () => {
    for (const [slug, total] of [['astra', '0.00908'], ['sol', '0.00227']]) {
      const f = fixture(slug), reported = { inputTokens: 1000, cachedInputTokens: 200, cacheWriteInputTokens: 300, outputTokens: 50 }, rule = resolveOfficialBillingRule(f.context, f.pricing);
      expect(cost(slug, reported).costState).toBe('unknown');
      const request = { model: { modelId: f.entry.modelId }, connection: f.context.connection, kind: 'text' }, body = { model: f.entry.modelId, input: [{ role: 'user', content: '固定内容' }] };
      const proof = createBillingRequestSnapshot(request, body), actual = completeBillingUsage(reported, proof, f.context, rule);
      expect(actual).toMatchObject({ cacheWrite30mTokens: 300, cacheWrite12hTokens: 0, usageSource: 'provider-reported+request-shape-default' });
      expect(calculateCost(f.pricing, actual, { ...f.context, ruleSnapshot: rule }).calculation.nativeAmount).toBe(total);
      const explicit = createBillingRequestSnapshot(request, { ...body, prompt_cache_options: { ttl: '12h' } }); expect(completeBillingUsage(reported, explicit, f.context, rule)).toEqual(reported);
      const chat = { ...f.context, connection: { ...f.context.connection, protocol: 'openai-chat' } }; expect(completeBillingUsage(reported, proof, chat, rule)).toEqual(reported);
    }
  });
  it('规则冻结后价格调整不追改旧费用；发布前、代理、地区端点和扩展型号不冒用该规则', () => {
    const f = fixture('astra'), usage = { inputTokens: 1000, outputTokens: 1000 }, snapshot = resolveOfficialBillingRule(f.context, f.pricing);
    expect(calculateCost({ ...f.pricing, input: '999' }, usage, { ...f.context, ruleSnapshot: JSON.parse(JSON.stringify(snapshot)) }).calculation.nativeAmount).toBe('0.048');
    expect(resolveOfficialBillingRule({ ...f.context, startedAt: '2026-11-16T23:59:59.000Z' }, f.pricing)).toBeNull();
    for (const baseUrl of ['https://proxy.invalid/v1', 'https://eu.api.openai.com/v1', 'https://api.openai.com:444/v1', 'https://api.openai.com/v2']) expect(resolveOfficialBillingRule({ ...f.context, connection: { ...f.context.connection, baseUrl } }, f.pricing)).toBeNull();
    expect(resolveOfficialBillingRule({ ...f.context, modelId: 'gpt-6.2-astra-law' }, f.pricing)).toBeNull(); expect(snapshot.rule.allowedHosts).toEqual(['api.openai.com']);
  });
});
