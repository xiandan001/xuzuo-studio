import { readLiveHistory } from './live-history-test-helper';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LiveSnapshot } from '../live-types';
const require = createRequire(import.meta.url);
interface Engine { snapshot: () => Promise<LiveSnapshot>; recalculateCosts: () => Promise<{ updated: number }>; shutdown: () => Promise<void>; }
const { createLiveWorkflowEngine } = require('../../electron/live-workflow-engine.cjs') as { createLiveWorkflowEngine: (options: Record<string, unknown>) => Engine };
const fx = { base: 'USD', quote: 'CNY', rate: '6.661635220126', date: '2026-10-29', source: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml', kind: 'reference' };
function record() {
  const pricing = { unit: 'million-tokens', currency: 'USD', input: '', output: '', referenceOnly: true, officialUrl: 'https://developers.openai.com/api/docs/pricing', verifiedAt: '2026-10-30' };
  const steps = [{ id: 'generate', name: '初次生成', kind: 'image-generation', enabled: true, modelConfigId: 'model', prompt: '内容', inputSource: 'project' }];
  return {
    run: { id: 'run', projectId: 'project', workspaceId: 'workspace', workflowId: 'workflow', workflowName: '已有文生图', status: 'complete', snapshot: { id: 'workflow', steps }, stepIndex: 1, createdAt: '2026-10-30T03:59:09.496Z', updatedAt: '2026-10-30T03:59:09.496Z', attempts: [{ id: 'attempt', stepId: 'generate', modelLabel: '官方生图 · gpt-image-2.5-sunburst', status: 'complete', costCents: 0, costState: 'unknown', startedAt: '2026-10-30T03:59:09.496Z' }] },
    request: { workflow: { steps }, project: { id: 'project' }, connections: [{ id: 'connection', name: '官方', providerId: 'openai', protocol: 'openai-responses', baseUrl: 'https://api.openai.com/v1', enabled: true }], models: [{ id: 'model', name: '官方生图', modelId: 'gpt-image-2.5-sunburst', connectionId: 'connection', pricing, enabled: true }], attachmentIds: [] },
    ledger: [{ id: 'entry', projectId: 'project', costCents: 0, costState: 'unknown', status: 'complete', billingMode: 'live', time: '2026-10-30T03:59:09.496Z', workflowStepId: 'generate', workflowAttemptId: 'attempt', pricingSnapshot: pricing, usage: { inputTokens: 30, outputTokens: 196, images: 1, providerRequestId: 'req-existing' } }],
  };
}
async function fixture(item = record(), bindIdentity = true) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-billing-history-'));
  const filename = path.join(directory, 'live-workflows-v1.json');
  await fs.writeFile(filename, JSON.stringify({ version: 1, records: [item] }), 'utf8');
  let modelCalls = 0;
  const options = { directory, recoverInterrupted: false, legacyBillingBindings: bindIdentity ? { entry: { modelId: item.request.models[0].modelId, operation: item.run.snapshot.steps[0].kind, connection: item.request.connections[0] } } : {}, credentials: { list: async () => [] }, artifactStore: {}, modelRuntime: { execute: async () => { modelCalls++; throw new Error('不能调用模型'); } }, fxRates: { get: async () => fx, refresh: async () => false } };
  const engine = createLiveWorkflowEngine(options);
  return { engine, directory, filename, options, modelCalls: () => modelCalls };
}
describe('已有调用的自动费用恢复', () => {
  it('SVG图片与作者费率一起落盘，重启和主动复算不受当前作者调价影响且不调用模型', async () => {
    const { resolveOfficialBillingRule } = require('../../electron/official-billing.cjs');
    const registry = require('../../electron/billing-rules.json');
    const item = record();
    const time = '2026-11-05T03:00:00.000Z';
    item.run.createdAt = item.run.updatedAt = item.run.attempts[0].startedAt = item.ledger[0].time = time;
    item.request.models[0].modelId = 'gpt-image-2.6-sunburst';
    item.request.models[0].pricing.verifiedAt = '2026-11-05';
    const context = { modelId: item.request.models[0].modelId, operation: 'image-generation', connection: item.request.connections[0], startedAt: time };
    Object.assign(item.ledger[0], { modelId: context.modelId, operation: context.operation, billingConnectionSnapshot: context.connection, billingRuleSnapshot: resolveOfficialBillingRule(context, item.request.models[0].pricing) });
    Object.assign(item.ledger[0].usage, { imageOutputFormat: 'svg', svgUsage: { model: 'gpt-6.1-sol', inputTokens: 100, outputTokens: 200, reasoningTokens: 150, totalTokens: 300 } });
    const f = await fixture(item);
    const entry = (await f.engine.snapshot()).ledger[0];
    expect(entry).toMatchObject({ costState: 'calculated', calculation: { nativeAmount: '0.00823', completeness: 'complete' }, usage: { svgUsage: { model: 'gpt-6.1-sol', reasoningTokens: 150 } } });
    const disk = await readLiveHistory(f.directory);
    const frozen = disk.records[0].ledger[0].billingRuleSnapshot;
    expect(frozen.svgAuthorRules.find((rule: { modelId: string }) => rule.modelId === 'gpt-6.1-sol').rates.output).toBe('10');
    await f.engine.shutdown();
    const author = registry.rules.find((rule: { modelId: string }) => rule.modelId === 'gpt-6.1-sol');
    const rates = { ...author.rates };
    try {
      author.rates.input = author.rates.output = '999';
      const reopened = createLiveWorkflowEngine(f.options);
      try {
        expect((await reopened.snapshot()).ledger[0].calculation?.nativeAmount).toBe('0.00823');
        expect(await reopened.recalculateCosts()).toEqual({ updated: 0 });
        expect((await readLiveHistory(f.directory)).records[0].ledger[0].billingRuleSnapshot).toEqual(frozen);
        expect(f.modelCalls()).toBe(0);
      } finally { await reopened.shutdown(); }
    } finally { author.rates = rates; }
  });
  it('相同条目准确恢复 $0.00603，保留原价、请求ID和旧金额，重复与重启不重复修订', async () => {
    const f = await fixture();
    const snapshot = await f.engine.snapshot();
    expect(snapshot.ledger).toHaveLength(1);
    expect(snapshot.ledger[0]).toMatchObject({ id: 'entry', costState: 'calculated', costCents: 5, calculation: { nativeCurrency: 'USD', nativeAmount: '0.00603', cnyAmount: '0.04016966037735978', completeness: 'complete' }, usage: { inputTextTokens: 30, inputImageTokens: 0, outputImageTokens: 196, providerRequestId: 'req-existing' } });
    const disk = await readLiveHistory(f.directory);
    expect(disk.records[0].ledger[0].pricingSnapshot.referenceOnly).toBe(true);
    expect(disk.records[0].ledger[0].costRevisions).toHaveLength(1);
    expect(disk.records[0].ledger[0].costRevisions[0].previous).toMatchObject({ costCents: 0, costState: 'unknown' });
    expect(await f.engine.recalculateCosts()).toEqual({ updated: 0 });
    expect(f.modelCalls()).toBe(0);
    await f.engine.shutdown();
    const reopened = createLiveWorkflowEngine(f.options); await reopened.snapshot();
    expect((await readLiveHistory(f.directory)).records[0].ledger[0].costRevisions).toHaveLength(1);
    await reopened.shutdown();
  });
  it('人工金额、历史编辑缺少拆分、代理连接不冒用官方费用', async () => {
    for (const kind of ['manual', 'editing', 'proxy', 'missing-identity']) {
      const item = record();
      if (kind === 'manual') { item.ledger[0].costState = 'manual'; item.ledger[0].costCents = 88; }
      if (kind === 'editing') { item.run.snapshot.steps[0].kind = 'image-editing'; item.request.workflow.steps[0].kind = 'image-editing'; }
      if (kind === 'proxy') item.request.connections[0].baseUrl = 'https://example.com/v1';
      const f = await fixture(item, kind !== 'missing-identity');
      const entry = (await f.engine.snapshot()).ledger[0];
      expect(entry.calculation).toBeUndefined(); expect(entry.costCents).toBe(kind === 'manual' ? 88 : 0);
      expect(f.modelCalls()).toBe(0); await f.engine.shutdown();
    }
  });
});
