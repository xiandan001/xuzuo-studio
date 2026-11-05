import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { calculateCost } = require('../../electron/live-cost.cjs');
const { resolveOfficialBillingRule } = require('../../electron/official-billing.cjs');
const registry = require('../../electron/billing-rules.json');
const reference = { inputTokens: 30, inputTextTokens: 30, inputImageTokens: 0, outputTokens: 196, outputImageTokens: 196 };
const author = { model: 'gpt-6.1-sol', inputTokens: 100, outputTokens: 200, reasoningTokens: 150, totalTokens: 300 };
function fixture(flavor = 'sunburst') {
  const rule = registry.rules.find(item => item.modelId === `gpt-image-2.6-${flavor}`);
  const pricing = { ...rule.expectedPricing, officialUrl: rule.officialUrl, verifiedAt: rule.verifiedAt, referenceOnly: true };
  const context = { modelId: rule.modelId, connection: { providerId: 'openai', protocol: 'openai-responses', baseUrl: 'https://api.openai.com/v1', enabled: true }, operation: 'image-generation', startedAt: '2026-11-05T03:00:00Z' };
  return { pricing, context, snapshot: resolveOfficialBillingRule(context, pricing) };
}
function svg(usage = author) { return { ...reference, imageOutputFormat: 'svg', svgUsage: usage }; }

describe('Image 2.6 actual-token and SVG dual-model billing', () => {
  it('bills both exact aliases and GIF aggregate usage once without frame/count multiplication or inferred cache savings', () => {
    for (const flavor of ['sunburst', 'flare']) {
      const { pricing, context } = fixture(flavor);
      for (const extra of [{ imageOutputFormat: 'png' }, { imageOutputFormat: 'gif', images: 3, frameCount: 16, cachedInputTokens: 30 }]) {
        const result = calculateCost(pricing, { ...reference, ...extra }, context);
        expect(result.costState).toBe('calculated');
        expect(result.calculation.nativeAmount).toBe('0.00603');
        expect(result.calculation.components.map(item => item.code)).toEqual(['input-text', 'input-image', 'output-image']);
      }
    }
  });
  it('adds reference and author cost at independent rates; reasoning is already in author output', () => {
    const { pricing, context } = fixture();
    const result = calculateCost(pricing, svg(), context);
    expect(result).toMatchObject({ costState: 'calculated', calculation: { nativeAmount: '0.00823', completeness: 'complete' } });
    expect(result.calculation.components.find(item => item.code === 'svg-output')).toMatchObject({ quantity: 200, unitPrice: '10', amount: '0.002' });
    expect(result.calculation.components.find(item => item.code === 'svg-input')).toMatchObject({ quantity: 100, unitPrice: '2', amount: '0.0002' });
    expect(result.calculation.components.some(item => /reasoning/.test(item.code))).toBe(false);
    expect(result.calculation.basis).toContain('SVG作者gpt-6.1-sol');
  });
  it('selects verified author long-context tiers with the author input, independently of the reference image', () => {
    const { pricing, context } = fixture();
    const result = calculateCost(pricing, svg({ ...author, inputTokens: 272001, totalTokens: 272201 }), context);
    expect(result.calculation.nativeAmount).toBe('1.097034');
    expect(result.calculation.components.find(item => item.code === 'svg-output').unitPrice).toBe('15');
  });
  it('preserves known reference amount for missing, unknown, inconsistent or unsupported author usage', () => {
    const { pricing, context } = fixture();
    for (const usage of [undefined, {}, { ...author, model: 'unpriced-author' }, { ...author, model: 'gpt-6.1-sol-future' }, { ...author, inputTokens: undefined }, { ...author, outputTokens: -1 }, { ...author, reasoningTokens: 201 }, { ...author, totalTokens: 301 }]) {
      const result = calculateCost(pricing, { ...reference, imageOutputFormat: 'svg', ...(usage === undefined ? {} : { svgUsage: usage }) }, context);
      expect(result).toMatchObject({ costState: 'unknown', calculation: { nativeAmount: '0.00603', completeness: 'partial' } });
      expect(result.reason).toMatch(/SVG/);
    }
  });
  it('freezes author rates before response and survives repricing and JSON round trips without rewriting snapshot', () => {
    const { pricing, context, snapshot } = fixture();
    const serialized = JSON.stringify(snapshot);
    const current = registry.rules.find(item => item.modelId === author.model);
    const rates = { ...current.rates };
    try {
      current.rates.input = '999'; current.rates.output = '999';
      const historical = calculateCost(undefined, svg(), { ...context, ruleSnapshot: JSON.parse(serialized) });
      expect(historical.calculation.nativeAmount).toBe('0.00823');
      expect(calculateCost(pricing, svg(), context).calculation.nativeAmount).not.toBe('0.00823');
      expect(JSON.stringify(snapshot)).toBe(serialized);
    } finally { current.rates = rates; }
  });
  it('does not resolve an unknown historical author from newly added current registry rules', () => {
    const { context, snapshot } = fixture();
    snapshot.svgAuthorRules = snapshot.svgAuthorRules.filter(item => item.modelId !== author.model);
    const result = calculateCost(undefined, svg(), { ...context, ruleSnapshot: snapshot });
    expect(result).toMatchObject({ costState: 'unknown', calculation: { nativeAmount: '0.00603', completeness: 'partial' } });
  });
  it('guards exact model/date/endpoint and does not label a manual image-only price as complete SVG cost', () => {
    const { pricing, context } = fixture();
    expect(calculateCost(pricing, svg(), { ...context, startedAt: '2026-11-03T00:00:00Z' }).costState).toBe('unknown');
    expect(calculateCost(pricing, svg(), { ...context, modelId: 'gpt-image-2.6' }).costState).toBe('unknown');
    expect(calculateCost(pricing, svg(), { ...context, connection: { ...context.connection, baseUrl: 'https://proxy.example/v1' } }).costState).toBe('unknown');
    const manual = calculateCost({ unit: 'million-tokens', currency: 'USD', input: '5', output: '30' }, svg());
    expect(manual).toMatchObject({ costState: 'unknown', calculation: { nativeAmount: '0.00603', completeness: 'partial' } });
  });
});
