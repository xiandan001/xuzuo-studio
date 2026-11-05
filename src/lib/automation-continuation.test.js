import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
const { createLiveWorkflowEngine } = require('../../electron/live-workflow-engine.cjs');
const { createAutomationCenter } = require('../../electron/automation-center.cjs');
const { createAutomationPlanning } = require('../../electron/automation-planning.cjs');
const { remap } = require('../../electron/backup-format.cjs');
const base = path.resolve('work'), active = [], PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
const plan = number => ({ version: 1, name: `第${number}轮方案`, objective: `第${number}轮独立宣传图`, outputKind: 'image', trigger: { type: 'manual' }, steps: [{ kind: 'image-generation', name: '制作图片', instruction: '制作完整宣传图' }], illustrations: { mode: 'none', count: 0 }, acceptance: ['图像清晰'], constraints: [], maxRepairs: 0, questions: [], unsupported: [] });
async function until(read, accept) { const end = Date.now() + 10000; while (Date.now() < end) { const value = await read(); if (accept(value)) return value; await new Promise(resolve => setTimeout(resolve, 5)); } throw Error('Continuation fixture timeout'); }
afterEach(async () => { for (const f of active.splice(0)) { for (const release of f.state.releases) release(); await f.service.shutdown(); await f.center.shutdown(); await f.engine.shutdown(); if (path.dirname(f.directory) !== base || await fs.realpath(f.directory) !== f.directory) throw Error('Unowned continuation cleanup'); await fs.rm(f.directory, { recursive: true, force: true }); } });

