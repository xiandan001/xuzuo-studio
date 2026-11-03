import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { createBillingRequestSnapshot, recoverLegacyBillingRequest, completeBillingUsage } = require('../../electron/billing-request-shape.cjs');
const { calculateCost } = require('../../electron/live-cost.cjs');
const { resolveOfficialBillingRule } = require('../../electron/official-billing.cjs');
const { createLiveWorkflowEngine } = require('../../electron/live-workflow-engine.cjs');
const { createRunHistoryStore } = require('../../electron/run-history-store.cjs');
const rule = require('../../electron/billing-rules.json').rules.find(item => item.modelId === 'gpt-6.1-terra');
const pricing = { ...rule.expectedPricing, officialUrl: rule.officialUrl, verifiedAt: rule.verifiedAt, referenceOnly: false };
const connection = { id: 'official', name: '官方', providerId: 'openai', protocol: 'openai-responses', baseUrl: 'https://api.openai.com/v1', enabled: true };
const context = { modelId: rule.modelId, connection, operation: 'text', startedAt: '2026-10-30T15:14:45.710Z' };
const snapshot = resolveOfficialBillingRule(context, pricing);
const reported = { inputTokens: 1249, outputTokens: 648, totalTokens: 1897, reasoningTokens: 41, uncachedInputTokens: 3, cachedInputTokens: 0, cacheWriteInputTokens: 1246, usageSource: 'provider-reported' };
const request = { kind: 'text', model: { modelId: rule.modelId }, connection };
const body = { model: rule.modelId, input: [{ role: 'user', content: [{ type: 'input_text', text: '文字里出现 prompt_cache_breakpoint 不会改变请求结构' }] }], max_output_tokens: 2048, store: false, stream: false };
function record(usage = reported) {
  const step = { id: 'text', name: '正文', kind: 'text', enabled: true, inputSource: 'project', modelConfigId: 'model', prompt: '完整正文' };
  const workflow = { id: 'workflow', workspaceId: 'workspace', name: '文档', outputKind: 'word', steps: [step] };
  return {
    run: { id: 'run', mode: 'live', projectId: 'project', workspaceId: 'workspace', workflowId: 'workflow', snapshot: workflow, status: 'complete', stepIndex: 1, attempts: [{ id: 'attempt', stepId: 'text', status: 'complete', startedAt: context.startedAt, usage }], createdAt: context.startedAt, updatedAt: context.startedAt },
    request: { project: { id: 'project', workspaceId: 'workspace', costCents: 0 }, workflow, connections: [connection], models: [], input: '原稿必须保留', attachmentIds: [] },
    ledger: [{ id: 'entry', projectId: 'project', workflowRunId: 'run', workflowStepId: 'text', workflowAttemptId: 'attempt', costState: 'unknown', costCents: 0, status: 'complete', billingMode: 'live', modelId: rule.modelId, operation: 'text', time: context.startedAt, billingConnectionSnapshot: connection, billingRuleSnapshot: snapshot, pricingSnapshot: pricing, usage }],
  };
}
describe('官方 Responses 请求默认缓存计费形状', () => {
  it('只补全可证明默认30分钟的写入，精确计算0.0048005美元，不重复加入思考或父计数', () => {
    const proof = createBillingRequestSnapshot(request, body), usage = completeBillingUsage(reported, proof, context, snapshot);
    expect(proof).toMatchObject({ source: 'adapter-request', cache: { ttl: '30m', source: 'documented-default', breakpoints: false } });
    expect(usage).toMatchObject({ cacheWrite30mTokens: 1246, cacheWrite12hTokens: 0, usageSource: 'provider-reported+request-shape-default' });
    const result = calculateCost(pricing, usage, { ...context, ruleSnapshot: snapshot });
    expect(result.costState).toBe('calculated'); expect(result.calculation.nativeAmount).toBe('0.0048005');
    expect(result.calculation.components.map(item => [item.code, item.quantity])).toEqual([['input', 3], ['cacheWrite30mTokens', 1246], ['output', 648]]);
    expect(reported).not.toHaveProperty('cacheWrite30mTokens');
  });
  it('显式12小时、混合断点、代理和未知适配器不冒用默认30分钟', () => {
    const variants = [
      createBillingRequestSnapshot(request, { ...body, prompt_cache_options: { ttl: '12h' } }),
      createBillingRequestSnapshot(request, { ...body, input: [{ role: 'user', content: [{ type: 'input_text', text: '内容', prompt_cache_breakpoint: { ttl: '12h' } }] }] }),
      { ...createBillingRequestSnapshot(request, body), adapter: 'unknown-adapter' },
      undefined,
    ];
    for (const proof of variants) expect(completeBillingUsage(reported, proof, context, snapshot)).toEqual(reported);
    const proxy = { ...context, connection: { ...connection, baseUrl: 'https://proxy.invalid/v1' } };
    expect(createBillingRequestSnapshot({ ...request, connection: proxy.connection }, body)).toBeUndefined();
    expect(completeBillingUsage(reported, createBillingRequestSnapshot(request, body), proxy, snapshot)).toEqual(reported);
  });
  it('供应商明确TTL拆分永远优先；缺一项或矛盾也不覆盖成默认值', () => {
    const proof = createBillingRequestSnapshot(request, body);
    for (const usage of [{ ...reported, cacheWrite30mTokens: 1000, cacheWrite12hTokens: 246 }, { ...reported, cacheWrite12hTokens: 1246 }, { ...reported, cacheWrite30mTokens: 1245, cacheWrite12hTokens: 0 }]) expect(completeBillingUsage(usage, proof, context, snapshot)).toEqual(usage);
    const mismatch = calculateCost(pricing, { ...reported, cacheWrite30mTokens: 1245, cacheWrite12hTokens: 0 }, { ...context, ruleSnapshot: snapshot });
    expect(mismatch.costState).toBe('unknown');
  });
  it('旧记录只从已冻结身份及匹配的本应用步骤恢复形状，不使用可变当前连接', () => {
    const item = record();
    expect(recoverLegacyBillingRequest(item, item.ledger[0], item.run.attempts[0], context, snapshot)?.source).toBe('verified-legacy-adapter');
    delete item.ledger[0].billingRuleSnapshot;
    expect(recoverLegacyBillingRequest(item, item.ledger[0], item.run.attempts[0], context, snapshot)).toBeUndefined();
  });
  it('历史准确复算、重启和并发复算保持一次审计记录，不调用模型', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-cache-billing-'));
    await fs.writeFile(path.join(directory, 'live-workflows-v1.json'), JSON.stringify({ version: 1, records: [record()] }));
    let calls = 0, refreshes = 0;
    const options = { directory, recoverInterrupted: false, credentials: {}, artifactStore: {}, modelRuntime: { execute() { calls++; throw new Error('No model call allowed'); } }, fxRates: { get: async () => ({ base: 'USD', quote: 'CNY', rate: '7', date: '2026-10-30', source: 'https://fixed.invalid/rate', kind: 'reference' }), refresh: async () => { refreshes++; await new Promise(resolve => setTimeout(resolve, 10)); return false; } } };
    const engine = createLiveWorkflowEngine(options);
    const first = (await engine.snapshot()).ledger[0];
    expect(first).toMatchObject({ costState: 'calculated', calculation: { nativeAmount: '0.0048005', cnyAmount: '0.0336035' }, billingRequestSnapshot: { source: 'verified-legacy-adapter' } });
    const a = engine.recalculateCosts({ pendingOnly: true }), b = engine.recalculateCosts({ pendingOnly: true }); expect(a).toBe(b); expect(await a).toEqual({ updated: 0 }); expect(refreshes).toBe(1);
    await engine.shutdown();
    const reopened = createLiveWorkflowEngine(options); await reopened.snapshot(); await reopened.shutdown();
    const disk = await createRunHistoryStore({ directory, fileSystem: fs }).load();
    expect(disk.records[0].ledger[0].costRevisions).toHaveLength(1);
    expect(disk.records[0].ledger[0].costRevisions[0].previous.usage).toEqual(reported);
    expect(calls).toBe(0);
  });
});
