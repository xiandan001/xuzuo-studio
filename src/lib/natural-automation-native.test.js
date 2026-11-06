import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const { createAutomationPlanning } = require('../../electron/automation-planning.cjs');
const { createAutomationCenter } = require('../../electron/automation-center.cjs');
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
const { createLiveWorkflowEngine } = require('../../electron/live-workflow-engine.cjs');
const { createModelRuntime } = require('../../electron/model-runtime.cjs');
const { remap, createIdMap } = require('../../electron/backup-format.cjs');
const { mergeAutomationBackup } = require('../../electron/automation-backup.cjs');
const { ruleCreationFingerprint } = require('../../electron/automation-rule-identity.cjs');
const { parseNaturalAutomationPlan } = require('../../electron/natural-automation-plan.runtime.cjs');
const roots = [], services = [], releases = [], base = path.resolve('work');
const input = { id: 'plan-one', workspaceId: 'workspace', projectId: 'project', modelConfigId: 'text-model', credentialId: 'qa-metadata-key', input: '帮我制作一张产品宣传图，自动检查并精修一轮' };
const plan = { version: 1, name: '产品宣传', objective: '生成并精修', outputKind: 'image', trigger: { type: 'manual' }, steps: [{ kind: 'image-generation', name: '初稿', instruction: '制作产品海报' }], illustrations: { mode: 'none', count: 0 }, acceptance: ['画面可读'], constraints: [], maxRepairs: 1, questions: [], unsupported: [] };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
afterEach(async () => { for (const release of releases.splice(0)) release(); for (const service of services.splice(0).reverse()) await service.shutdown(); for (const root of roots.splice(0)) { if (path.dirname(root) !== base || (await fs.realpath(root)).toLowerCase() !== root.toLowerCase()) throw Error('Unowned natural automation fixture'); await fs.rm(root, { recursive: true, force: true }); } });
async function until(read, accept) { const deadline = Date.now() + 4000; while (Date.now() < deadline) { const result = await read(); if (accept(result)) return result; await new Promise(resolve => setTimeout(resolve, 5)); } throw Error('Planning fixture did not settle'); }
async function fixture({ response = JSON.stringify(plan), startOverride, controlOverride, fetchOverride } = {}) {
  const root = await fs.mkdtemp(path.join(base, 'natural-automation-')); roots.push(root); const calls = [];
  const credentials = { list: async () => [{ id: 'qa-metadata-key', name: 'fixture', connectionId: 'connection', enabled: true }], withSecret: async (_key, _connection, action) => action('isolated-fixture-value') };
  const project = { id: 'project', workspaceId: 'workspace', name: '已登记项目', kind: 'image', description: '', costCents: 0, version: 0, status: 'draft' };
  const connection = { id: 'connection', name: 'isolated', protocol: 'openai-chat', providerId: 'custom', baseUrl: 'http://127.0.0.1:9000/v1', enabled: true };
  const models = [{ id: 'text-model', name: 'isolated-text', modelId: 'qa-text', connectionId: 'connection', enabled: true, capabilities: ['text', 'vision'], pricing: { unit: 'million-tokens', currency: 'CNY', input: '1000', output: '1000' } }, { id: 'image-model', name: 'isolated-image', modelId: 'qa-image', connectionId: 'connection', enabled: true, capabilities: ['image-generation', 'image-editing'], pricing: { unit: 'image', currency: 'CNY', input: '', output: '0.10' } }];
  const artifacts = createArtifactStore({ directory: path.join(root, 'artifacts') });
  const fetchImpl = async (url, options) => { calls.push({ url, options }); if (fetchOverride) return fetchOverride(url, options); return new Response(JSON.stringify({ id: 'qa-response-' + calls.length, choices: [{ message: { content: response }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50 } }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  const runtime = createModelRuntime({ credentialStore: credentials, artifactStore: artifacts, directory: root, fetchImpl });
  const engine = createLiveWorkflowEngine({ directory: root, credentials, artifactStore: artifacts, modelRuntime: runtime }); services.push(engine);
  const center = createAutomationCenter({ directory: root, liveEngine: engine, start: value => engine.start(value), control: value => engine.control(value) }); services.push(center);
  const workflow = { id: 'production-flow', workspaceId: 'workspace', name: '已有生产流程', outputKind: 'image', steps: [{ id: 'make', name: '制作', kind: 'image-generation', enabled: true, inputSource: 'project', prompt: '制作', modelConfigId: 'image-model', credentialId: 'qa-metadata-key' }] };
  await center.syncContext({ workspaceId: 'workspace', workspaces: [{ id: 'workspace', name: '当前工作区' }, { id: 'other', name: '其他' }], projects: [project], workflows: [workflow], models, connections: [connection] });
  const options = { directory: root, liveEngine: engine, automationCenter: center, credentials, start: startOverride ? request => startOverride(request, engine) : value => engine.start(value), control: controlOverride ? request => controlOverride(request, engine) : value => engine.control(value) };
  const service = createAutomationPlanning(options); services.push(service);
  return { root, service, options, center, engine, runtime, artifacts, credentials, calls, project, models, connection, workflow };
}

describe('真实引擎内的自然语言规划', () => {
  it('单次收费规划持久化原始结果，双击/重开/读取不重复请求，不创建规则或成品', async () => {
    const f = await fixture(); const [first, same] = await Promise.all([f.service.start(input), f.service.start(input)]); expect(first.id).toBe(same.id);
    const result = await until(() => f.service.read(input), value => value.status === 'complete');
    expect(JSON.parse(result.resultText)).toEqual(plan); expect(f.calls).toHaveLength(1);
    expect(result.modelConfigId).toBe(input.modelConfigId); expect(result.credentialId).toBe(input.credentialId); expect(result).not.toHaveProperty('fingerprint'); expect(result).not.toHaveProperty('dispatchKey');
    const snapshot = await f.engine.snapshot(); expect(snapshot.runs[0].purpose).toBe('automation-plan'); expect(snapshot.ledger).toHaveLength(1); expect(snapshot.ledger[0].costState).toBe('calculated'); expect(snapshot.ledger[0].costCents).toBe(15);
    expect(snapshot.runs[0].snapshot.steps).toHaveLength(1); expect(snapshot.runs[0].snapshot.steps[0].role).toBe('planner');
    expect(snapshot.runs[0].snapshot.steps[0].prompt).toContain('"trigger":{"type":"manual"}'); expect(snapshot.runs[0].snapshot.steps[0].prompt).not.toContain('"intervalMinutes":60'); expect(snapshot.runs[0].snapshot.steps[0].prompt).toContain('暂缺品牌名、产品图');
    expect((await f.center.snapshot('workspace')).rules).toEqual([]);
    const reopened = createAutomationPlanning(f.options); services.push(reopened); expect((await reopened.start(input)).runId).toBe(result.runId); expect((await reopened.list('workspace'))[0].resultText).toBeUndefined(); expect((await reopened.read(input)).resultText).toBe(result.resultText); expect(f.calls).toHaveLength(1);
    await expect(reopened.start({ ...input, input: '改需求但复用编号' })).rejects.toThrow('已经变化'); await expect(reopened.read({ ...input, workspaceId: 'other' })).rejects.toThrow('不属于');
  });
  it('错误JSON保留真实收费与原文，不自动调用修复，也不创建可执行配置', async () => {
    const f = await fixture({ response: 'not json' }); await f.service.start(input);
    const result = await until(() => f.service.read(input), value => value.status === 'failed');
    expect(result.resultText).toBe('not json'); expect(result.runId).toBeTruthy(); expect(f.calls).toHaveLength(1);
    expect((await f.engine.snapshot()).ledger[0].costCents).toBe(15); expect((await f.service.start(input)).status).toBe('failed'); expect(f.calls).toHaveLength(1);
  });
  it.each([
    ['JSON代码围栏', () => '```json\n' + JSON.stringify(plan) + '\n```'],
    ['manual无用默认参数', () => JSON.stringify({ ...plan, trigger: { type: 'manual', intervalMinutes: 60, sourceWorkflowId: null } })],
    ['缺可选空数组', () => { const result = { ...plan }; delete result.constraints; delete result.questions; delete result.unsupported; return JSON.stringify(result); }],
  ])('常见模型格式仅本地规范化：%s，原文/费用保留且不重发', async (_name, response) => {
    const raw = response(), f = await fixture({ response: raw }); await f.service.start(input);
    const result = await until(() => f.service.read(input), value => ['complete', 'failed'].includes(value.status)); expect(result.status, result.error).toBe('complete'); expect(result.resultText).toBe(raw); expect(parseNaturalAutomationPlan(result.resultText).objective).toBe(plan.objective);
    expect((await f.service.start(input)).runId).toBe(result.runId); await f.service.read(input); expect(f.calls).toHaveLength(1); expect((await f.engine.snapshot()).ledger[0].costCents).toBe(15); expect((await f.center.snapshot('workspace')).rules).toEqual([]);
  });
  it('旧版本已付费的围栏结果可免费重读恢复，不要求用户重新让AI规划', async () => {
    const raw = '```json\n' + JSON.stringify(plan) + '\n```', f = await fixture({ response: raw });
    const legacy = createAutomationPlanning({ ...f.options, parsePlan: () => { throw Error('old strict parser'); } }); services.push(legacy); await legacy.start(input);
    const failed = await until(() => legacy.read(input), value => value.status === 'failed');
    const upgraded = createAutomationPlanning(f.options); services.push(upgraded); const recovered = await upgraded.read(input); expect(recovered.status).toBe('complete'); expect(recovered.runId).toBe(failed.runId); expect(recovered.resultText).toBe(raw); expect(f.calls).toHaveLength(1); expect((await f.engine.snapshot()).ledger).toHaveLength(1);
  });
  it.each([{ ...plan, enabled: true }, { ...plan, trigger: { type: 'cron', expression: '0 9 * * *' } }])('强结构越界不会形成执行配置：%j', async response => {
    const f = await fixture({ response: JSON.stringify(response) }); await f.service.start(input); const result = await until(() => f.service.read(input), value => value.status === 'failed');
    expect(result.resultText).toBe(JSON.stringify(response)); expect(f.calls).toHaveLength(1); expect((await f.center.snapshot('workspace')).rules).toEqual([]); expect((await f.engine.snapshot()).ledger).toHaveLength(1);
  });
  it('合法澄清与不支持项可显示，额外renderer模型/项目对象不会改变真实计费归属', async () => {
    const response = { ...plan, questions: ['是否提供商品图片？'], unsupported: ['邮件发布暂不支持'] }, f = await fixture({ response: JSON.stringify(response) });
    await f.service.start({ ...input, project: { id: 'outside' }, models: [{ id: 'outside-model' }], connections: [{ baseUrl: 'https://outside.invalid' }] });
    const result = await until(() => f.service.read(input), value => value.status === 'complete'); expect(JSON.parse(result.resultText).questions).toEqual(response.questions); expect(f.calls[0].url).toContain('127.0.0.1'); expect(JSON.parse(f.calls[0].options.body).model).toBe('qa-text'); expect((await f.engine.snapshot()).ledger[0].projectId).toBe('project');
  });
  it('当前Word项目只承担规划费用，用户明确要宣传图时保留图片方案且不迁移费用', async () => {
    const f = await fixture(); await f.center.syncContext({ workspaceId: 'workspace', workspaces: [{ id: 'workspace' }, { id: 'other' }], projects: [{ ...f.project, kind: 'word' }], workflows: [{ ...f.workflow, outputKind: 'word' }, { ...f.workflow, id: 'image-source', name: '本区图片流程' }, { ...f.workflow, id: 'foreign-flow', workspaceId: 'other', name: '其他工作区流程' }], models: f.models, connections: [f.connection] });
    await f.service.start(input); const result = await until(() => f.service.read(input), value => value.status === 'complete'), snapshot = await f.engine.snapshot();
    expect(JSON.parse(result.resultText).outputKind).toBe('image'); expect(snapshot.runs[0].snapshot.outputKind).toBe('word'); expect(snapshot.runs[0].snapshot.steps[0].prompt).toContain('当前项目仅归属规划费用，不限制方案产物类型'); expect(snapshot.runs[0].input).toContain('"id":"image-source"'); expect(snapshot.runs[0].input).not.toContain('foreign-flow'); expect(snapshot.ledger[0].projectId).toBe('project'); expect(f.calls).toHaveLength(1); expect((await f.center.snapshot('workspace')).rules).toEqual([]);
  });
  it('即使模型吞掉原句日历要求，本地仍明确告知未支持并保留原始规划和费用', async () => {
    const f = await fixture(), request = { ...input, input: '每天9点制作宣传海报' }; await f.service.start(request);
    const result = await until(() => f.service.read(request), value => value.status === 'complete'); expect(result.error).toBeTruthy(); expect(result.error).toMatch(/日历|时刻|间隔|定时/); expect(JSON.parse(result.resultText)).toEqual(plan); expect(f.calls).toHaveLength(1); expect((await f.engine.snapshot()).ledger[0].costCents).toBe(15); expect((await f.center.snapshot('workspace')).rules).toEqual([]);
  });
  it('先保存run绑定再取消，迟到ACK及取消失败不会假称已经取消', async () => {
    let release, entered, requestEntered; const held = new Promise(resolve => { release = resolve; releases.push(resolve); }), started = new Promise(resolve => { entered = resolve; }), requestStarted = new Promise(resolve => { requestEntered = resolve; });
    const f = await fixture({ startOverride: async (request, engine) => { const run = await engine.start(request); entered(); await held; return run; }, controlOverride: async () => { throw Error('cancel transport unavailable'); }, fetchOverride: async (_url, options) => new Promise((_resolve, reject) => { options.signal.addEventListener('abort', () => reject(Error('fixture cancelled')), { once: true }); requestEntered(); }) });
    const pending = f.service.start(input); await started; await requestStarted;
    const cancelled = await f.service.cancel(input); expect(cancelled.status).toBe('cancelling'); release();
    const late = await pending; expect(late.runId).toBeTruthy(); expect(late.status).toBe('cancelling'); expect(late.error).toContain('取消'); expect((await f.engine.runDetail(late.runId)).status).toBe('running'); expect(f.calls).toHaveLength(1);
    await f.engine.control({ id: late.runId, action: 'cancel' });
    expect((await until(() => f.service.read(input), value => value.status === 'cancelled')).runId).toBe(late.runId); expect((await f.engine.snapshot()).ledger).toHaveLength(1);
  });
  it('派发ACK丢失后凭dispatchKey读取已有run，重复start不重新发送', async () => {
    const f = await fixture({ startOverride: async (request, engine) => { await engine.start(request); throw Error('ACK lost'); } }); await f.service.start(input);
    const result = await until(() => f.service.read(input), value => value.status === 'complete'); expect(result.runId).toBeTruthy(); await f.service.start(input); expect(f.calls).toHaveLength(1);
  });
  it('中断重启后仅恢复已保存记录，不自动重新规划或清除原费用流水', async () => {
    const f = await fixture({ fetchOverride: async (_url, options) => new Promise((_resolve, reject) => { options.signal.addEventListener('abort', () => reject(Error('interrupted fixture')), { once: true }); }) });
    const started = await f.service.start(input); await until(async () => f.calls.length, count => count === 1); await f.engine.shutdown(); await f.service.shutdown();
    const engine = createLiveWorkflowEngine({ directory: f.root, credentials: f.credentials, artifactStore: f.artifacts, modelRuntime: f.runtime }); services.push(engine);
    const reopened = createAutomationPlanning({ ...f.options, liveEngine: engine, start: request => engine.start(request), control: request => engine.control(request) }); services.push(reopened);
    expect((await reopened.read(input)).status).toBe('interrupted'); expect((await reopened.start(input)).runId).toBe(started.runId); expect(f.calls).toHaveLength(1);
    const snapshot = await engine.snapshot(); expect(snapshot.ledger).toHaveLength(1); expect(snapshot.ledger[0].costState).toBe('unknown');
  });
  it('回执已保存但执行结果未提交时，重启仅读取原回执补同一账本，0新增模型请求', async () => {
    const f = await fixture(); let release, received; const gate = new Promise(resolve => { release = resolve; releases.push(resolve); }), saved = new Promise(resolve => { received = resolve; });
    const originalExecute = f.runtime.execute; f.runtime.execute = async (...args) => { const result = await originalExecute(...args); received(); await gate; return result; };
    const started = await f.service.start(input); await saved; const before = await f.engine.snapshot(); expect(before.ledger).toHaveLength(1);
    const copy = await fs.mkdtemp(path.join(base, 'natural-automation-')); roots.push(copy); await fs.cp(f.root, copy, { recursive: true });
    const artifacts = createArtifactStore({ directory: path.join(copy, 'artifacts') }); let calls = 0;
    const runtime = createModelRuntime({ credentialStore: { ...f.credentials, withSecret: async () => { throw Error('Free receipt recovery cannot read secret'); } }, artifactStore: artifacts, directory: copy, fetchImpl: async () => { calls++; throw Error('No new requests'); } });
    const engine = createLiveWorkflowEngine({ directory: copy, credentials: f.credentials, artifactStore: artifacts, modelRuntime: runtime }); services.push(engine);
    const service = createAutomationPlanning({ ...f.options, directory: copy, liveEngine: engine, start: async () => { throw Error('Cannot start on read'); } }); services.push(service);
    const recovered = await service.read(input); expect(recovered.runId).toBe(started.runId); expect(recovered.status).toBe('complete'); expect(JSON.parse(recovered.resultText)).toEqual(plan);
    const after = await engine.snapshot(); expect(after.ledger).toHaveLength(1); expect(after.ledger[0].id).toBe(before.ledger[0].id); expect(after.ledger[0].workflowAttemptId).toBe(before.ledger[0].workflowAttemptId); expect(after.ledger[0].costCents).toBe(15); expect(after.ledger[0].usage.inputTokens).toBe(100); expect(calls).toBe(0); expect(f.calls).toHaveLength(1); release();
  });
  it('原费用流水缺失时保留中断状态，不读取回执补造账本或创建新请求', async () => {
    const f = await fixture(); await f.service.start(input); const complete = await until(() => f.service.read(input), value => value.status === 'complete');
    const [record] = await f.engine.exportRecords(['project']); record.run.status = 'interrupted'; record.ledger = []; let receiptReads = 0;
    const engine = createLiveWorkflowEngine({ directory: path.join(f.root, 'missing-ledger'), credentials: f.credentials, artifactStore: f.artifacts, modelRuntime: { supports: f.runtime.supports, execute: async () => { throw Error('Cannot create request'); }, recoverReceipt: async () => { receiptReads++; throw Error('Cannot recover without original ledger'); } } }); services.push(engine);
    await engine.importRecords([record]); const result = await engine.recoverPlanningReceipt(complete.runId); expect(result.status).toBe('interrupted'); expect(result.error).toContain('费用流水'); expect(receiptReads).toBe(0); expect((await engine.snapshot()).ledger).toEqual([]); expect(result.attempts).toHaveLength(1);
  });
  it('规划记录首次持久化失败时绝不发送收费请求', async () => {
    const f = await fixture(), failed = createAutomationPlanning({ ...f.options, directory: path.join(f.root, 'failed'), fileSystem: { ...fs, writeFile: async () => { throw Error('fixture disk denied'); } } }); services.push(failed);
    await expect(failed.start(input)).rejects.toThrow('disk denied'); expect(f.calls).toEqual([]); expect((await f.engine.snapshot()).ledger).toEqual([]);
  });
  it('取消迟到时后台已经完成，显示完成并保留费用而不冒称撤回', async () => {
    let entered, release; const waiting = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; releases.push(resolve); });
    const f = await fixture({ startOverride: async (request, engine) => { const run = await engine.start(request); await until(() => engine.runDetail(run.id), value => value.status === 'complete'); entered(); await gate; return run; } });
    const pending = f.service.start(input); await waiting; expect((await f.service.cancel(input)).status).toBe('complete'); release(); const late = await pending;
    expect(late.status).toBe('complete'); expect(late.error).toContain('费用保留'); expect(f.calls).toHaveLength(1); expect((await f.engine.snapshot()).ledger[0].costCents).toBe(15);
  });
  it('creationKey只创建未启用规则，未知ACK重试返回原规则且不关闭已启用状态', async () => {
    const f = await fixture(), draft = { creationKey: 'stable-create', workspaceId: 'workspace', projectId: 'project', workflowId: f.workflow.id, name: 'AI生成规则', enabled: false, trigger: 'manual', input: '制作', variables: {} };
    const first = await f.center.saveRule(draft); await f.center.setEnabled({ id: first.id, enabled: true });
    const same = await f.center.saveRule(draft); expect(same.id).toBe(first.id); expect(same.enabled).toBe(true); expect(same.name).toBe(first.name);
    await expect(f.center.saveRule({ ...draft, name: '编号复用但改内容' })).rejects.toThrow('内容已变化');
    const edited = await f.center.saveRule({ ...draft, creationKey: undefined, id: first.id, name: '手动编辑', enabled: true }); expect(edited.creationKey).toBe(draft.creationKey);
    await expect(f.center.saveRule({ ...draft, id: first.id, creationKey: 'changed-key' })).rejects.toThrow('不能更改');
    await expect(f.center.saveRule({ ...draft, creationKey: 'new-create', enabled: true })).rejects.toThrow('未启用');
    const ids = createIdMap({ id: 'one', creationKey: 'stable-create', imageSourceStepId: 'image-first', steps: [{ id: 'image-first' }] });
    expect(remap({ creationKey: 'stable-create', imageSourceStepId: 'image-first', input: 'image-first' }, ids)).toEqual({ creationKey: ids['stable-create'], imageSourceStepId: ids['image-first'], input: 'image-first' });
  });
  it('缺少制作模型和资料可以保存停用草稿，显式触发仍先免费预检且不会派发收费请求', async () => {
    const f = await fixture(), workflow = { ...f.workflow, id: 'draft-without-bindings', steps: [{ id: 'edit', name: '待补原图和模型的精修', kind: 'image-editing', prompt: '根据用户提供的实际原图精修', inputSource: 'project', enabled: true }] };
    await f.center.syncContext({ workspaceId: 'workspace', workspaces: [{ id: 'workspace', name: '本区' }], projects: [f.project], workflows: [workflow], models: f.models, connections: [f.connection] });
    const rule = await f.center.saveRule({ creationKey: 'disabled-draft', workspaceId: 'workspace', projectId: 'project', workflowId: workflow.id, name: '等使用时补设置', enabled: false, trigger: 'manual', input: '精修用户提供的商品图', variables: {} });
    expect(rule.enabled).toBe(false); expect((await f.center.snapshot('workspace')).jobs).toEqual([]); expect(f.calls).toEqual([]); expect((await f.engine.snapshot()).ledger).toEqual([]);
    await expect(f.center.trigger({ ruleId: rule.id })).rejects.toThrow(/模型|图片|检查/); await expect(f.center.setEnabled({ id: rule.id, enabled: true })).rejects.toThrow(/模型|图片|检查/);
    expect((await f.center.snapshot('workspace')).jobs).toEqual([]); expect((await f.center.snapshot('workspace')).rules[0].enabled).toBe(false); expect(f.calls).toEqual([]); expect((await f.engine.snapshot()).ledger).toEqual([]); expect((await f.engine.snapshot()).runs).toEqual([]);
  });
  it('未答资料可存草稿但原生启用/保存启用/直接运行全部拒绝；补答后才发送生产请求', async () => {
    const f = await fixture({ fetchOverride: async () => new Response(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }), { status: 200, headers: { 'content-type': 'application/json' } }) });
    const draft = { creationKey: 'prepared-draft', workspaceId: 'workspace', projectId: 'project', workflowId: f.workflow.id, name: '等待品牌资料', enabled: false, trigger: 'manual', input: '制作宣传图', variables: {}, preparation: { questions: ['品牌名称？'], answers: {} } };
    const rule = await f.center.saveRule(draft);
    await expect(f.center.setEnabled({ id: rule.id, enabled: true })).rejects.toThrow('补资料'); await expect(f.center.saveRule({ ...draft, id: rule.id, enabled: true })).rejects.toThrow('补资料'); await expect(f.center.trigger({ ruleId: rule.id })).rejects.toThrow('补资料');
    const withoutField = { ...draft, id: rule.id, name: '手动改名', preparation: undefined }; const edited = await f.center.saveRule(withoutField); expect(edited.preparation).toEqual(draft.preparation); expect(edited.creationFingerprint).toBe(rule.creationFingerprint); expect(f.calls).toEqual([]); expect((await f.center.snapshot('workspace')).jobs).toEqual([]);
    const answered = await f.center.saveRule({ ...withoutField, input: '制作宣传图，品牌名称：春禾', preparation: { questions: ['品牌名称？'], answers: { '品牌名称？': '春禾' } } });
    await f.center.setEnabled({ id: rule.id, enabled: true }); expect(f.calls).toEqual([]); await f.center.trigger({ ruleId: rule.id });
    const done = await until(async () => { await f.center.tick(); return f.center.snapshot('workspace'); }, value => value.jobs[0]?.status === 'complete');
    expect(done.jobs[0].ruleSnapshot.preparation).toEqual(answered.preparation); expect(f.calls).toHaveLength(1); expect(JSON.parse(f.calls[0].options.body).prompt).toContain('春禾'); expect((await f.engine.snapshot()).ledger).toHaveLength(1);
  });
  it('导入触发允许等待未来原图，但不忽略缺模型/Key/结构，手动运行仍需要真实图片', async () => {
    const f = await fixture(), workflow = { ...f.workflow, id: 'future-picture', steps: [{ id: 'edit', name: '精修导入图片', kind: 'image-editing', prompt: '精修商品图', inputSource: 'project', modelConfigId: 'image-model', credentialId: input.credentialId, enabled: true }] };
    const context = { workspaceId: 'workspace', workspaces: [{ id: 'workspace' }], projects: [f.project], workflows: [workflow], models: f.models, connections: [f.connection] }; await f.center.syncContext(context);
    const draft = { workspaceId: 'workspace', projectId: 'project', workflowId: workflow.id, name: '导入后制作', enabled: false, trigger: 'reference-imported', input: '精修导入图片', variables: {} }, rule = await f.center.saveRule(draft);
    await f.center.setEnabled({ id: rule.id, enabled: true }); expect((await f.center.snapshot('workspace')).rules[0].enabled).toBe(true); await expect(f.center.trigger({ ruleId: rule.id })).rejects.toThrow('参考图片'); expect(f.calls).toEqual([]);
    await f.center.setEnabled({ id: rule.id, enabled: false });
    for (const patch of [{ modelConfigId: undefined }, { credentialId: 'unavailable-key' }, { inputSource: 'previous' }]) { await f.center.syncContext({ ...context, workflows: [{ ...workflow, steps: [{ ...workflow.steps[0], ...patch }] }] }); await expect(f.center.setEnabled({ id: rule.id, enabled: true })).rejects.toThrow(/模型|Key|第一个|预检/); expect((await f.center.snapshot('workspace')).rules[0].enabled).toBe(false); }
    expect(f.calls).toEqual([]); expect((await f.engine.snapshot()).ledger).toEqual([]);
  });
  it('免费启用预检的迟到结果不能覆盖期间已改变的模型配置', async () => {
    const f = await fixture(), rule = await f.center.saveRule({ workspaceId: 'workspace', projectId: 'project', workflowId: f.workflow.id, name: '等待检查', enabled: false, trigger: 'manual', input: '制作宣传图', variables: {} });
    let release, entered; const gate = new Promise(resolve => { release = resolve; releases.push(resolve); }), started = new Promise(resolve => { entered = resolve; }), preflight = f.engine.preflight;
    f.engine.preflight = async request => { entered(); await gate; return preflight(request); };
    const pending = f.center.setEnabled({ id: rule.id, enabled: true }), rejected = expect(pending).rejects.toThrow('检查期间已变化'); await started;
    await f.center.syncContext({ workspaceId: 'workspace', workspaces: [{ id: 'workspace' }], projects: [f.project], workflows: [f.workflow], models: f.models.map(model => ({ ...model, enabled: false })), connections: [f.connection] }); release(); await rejected;
    expect((await f.center.snapshot('workspace')).rules[0].enabled).toBe(false); expect(f.calls).toEqual([]); expect((await f.engine.snapshot()).ledger).toEqual([]);
  });
  it('启用检查尚未返回时再次点停用，即使字段值原本就是false也不会被迟到检查重新启用', async () => {
    const f = await fixture(), rule = await f.center.saveRule({ workspaceId: 'workspace', projectId: 'project', workflowId: f.workflow.id, name: '等待检查', enabled: false, trigger: 'manual', input: '制作', variables: {} });
    let release, entered; const gate = new Promise(resolve => { release = resolve; releases.push(resolve); }), started = new Promise(resolve => { entered = resolve; }), preflight = f.engine.preflight;
    f.engine.preflight = async request => { entered(); await gate; return preflight(request); };
    const pending = f.center.setEnabled({ id: rule.id, enabled: true }), rejected = expect(pending).rejects.toThrow('检查期间已变化'); await started; await f.center.setEnabled({ id: rule.id, enabled: false }); release(); await rejected;
    expect((await f.center.snapshot('workspace')).rules[0].enabled).toBe(false); expect(f.calls).toEqual([]);
  });
  it('备份恢复重映射创建编号与项目ID后重算创建指纹，原始草稿不能误认新规则', async () => {
    const f = await fixture(); const rule = await f.center.saveRule({ creationKey: 'backup-create', workspaceId: 'workspace', projectId: 'project', workflowId: f.workflow.id, name: '原规则', enabled: false, trigger: 'manual', input: '原目标', variables: {}, preparation: { questions: ['projectId'], answers: { projectId: 'project' } } });
    const backup = await f.center.backupEntries({ workspaceIds: ['workspace'], projectIds: ['project'] }), idMap = createIdMap(backup);
    const empty = { context: { workspaces: [], projects: [], workflows: [], models: [], connections: [] }, rules: [], events: [], jobs: [], decisions: [], memories: [] };
    const restored = mergeAutomationBackup(empty, { records: backup, idMap, backupId: 'qa-backup', availableRuns: [] }).state.rules[0];
    expect(restored.creationKey).not.toBe(rule.creationKey); expect(restored.workspaceId).not.toBe(rule.workspaceId); expect(restored.creationFingerprint).toBe(ruleCreationFingerprint(restored)); expect(restored.creationFingerprint).not.toBe(rule.creationFingerprint); expect(restored.enabled).toBe(false);
    expect(restored.preparation).toEqual(rule.preparation);
  });
  it('规划完成不触发生产完成事件，纯读取与保存规则均不产生模型调用', async () => {
    const f = await fixture();
    await f.center.saveRule({ creationKey: 'watch-create', workspaceId: 'workspace', projectId: 'project', workflowId: f.workflow.id, sourceWorkflowId: 'plan-plan-one', name: '只监听真实生产', trigger: 'run-completed', enabled: false, input: '制作', variables: {} });
    const rule = (await f.center.snapshot('workspace')).rules[0]; await f.center.setEnabled({ id: rule.id, enabled: true });
    await f.service.start(input); await until(() => f.service.read(input), value => value.status === 'complete'); await f.center.tick();
    expect((await f.center.snapshot('workspace')).jobs).toEqual([]); expect(f.calls).toHaveLength(1);
  });
  it('真实图片精修请求携带指定初稿，而修改文字来自前一看图步骤，只导出最终图片', async () => {
    const editPayloads = [];
    const f = await fixture({ fetchOverride: async (url, options) => {
      if (url.endsWith('images/edits')) editPayloads.push({ prompt: options.body.get('prompt'), pictures: await Promise.all(options.body.getAll('image[]').map(async file => Buffer.from(await file.arrayBuffer()))) });
      return new Response(JSON.stringify(url.includes('/images/') ? { data: [{ b64_json: PNG.toString('base64') }] } : { id: 'qa-vision', choices: [{ message: { content: '调整标题层次，保留商品主体' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    } });
    const bind = (id, kind, extra = {}) => ({ id, name: id, kind, enabled: true, inputSource: id === 'initial' ? 'project' : 'previous', prompt: '按要求处理图片', modelConfigId: kind.startsWith('image-') ? 'image-model' : 'text-model', credentialId: 'qa-metadata-key', ...extra });
    const workflow = { ...f.workflow, steps: [bind('initial', 'image-generation'), bind('comment', 'vision', { role: 'reviewer' }), bind('edit', 'image-editing', { imageSourceStepId: 'initial' }), bind('final-check', 'vision', { role: 'reviewer' }), { id: 'export', name: '导出最终图', kind: 'export', inputSource: 'previous', enabled: true, prompt: '', contentSourceStepId: 'edit' }, { id: 'human', name: '人工验收', kind: 'manual-review', inputSource: 'previous', enabled: true, prompt: '' }] };
    const request = { project: f.project, workflow, models: f.models, connections: [f.connection], input: '制作一张宣传图并保留原图精修', variables: {}, attachmentIds: [], acknowledgePaidCalls: true, acknowledgeUnknownCost: true };
    expect((await f.engine.preflight(request)).errors).toEqual([]); await f.engine.start(request);
    const snapshot = await until(() => f.engine.snapshot(), value => value.runs[0]?.status === 'waiting-review' || value.runs[0]?.status === 'failed');
    const run = snapshot.runs[0]; expect(run.status, run.error).toBe('waiting-review'); expect(f.calls).toHaveLength(4);
    expect(editPayloads).toHaveLength(1); expect(editPayloads[0].pictures).toEqual([PNG]); expect(editPayloads[0].prompt).toContain('调整标题层次，保留商品主体');
    const initial = run.attempts.find(attempt => attempt.stepId === 'initial').artifacts[0], edited = run.attempts.find(attempt => attempt.stepId === 'edit').artifacts[0], exported = run.attempts.find(attempt => attempt.stepId === 'export').artifacts;
    expect(exported.filter(file => file.kind === 'image').map(file => file.id)).toEqual([edited.id]); expect(exported.some(file => file.id === initial.id)).toBe(false); expect(snapshot.ledger).toHaveLength(4); expect(snapshot.ledger.reduce((sum, entry) => sum + entry.costCents, 0)).toBe(50);
    const invalid = structuredClone(request); invalid.workflow.steps[2].imageSourceStepId = 'final-check'; expect((await f.engine.preflight(invalid)).ok).toBe(false);
    invalid.workflow.steps[2].imageSourceStepId = 'comment'; expect((await f.engine.preflight(invalid)).ok).toBe(false); expect(f.calls).toHaveLength(4);
    const { createDeliverySource } = require('../../electron/delivery-source.cjs');
    const deliverySource = createDeliverySource({ artifactStore: f.artifacts, liveEngine: f.engine, workspaceStorage: { projectDirectory: async () => ({}), list: async () => ({ projects: [{ projectId: 'project', name: '实际成品' }] }) }, editorStore: {}, spreadsheetStore: {} });
    const before = await deliverySource({ projectId: 'project', kind: 'image', artifactIds: [] }); expect(before.files.map(file => file.id)).toEqual([edited.id]);
    await f.engine.control({ id: run.id, action: 'resume' }); await f.service.start(input); await until(() => f.service.read(input), value => value.status === 'failed');
    const after = await deliverySource({ projectId: 'project', kind: 'image', artifactIds: [] }); expect(after.sourceHash).toBe(before.sourceHash); expect(after.files).toEqual(before.files);
  });
  it('精修失败显式续跑仍使用已完成原图和看图意见，原失败费用流水不会消失', async () => {
    let edits = 0; const pictures = [];
    const f = await fixture({ fetchOverride: async (url, options) => {
      if (url.endsWith('images/edits')) { pictures.push(Buffer.from(await options.body.get('image[]').arrayBuffer())); if (++edits === 1) return new Response('{"error":{"message":"fixture unavailable"}}', { status: 503 }); }
      return new Response(JSON.stringify(url.includes('/images/') ? { data: [{ b64_json: PNG.toString('base64') }] } : { id: 'qa-vision', choices: [{ message: { content: '保留原图，改善构图' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    } });
    const bind = (id, kind, extra = {}) => ({ id, name: id, kind, enabled: true, inputSource: id === 'initial' ? 'project' : 'previous', prompt: '处理图片', modelConfigId: kind.startsWith('image-') ? 'image-model' : 'text-model', credentialId: 'qa-metadata-key', ...extra });
    const workflow = { ...f.workflow, steps: [bind('initial', 'image-generation'), bind('comment', 'vision', { role: 'reviewer' }), bind('edit', 'image-editing', { imageSourceStepId: 'initial' }), { id: 'export', name: '交付', kind: 'export', inputSource: 'previous', enabled: true, prompt: '', contentSourceStepId: 'edit' }] };
    const started = await f.engine.start({ project: f.project, workflow, models: f.models, connections: [f.connection], input: '生成与精修', variables: {}, attachmentIds: [], acknowledgePaidCalls: true, acknowledgeUnknownCost: true });
    const failed = await until(() => f.engine.snapshot(), value => value.runs[0]?.status === 'failed'); expect(f.calls).toHaveLength(3); expect(failed.ledger).toHaveLength(3);
    await f.engine.control({ id: started.id, action: 'continue' });
    const done = await until(() => f.engine.snapshot(), value => value.runs[0]?.status === 'complete' || value.runs[0]?.status === 'failed');
    const failedEdit = failed.ledger.find(entry => entry.workflowStepId === 'edit');
    expect(done.runs[0].status, done.runs[0].error).toBe('complete'); expect(pictures).toEqual([PNG, PNG]); expect(f.calls).toHaveLength(4); expect(done.ledger).toHaveLength(4); expect(failedEdit.costState).toBe('unknown'); expect(done.ledger.find(entry => entry.id === failedEdit.id)).toEqual(failedEdit);
  });
  it('图片来源被换成其他项目时阻止实际精修请求，绝不回退成纯文字生图', async () => {
    const f = await fixture({ fetchOverride: async () => new Response(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }), { status: 200, headers: { 'content-type': 'application/json' } }) });
    const runtime = { supports: f.runtime.supports, execute: async (request, options) => { const result = await f.runtime.execute(request, options); if (request.kind === 'image-generation') result.artifacts = [await f.artifacts.write({ name: 'foreign.png', mimeType: 'image/png', buffer: PNG, projectId: 'other-project', runId: request.runId })]; return result; } };
    const engine = createLiveWorkflowEngine({ directory: path.join(f.root, 'foreign-run'), credentials: f.credentials, artifactStore: f.artifacts, modelRuntime: runtime }); services.push(engine);
    const bind = (id, kind, extra = {}) => ({ id, name: id, kind, enabled: true, inputSource: id === 'initial' ? 'project' : 'previous', prompt: '处理图片', modelConfigId: 'image-model', credentialId: 'qa-metadata-key', ...extra });
    await engine.start({ project: f.project, workflow: { ...f.workflow, steps: [bind('initial', 'image-generation'), bind('edit', 'image-editing', { imageSourceStepId: 'initial' })] }, models: f.models, connections: [f.connection], input: '制作和精修', variables: {}, attachmentIds: [], acknowledgePaidCalls: true, acknowledgeUnknownCost: true });
    const failed = await until(() => engine.snapshot(), value => value.runs[0]?.status === 'failed'); expect(failed.runs[0].error).toContain('不属于'); expect(f.calls).toHaveLength(1); expect(f.calls[0].url).toContain('/images/generations'); expect(failed.ledger).toHaveLength(1);
  });
});

describe('规划对话上下文归属、幂等与计费', () => {
  async function completed(f, request = input) { await f.service.start(request); return until(() => f.service.read(request), record => ['complete', 'failed'].includes(record.status)); }
  async function seedJournal(f, change) { const filename = path.join(f.root, 'automation-planning-v1.json'), data = JSON.parse(await fs.readFile(filename, 'utf8')); change(data.records); data.sha256 = createHash('sha256').update(JSON.stringify(data.records)).digest('hex'); await fs.writeFile(filename, JSON.stringify(data)); const service = createAutomationPlanning(f.options); services.push(service); return service; }
  it('换模型续改实际携带父方案/上一用户句/本地修改和资料，每轮独立账本，重开重读不再请求', async () => {
    const f = await fixture(), first = await completed(f); expect(first.status).toBe('complete');
    const secondModel = { ...f.models[0], id: 'text-second', modelId: 'qa-second', pricing: { ...f.models[0].pricing, input: '2000', output: '2000' } };
    await f.center.syncContext({ workspaceId: 'workspace', workspaces: [{ id: 'workspace' }], projects: [f.project], workflows: [f.workflow], models: [...f.models, secondModel], connections: [f.connection] });
    const currentPlan = { ...plan, name: '本地已改名称', constraints: ['保留蓝色包装'] }, next = { ...input, id: 'chat-second', priorPlanId: first.id, modelConfigId: secondModel.id, input: '标题更大，再检查一次', currentPlan, contextNotes: '品牌：春禾；主色：深蓝' };
    const second = await completed(f, next), snapshot = await f.engine.snapshot(), run = snapshot.runs.find(run => run.id === second.runId);
    expect(second.status).toBe('complete'); expect(second.priorPlanId).toBe(first.id); expect(second.runId).not.toBe(first.runId); expect(f.calls).toHaveLength(2); expect(JSON.parse(f.calls[1].options.body).model).toBe('qa-second');
    expect(run.input).toContain(first.input); expect(run.input).toContain(JSON.stringify(plan)); expect(run.input).toContain(JSON.stringify(currentPlan)); expect(run.input).toContain(next.contextNotes); expect(run.input).toContain(next.input); expect(run.input).not.toContain(input.credentialId);
    expect(snapshot.ledger).toHaveLength(2); expect(new Set(snapshot.ledger.map(row => row.id)).size).toBe(2); expect(snapshot.ledger.reduce((sum, row) => sum + row.costCents, 0)).toBe(45);
    const journal = JSON.parse(await fs.readFile(path.join(f.root, 'automation-planning-v1.json'), 'utf8')), saved = journal.records.find(record => record.id === next.id); expect(saved.contextVersion).toBe('automation-chat-context-v1'); expect(saved.contextHash).toMatch(/^[a-f0-9]{64}$/); expect(saved.sourcePlanHash).toMatch(/^[a-f0-9]{64}$/); expect(saved.fingerprint).not.toBe(saved.requestFingerprint); expect(second).not.toHaveProperty('contextHash');
    const reopened = createAutomationPlanning({ ...f.options, automationCenter: { getPlanningContext: async () => { throw Error('Existing id must not recompose'); } } }); services.push(reopened);
    expect((await reopened.start(next)).runId).toBe(second.runId); expect((await reopened.read(next)).priorPlanId).toBe(first.id); expect(f.calls).toHaveLength(2);
    for (const patch of [{ priorPlanId: 'other-parent' }, { modelConfigId: input.modelConfigId }, { contextNotes: '改资料' }, { currentPlan: { ...currentPlan, objective: '改目标' } }]) await expect(reopened.start({ ...next, ...patch })).rejects.toThrow('已经变化');
    expect((await f.engine.snapshot()).ledger).toHaveLength(2);
  });
  it('续轮回执落盘后重启可免费恢复同一账本和父关联，不重新生成或重新组装上下文', async () => {
    const f = await fixture(), first = await completed(f); let release, received; const gate = new Promise(resolve => { release = resolve; releases.push(resolve); }), saved = new Promise(resolve => { received = resolve; });
    const execute = f.runtime.execute; f.runtime.execute = async (...args) => { const result = await execute(...args); received(); await gate; return result; };
    const next = { ...input, id: 'receipt-child', priorPlanId: first.id, input: '保持主体，只调整标题', currentPlan: plan, contextNotes: '用户确认品牌：春禾' }; const started = await f.service.start(next); await saved; const before = await f.engine.snapshot();
    const copy = await fs.mkdtemp(path.join(base, 'natural-automation-')); roots.push(copy); await fs.cp(f.root, copy, { recursive: true });
    const artifacts = createArtifactStore({ directory: path.join(copy, 'artifacts') }); let requests = 0;
    const runtime = createModelRuntime({ directory: copy, artifactStore: artifacts, credentialStore: { ...f.credentials, withSecret: async () => { throw Error('Read cannot decrypt a key'); } }, fetchImpl: async () => { requests++; throw Error('Read cannot send'); } });
    const engine = createLiveWorkflowEngine({ directory: copy, artifactStore: artifacts, credentials: f.credentials, modelRuntime: runtime }); services.push(engine);
    const service = createAutomationPlanning({ ...f.options, directory: copy, liveEngine: engine, automationCenter: { getPlanningContext: async () => { throw Error('Read cannot recompose'); } } }); services.push(service);
    const recovered = await service.read(next); expect(recovered.status).toBe('complete'); expect(recovered.priorPlanId).toBe(first.id); expect(recovered.runId).toBe(started.runId);
    const after = await engine.snapshot(); expect(after.ledger).toHaveLength(2); expect(new Set(after.ledger.map(row => row.id))).toEqual(new Set(before.ledger.map(row => row.id))); expect(after.ledger.reduce((sum, row) => sum + row.costCents, 0)).toBe(30); expect(requests).toBe(0); expect(f.calls).toHaveLength(2); release();
  });
  it('旧版只有请求fingerprint的已有记录仍可免费重读，不要求重建上下文', async () => {
    const f = await fixture(), first = await completed(f);
    const service = await seedJournal(f, records => { const record = records[0]; record.fingerprint = record.requestFingerprint; delete record.requestFingerprint; delete record.contextVersion; delete record.contextHash; delete record.sourcePlanHash; });
    expect((await service.start(input)).runId).toBe(first.runId); expect((await service.read(input)).resultText).toBe(first.resultText); expect(f.calls).toHaveLength(1); expect((await f.engine.snapshot()).ledger).toHaveLength(1);
  });
  it('续轮派发前取消保留父费用与父关联，迟到配置不会开始新模型请求', async () => {
    const f = await fixture(), first = await completed(f); let release, entered; const gate = new Promise(resolve => { release = resolve; releases.push(resolve); }), waiting = new Promise(resolve => { entered = resolve; });
    const service = createAutomationPlanning({ ...f.options, automationCenter: { getPlanningContext: async request => { entered(); await gate; return f.center.getPlanningContext(request); } } }); services.push(service);
    const request = { ...input, id: 'cancel-child', priorPlanId: first.id, input: '继续改标题', currentPlan: plan }, pending = service.start(request); await waiting; expect((await service.cancel(request)).status).toBe('cancelling'); release();
    const stopped = await pending; expect(stopped.status).toBe('cancelled'); expect(stopped.priorPlanId).toBe(first.id); expect(stopped.runId).toBeUndefined(); expect(f.calls).toHaveLength(1); expect((await f.engine.snapshot()).ledger[0].costCents).toBe(15);
  });
  it('父规划必须同工作区同计费项目；其他作用域不能作为聊天上下文', async () => {
    const f = await fixture(); await completed(f);
    await f.center.syncContext({ workspaceId: 'workspace', workspaces: [{ id: 'workspace' }, { id: 'other' }], projects: [f.project, { ...f.project, id: 'other-project' }, { ...f.project, id: 'foreign-project', workspaceId: 'other' }], workflows: [f.workflow, { ...f.workflow, id: 'foreign-flow', workspaceId: 'other' }], models: f.models, connections: [f.connection] });
    for (const changes of [{ id: 'wrong-project', projectId: 'other-project' }, { id: 'wrong-workspace', projectId: 'foreign-project', workspaceId: 'other' }]) { const request = { ...input, ...changes, priorPlanId: input.id, input: '继续修改' }; const result = await f.service.start(request); expect(result.status).toBe('failed'); expect(result.runId).toBeUndefined(); expect(result.error).toMatch(/不属于|工作区|计费项目/); }
    expect(f.calls).toHaveLength(1); expect((await f.engine.snapshot()).ledger).toHaveLength(1);
  });
  it('父缺失、无效JSON或仍在执行时明确失败，不为子轮发新请求', async () => {
    const missing = await fixture(), absent = await missing.service.start({ ...input, priorPlanId: 'missing-parent' }); expect(absent.status).toBe('failed'); expect(missing.calls).toHaveLength(0);
    const invalid = await fixture({ response: 'not json' }); expect((await completed(invalid)).status).toBe('failed'); const rejected = await invalid.service.start({ ...input, id: 'invalid-child', priorPlanId: input.id }); expect(rejected.status).toBe('failed'); expect(invalid.calls).toHaveLength(1);
    const running = await fixture({ fetchOverride: async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Error('fixture stopped')), { once: true })) }); await running.service.start(input); await until(async () => running.calls.length, count => count === 1);
    const pending = await running.service.start({ ...input, id: 'pending-child', priorPlanId: input.id }); expect(pending.status).toBe('failed'); expect(pending.error).toContain('尚未完整确认'); expect(running.calls).toHaveLength(1);
  });
  it('拒绝自引用、链循环和缺失祖先，不读取无限历史或派发新调用', async () => {
    const f = await fixture(); await expect(f.service.start({ ...input, priorPlanId: input.id })).rejects.toThrow('自身'); expect(f.calls).toHaveLength(0); await completed(f);
    const cycle = await seedJournal(f, records => { records[0].priorPlanId = records[0].id; }); const result = await cycle.start({ ...input, id: 'cycle-child', priorPlanId: input.id }); expect(result.status).toBe('failed'); expect(result.error).toContain('循环'); expect(f.calls).toHaveLength(1);
    const missing = await seedJournal(f, records => { records[0].priorPlanId = 'missing-ancestor'; }); const absent = await missing.start({ ...input, id: 'missing-chain-child', priorPlanId: input.id }); expect(absent.status).toBe('failed'); expect(absent.error).toContain('链缺失'); expect(f.calls).toHaveLength(1);
  });
  it('没有父规划不能夹带本地方案、资料或时间确认，危险方案字段仍拒绝', async () => {
    const f = await fixture();
    for (const value of [{ currentPlan: plan }, { contextNotes: '' }, { calendarResolved: false }]) await expect(f.service.start({ ...input, ...value })).rejects.toThrow('关联已有');
    expect(f.calls).toHaveLength(0); await completed(f);
    await expect(f.service.start({ ...input, id: 'unsafe-child', priorPlanId: input.id, currentPlan: { ...plan, enabled: true } })).rejects.toThrow('不支持的字段');
    await expect(f.service.start({ ...input, id: 'notes-too-large', priorPlanId: input.id, contextNotes: '字'.repeat(10001) })).rejects.toThrow('10000');
    await expect(f.service.start({ ...input, id: 'plan-too-large', priorPlanId: input.id, currentPlan: { ...plan, objective: '字'.repeat(33000) } })).rejects.toThrow('32000'); expect(f.calls).toHaveLength(1);
  });
  it('父方案和总上下文超限拒绝，不静默截断或额外收费', async () => {
    const large = { ...plan, objective: '目'.repeat(10000), steps: [{ ...plan.steps[0], instruction: '步'.repeat(10000) }], constraints: Array.from({ length: 20 }, () => '规'.repeat(2000)) }, f = await fixture({ response: JSON.stringify(large) }); await completed(f);
    const tooLarge = await f.service.start({ ...input, id: 'large-parent-child', priorPlanId: input.id }); expect(tooLarge.status).toBe('failed'); expect(tooLarge.error).toContain('48000'); expect(f.calls).toHaveLength(1);
    const parent = { ...plan, constraints: Array.from({ length: 20 }, () => '规'.repeat(2000)) }, total = await fixture({ response: JSON.stringify(parent) }), initial = { ...input, input: '初'.repeat(20000) }; await completed(total, initial);
    const currentPlan = { ...plan, objective: '新'.repeat(10000), steps: [{ ...plan.steps[0], instruction: '步'.repeat(10000) }], constraints: Array.from({ length: 4 }, () => '规'.repeat(2000)) };
    const result = await total.service.start({ ...input, id: 'context-too-large', priorPlanId: input.id, input: '新'.repeat(20000), currentPlan, contextNotes: '资'.repeat(10000) }); expect(result.status).toBe('failed'); expect(result.error).toContain('80000'); expect(total.calls).toHaveLength(1);
  });
  it('时间确认仅用于本地manual/schedule，不让邮件等不支持请求被清除', async () => {
    const original = { ...plan, objective: '每天9点制作宣传图并发送邮件', unsupported: ['邮件发送暂不支持'] }, f = await fixture({ response: JSON.stringify(original) }); await completed(f);
    const currentPlan = { ...original, trigger: { type: 'manual' } }, next = { ...input, id: 'calendar-child', priorPlanId: input.id, currentPlan, calendarResolved: true, input: '原每天9点改成手动，但仍需要发送邮件' };
    const result = await completed(f, next); expect(result.status).toBe('complete'); expect(result.error).toContain('发送'); expect(result.error).not.toContain('日历'); expect(JSON.parse(result.resultText).unsupported).toEqual(original.unsupported); expect(f.calls[1].options.body).toContain('邮件发送暂不支持');
    const invalid = await f.service.start({ ...next, id: 'invalid-calendar', currentPlan: { ...currentPlan, trigger: { type: 'run-completed', sourceWorkflowId: f.workflow.id } } }); expect(invalid.status).toBe('failed'); expect(invalid.error).toContain('只支持'); expect(f.calls).toHaveLength(2);
  });
});