async function fixture() {
  const directory = await fs.mkdtemp(path.join(base, 'automation-continuation-')), store = createArtifactStore({ directory: path.join(directory, 'artifacts') });
  const state = { calls: [], releases: [], failCommit: false, beforeExecute: undefined, beforeStart: undefined, plans: 0 };
  const project = { id: 'project', workspaceId: 'workspace', kind: 'image', name: '本轮图片', status: 'draft', costCents: 0, version: 0, updatedAt: '', accent: 'blue' };
  const context = { workspaceId: 'workspace', workspaces: [{ id: 'workspace', name: '当前区' }, { id: 'foreign', name: '其他区' }], projects: [project, { ...project, id: 'other-project' }, { ...project, id: 'foreign-project', workspaceId: 'foreign' }], workflows: [], connections: [{ id: 'connection', name: '隔离配置', providerId: 'custom', protocol: 'openai-chat', baseUrl: 'http://127.0.0.1:9000/v1', enabled: true }], models: [{ id: 'text-model', name: '规划模型', modelId: 'fixture-text', connectionId: 'connection', capabilities: ['text'], enabled: true, pricing: { unit: 'million-tokens', currency: 'CNY', input: '1000', output: '1000' } }, { id: 'image-model', name: '图片模型', modelId: 'fixture-image', connectionId: 'connection', capabilities: ['image-generation'], enabled: true, pricing: { unit: 'image', currency: 'CNY', input: '0', output: '0.10' } }] };
  const credentials = { list: async () => [{ id: 'metadata-key', connectionId: 'connection', enabled: true, name: '仅隔离元数据' }] };
  const engine = createLiveWorkflowEngine({ directory, artifactStore: store, credentials, fileSystem: { ...fs, rename: async (from, to) => { if (state.failCommit && path.basename(to) === 'index-v2.json') throw Error('Owned index persistence failure'); return fs.rename(from, to); } }, modelRuntime: { supports: () => true, execute: async input => {
    state.calls.push(input); if (state.beforeExecute) await state.beforeExecute(input);
    if (input.kind === 'text') { const text = JSON.stringify(plan(++state.plans)); return { text, artifacts: [await store.write({ projectId: input.projectId, runId: input.runId, name: 'planning.json', mimeType: 'application/json', text })], usage: { inputTokens: 100, outputTokens: 50 } }; }
    return { artifacts: [await store.write({ projectId: input.projectId, runId: input.runId, name: 'actual.png', mimeType: 'image/png', buffer: PNG })], usage: { images: 1 } };
  } } });
  const center = createAutomationCenter({ directory, liveEngine: engine, start: async input => { if (state.beforeStart) await state.beforeStart(input); return engine.start(input); }, control: input => engine.control(input) });
  const service = createAutomationPlanning({ directory, liveEngine: engine, automationCenter: center, credentials });
  const f = { directory, store, state, project, context, credentials, engine, center, service }; active.push(f); await center.syncContext(context);
  f.workflow = (id, extra = []) => ({ id, workspaceId: 'workspace', name: id, outputKind: 'image', description: '', updatedAt: '', steps: [{ id: `${id}-image`, name: '制作图片', kind: 'image-generation', prompt: '制作完整图片', enabled: true, inputSource: 'project', modelConfigId: 'image-model', credentialId: 'metadata-key', count: 1 }, { id: `${id}-review`, name: '人工检查', kind: 'manual-review', prompt: '', enabled: true, inputSource: 'previous' }, ...extra, { id: `${id}-export`, name: '导出', kind: 'export', prompt: '', enabled: true, inputSource: 'previous' }] });
  f.request = (flow, target = project) => ({ project: target, workflow: flow, models: context.models, connections: context.connections, input: '完整用户需求', variables: {}, attachmentIds: [], acknowledgePaidCalls: true, acknowledgeUnknownCost: true });
  f.rule = async (id, changes = {}, extra = []) => { const flow = f.workflow(id, extra); if (changes.workspaceId) flow.workspaceId = changes.workspaceId; context.workflows.push(flow); await center.syncContext(context); return center.saveRule({ workspaceId: changes.workspaceId || 'workspace', projectId: changes.projectId || 'project', workflowId: flow.id, name: id, trigger: 'manual', enabled: false, input: '明确制作本轮图片', variables: {}, ...changes }); };
  f.planning = async (id, priorPlanId) => { await service.start({ id, workspaceId: 'workspace', projectId: 'project', modelConfigId: 'text-model', credentialId: 'metadata-key', input: `${id}最新宣传图需求`, ...(priorPlanId ? { priorPlanId } : {}) }); return until(() => service.read({ id, workspaceId: 'workspace' }), value => ['complete', 'failed'].includes(value.status)); };
  f.review = async job => { const result = await until(async () => { await center.tick(); const snapshot = await center.snapshot('workspace'), current = snapshot.jobs.find(item => item.id === job.id); return { snapshot, job: current, run: current?.runId ? await engine.runDetail(current.runId) : undefined }; }, value => value.run?.status === 'waiting-review' && value.job.status === 'decision'); return result; };
  return f;
}

describe('首页多轮规划与明确制作接续', () => {
  it('三轮规划可在原图待检查时继续；只有明确接续才替代原任务，全部原图/费用/旧方案保持且旧卡标为superseded', async () => {
    const f = await fixture(); let previous, priorPlanId;
    for (let round = 1; round <= 3; round++) {
      const before = await f.engine.snapshot(), old = previous && structuredClone(await f.engine.runDetail(previous.run.id));
      const planned = await f.planning(`plan-${round}`, priorPlanId); expect(planned.status, planned.error).toBe('complete'); priorPlanId = planned.id;
      if (old) expect(await f.engine.runDetail(old.id)).toEqual(old);
      const rule = await f.rule(`flow-${round}`), continuation = previous && { previousRuleId: previous.rule.id, previousRunId: previous.run.id };
      const [job, duplicate] = await Promise.all([f.center.trigger({ ruleId: rule.id, ...(continuation ? { continuation } : {}) }), f.center.trigger({ ruleId: rule.id, ...(continuation ? { continuation } : {}) })]); expect(duplicate.id).toBe(job.id);
      const current = await f.review(job); const next = await f.engine.snapshot();
      for (const entry of before.ledger) expect(next.ledger.find(item => item.id === entry.id)).toEqual(entry);
      if (previous) { const superseded = await f.engine.runDetail(previous.run.id); expect(superseded).toMatchObject({ status: 'cancelled', supersededByRunId: current.run.id }); expect(current.run.supersedesRunId).toBe(previous.run.id); const card = current.snapshot.decisions.find(item => item.jobId === previous.job.id); expect(card).toMatchObject({ action: 'superseded' }); expect(card.resolvedAt).toBeTruthy(); for (const image of previous.run.attempts.flatMap(attempt => attempt.artifacts || []).filter(file => file.kind === 'image')) expect((await f.store.read(image.id)).buffer).toEqual(PNG); }
      previous = { ...current, rule };
    }
    for (let index = 0; index < 3; index++) { await f.service.read({ id: 'plan-3', workspaceId: 'workspace' }); await f.center.snapshot('workspace'); await f.center.tick(); }
    expect(f.state.calls.filter(item => item.kind === 'text')).toHaveLength(3); expect(f.state.calls.filter(item => item.kind === 'image-generation')).toHaveLength(3);
    expect((await f.engine.snapshot()).ledger).toHaveLength(6); expect((await f.engine.snapshot()).ledger.reduce((sum, row) => sum + row.costCents, 0)).toBe(75);
    await f.center.shutdown(); f.center = createAutomationCenter({ directory: f.directory, liveEngine: f.engine, start: input => f.engine.start(input), control: input => f.engine.control(input) });
    await f.center.syncContext(f.context); await f.center.tick(); expect((await f.center.snapshot('workspace')).jobs).toHaveLength(3); expect(f.state.calls).toHaveLength(6);
  });

  it('规划不能取消旧制作，伪装规划的制作步骤/附件/替代参数均在调用前拒绝', async () => {
    const f = await fixture(), rule = await f.rule('first'), current = await f.review(await f.center.trigger({ ruleId: rule.id }));
    const valid = { ...f.request(f.workflow('planner')), purpose: 'automation-plan', workflow: { ...f.workflow('planner'), steps: [{ id: 'planner', name: '规划', role: 'planner', kind: 'text', prompt: '规划', enabled: true, inputSource: 'project', modelConfigId: 'text-model', credentialId: 'metadata-key' }] } };
    for (const altered of [{ ...valid, replaceWaitingReviewRunId: current.run.id }, { ...valid, workflow: f.workflow('not-planning') }, { ...valid, attachmentIds: [current.run.attempts[0].artifacts[0].id] }]) await expect(f.engine.start(altered)).rejects.toThrow();
    expect((await f.engine.runDetail(current.run.id)).status).toBe('waiting-review'); expect(f.state.calls).toHaveLength(1);
  });

  it.each(['running', 'paused'])('真实制作%s时新规划仍受忙碌限制，绝不停止原调用或清除费用', async status => {
    const f = await fixture(); let release, entered; const started = new Promise(resolve => { entered = resolve; });
    f.state.beforeExecute = async input => { if (input.kind === 'image-generation') { entered(); await new Promise(resolve => { release = resolve; f.state.releases.push(resolve); }); } };
    const run = await f.engine.start(f.request(f.workflow('active'))); await started;
    if (status === 'paused') { await f.engine.control({ id: run.id, action: 'pause' }); release(); await until(() => f.engine.runDetail(run.id), value => value.status === 'paused'); }
    const before = await f.engine.runDetail(run.id), planned = await f.planning(`blocked-${status}`); expect(planned.status).toBe('failed'); expect(planned.error).toContain('真实运行任务'); expect(await f.engine.runDetail(run.id)).toEqual(before); expect(f.state.calls.filter(item => item.kind === 'text')).toHaveLength(0); release();
  });

  it('跨项目/工作区、错误rule/run搭配与自动触发规则不能替代；不带明确接续的新任务仍等待原检查', async () => {
    const f = await fixture(), oldRule = await f.rule('old'), old = await f.review(await f.center.trigger({ ruleId: oldRule.id }));
    const next = await f.rule('next'), other = await f.rule('other', { projectId: 'other-project' }), foreign = await f.rule('foreign', { projectId: 'foreign-project', workspaceId: 'foreign' }), scheduled = await f.rule('schedule', { trigger: 'schedule', intervalMinutes: 10 });
    for (const input of [{ ruleId: other.id, continuation: { previousRuleId: oldRule.id, previousRunId: old.run.id } }, { ruleId: foreign.id, continuation: { previousRuleId: oldRule.id, previousRunId: old.run.id } }, { ruleId: scheduled.id, continuation: { previousRuleId: oldRule.id, previousRunId: old.run.id } }, { ruleId: next.id, continuation: { previousRuleId: next.id, previousRunId: old.run.id } }]) await expect(f.center.trigger(input)).rejects.toThrow('接续制作未提交');
    const queued = await f.center.trigger({ ruleId: next.id }); await f.center.tick(); expect((await f.center.snapshot('workspace')).jobs.find(job => job.id === queued.id).status).toBe('queued'); expect(f.state.calls).toHaveLength(1); expect((await f.engine.runDetail(old.run.id)).status).toBe('waiting-review');
  });

  it('提交后旧检查位置改变，捕获的attempt令牌阻止替代新检查；旧结果/新产生费用均保留', async () => {
    const f = await fixture();
    const extra = [{ id: 'second-image', name: '第二制作阶段', kind: 'image-generation', prompt: '第二阶段', enabled: true, inputSource: 'project', modelConfigId: 'image-model', credentialId: 'metadata-key' }, { id: 'second-review', name: '第二人工检查', kind: 'manual-review', prompt: '', enabled: true, inputSource: 'previous' }];
    const oldRule = await f.rule('old', {}, extra), old = await f.review(await f.center.trigger({ ruleId: oldRule.id })), next = await f.rule('next');
    f.state.beforeStart = async input => { if (!input.replaceWaitingReviewRunId) return; f.state.beforeStart = undefined; await f.engine.control({ id: old.run.id, action: 'resume' }); await until(() => f.engine.runDetail(old.run.id), value => value.status === 'waiting-review' && value.snapshot.steps[value.stepIndex].id === 'second-review'); };
    const job = await f.center.trigger({ ruleId: next.id, continuation: { previousRuleId: oldRule.id, previousRunId: old.run.id } });
    await until(async () => { await f.center.tick(); return (await f.center.snapshot('workspace')).jobs.find(item => item.id === job.id); }, value => value.status === 'decision');
    const preserved = await f.engine.runDetail(old.run.id); expect(preserved.status).toBe('waiting-review'); expect(preserved.supersededByRunId).toBeUndefined(); expect(f.state.calls.filter(item => item.kind === 'image-generation')).toHaveLength(2); expect((await f.engine.snapshot()).ledger.reduce((sum, row) => sum + row.costCents, 0)).toBe(20);
  });

  it('原子启动保存失败不会取消旧检查或产生新付费请求，免费读取不会自动重试', async () => {
    const f = await fixture(), oldRule = await f.rule('old'), old = await f.review(await f.center.trigger({ ruleId: oldRule.id })), next = await f.rule('next');
    const before = await f.engine.runDetail(old.run.id), fees = (await f.engine.snapshot()).ledger;
    f.state.failCommit = true; const job = await f.center.trigger({ ruleId: next.id, continuation: { previousRuleId: oldRule.id, previousRunId: old.run.id } });
    await until(async () => { await f.center.tick(); return (await f.center.snapshot('workspace')).jobs.find(item => item.id === job.id); }, value => value.status === 'decision'); f.state.failCommit = false;
    expect(await f.engine.runDetail(old.run.id)).toEqual(before); expect((await f.engine.snapshot()).ledger).toEqual(fees); expect(f.state.calls).toHaveLength(1);
    const snapshot = await f.center.snapshot('workspace'); const card = snapshot.decisions.find(item => item.jobId === job.id); await f.center.resolve({ id: card.id, action: 'refresh' }); await f.center.tick(); expect(f.state.calls).toHaveLength(1);
  });

  it('替代已由后台受理但ACK丢失时通过原dispatchKey关联同一运行，重复按钮与读取不付费重做', async () => {
    const f = await fixture(), oldRule = await f.rule('old'), old = await f.review(await f.center.trigger({ ruleId: oldRule.id })), next = await f.rule('next');
    f.state.beforeStart = async input => { if (!input.replaceWaitingReviewRunId) return; f.state.beforeStart = undefined; await f.engine.start(input); throw Error('Owned accepted run ACK lost'); };
    const continuation = { previousRuleId: oldRule.id, previousRunId: old.run.id }, job = await f.center.trigger({ ruleId: next.id, continuation });
    const uncertain = await until(async () => { await f.center.tick(); return (await f.center.snapshot('workspace')).decisions.find(card => card.jobId === job.id && !card.resolvedAt); }, value => value?.kind === 'uncertain');
    await f.center.resolve({ id: uncertain.id, action: 'refresh' });
    const current = await f.review(job); expect((await f.center.trigger({ ruleId: next.id, continuation })).id).toBe(job.id);
    await f.center.resolve({ id: current.snapshot.decisions.find(card => card.jobId === job.id && !card.resolvedAt).id, action: 'refresh' }); await f.center.tick();
    expect(f.state.calls).toHaveLength(2); expect((await f.engine.runDetail(old.run.id)).supersededByRunId).toBe(current.run.id); expect((await f.engine.snapshot()).ledger.reduce((sum, row) => sum + row.costCents, 0)).toBe(20);
  });

  it('同项目另一项未决检查仍阻挡明确接续，不能把项目所有review一并忽略', async () => {
    const f = await fixture(), oldRule = await f.rule('old'), old = await f.review(await f.center.trigger({ ruleId: oldRule.id })), foreignRule = await f.rule('unrelated'), next = await f.rule('next');
    const unrelated = await f.center.trigger({ ruleId: foreignRule.id }); await f.center.shutdown();
    const file = path.join(f.directory, 'automation-center-v1.json'), journal = JSON.parse(await fs.readFile(file, 'utf8')), other = journal.jobs.find(job => job.id === unrelated.id);
    other.status = 'decision'; other.runId = 'unavailable-foreign-run'; journal.decisions.push({ id: 'unrelated-review', jobId: other.id, runId: other.runId, workspaceId: 'workspace', projectId: 'project', kind: 'review', title: '另一段对话遗留的检查', detail: '', createdAt: new Date().toISOString() }); await fs.writeFile(file, JSON.stringify(journal) + '\n');
    f.center = createAutomationCenter({ directory: f.directory, liveEngine: f.engine, start: input => f.engine.start(input), control: input => f.engine.control(input) }); await f.center.syncContext(f.context);
    const job = await f.center.trigger({ ruleId: next.id, continuation: { previousRuleId: oldRule.id, previousRunId: old.run.id } }); for (let index = 0; index < 3; index++) await f.center.tick();
    expect((await f.center.snapshot('workspace')).jobs.find(item => item.id === job.id).status).toBe('queued'); expect((await f.engine.runDetail(old.run.id)).status).toBe('waiting-review'); expect(f.state.calls).toHaveLength(1);
  });

  it('内部接续引用随备份实体编号重绑，普通对话文字保持不变', () => {
    const value = { replacement: { ruleId: 'r', runId: 'run', jobId: 'job', workflowAttemptId: 'attempt' }, input: 'run' };
    expect(remap(value, { r: 'new-r', run: 'new-run', job: 'new-job', attempt: 'new-attempt' })).toEqual({ replacement: { ruleId: 'new-r', runId: 'new-run', jobId: 'new-job', workflowAttemptId: 'new-attempt' }, input: 'run' });
  });
});
