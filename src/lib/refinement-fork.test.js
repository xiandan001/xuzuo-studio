import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareLiveStartSource } from './live-start-source';
const require = createRequire(import.meta.url);
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
const { createLiveWorkflowEngine } = require('../../electron/live-workflow-engine.cjs');
const { createAutomationCenter } = require('../../electron/automation-center.cjs');
const { startChecked, lookupStart } = require('../../electron/live-start.cjs');
const { replacementReview } = require('../../electron/refinement-fork.cjs');
const base = path.resolve('work'), active = [], PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
const until = async (read, accept) => { const end = Date.now() + 10000; while (Date.now() < end) { const value = await read(); if (accept(value)) return value; await new Promise(resolve => setTimeout(resolve, 5)); } throw Error('Refinement fixture timeout'); };
afterEach(async () => { for (const f of active.splice(0)) { for (const release of f.state.releases) release(); await f.center.shutdown(); await f.engine.shutdown(); if (path.dirname(f.directory) !== base || await fs.realpath(f.directory) !== f.directory) throw Error('Unowned refinement fixture'); await fs.rm(f.directory, { recursive: true, force: true }); } });
async function fixture() {
  const directory = await fs.mkdtemp(path.join(base, 'refinement-fork-')), store = createArtifactStore({ directory: path.join(directory, 'artifacts') });
  const state = { calls: [], releases: [], failCommit: false, credentialGate: undefined };
  const project = { id: 'project', workspaceId: 'workspace', name: '待精修海报', kind: 'image', status: 'draft', costCents: 0, version: 0, updatedAt: '', accent: 'blue' };
  const connections = [{ id: 'connection', name: '本地测试配置', providerId: 'custom', protocol: 'image', baseUrl: 'http://127.0.0.1:9000/v1', enabled: true }], models = [{ id: 'image', name: '图片模型', modelId: 'fixture-image', connectionId: 'connection', capabilities: ['image-generation', 'image-editing'], enabled: true, pricing: { unit: 'image', currency: 'CNY', input: '0', output: '0.10' } }, { id: 'vision', name: '质量检查', modelId: 'fixture-vision', connectionId: 'connection', capabilities: ['vision'], enabled: true, pricing: { unit: 'million-tokens', currency: 'CNY', input: '1000', output: '1000' } }];
  const credentials = { list: async () => { if (state.credentialGate) await state.credentialGate; return [{ id: 'metadata-key', name: '仅隔离Key编号', connectionId: 'connection', enabled: true }]; } };
  const engine = createLiveWorkflowEngine({ directory, artifactStore: store, credentials, fileSystem: { ...fs, rename: async (from, to) => { if (state.failCommit && path.basename(to) === 'index-v2.json') throw Error('Owned persistence failure'); return fs.rename(from, to); } }, modelRuntime: { supports: () => true, execute: async input => { state.calls.push(input); if (input.kind === 'vision') { const text = JSON.stringify({ passed: false, score: 30, issues: ['品牌名称未填写，联系方式应删除'], summary: '必须修正，不能验收通过' }); return { text, artifacts: [await store.write({ projectId: input.projectId, runId: input.runId, name: 'quality.json', mimeType: 'application/json', text })], usage: { inputTokens: 100, outputTokens: 50 } }; } return { artifacts: [await store.write({ projectId: input.projectId, runId: input.runId, name: 'actual.png', mimeType: 'image/png', buffer: PNG })], usage: { images: 1 } }; } } });
  const qualityFlow = { id: 'quality-flow', workspaceId: 'workspace', name: '海报及质量检查', outputKind: 'image', description: '', updatedAt: '', steps: [{ id: 'producer', name: '制作海报', kind: 'image-generation', enabled: true, inputSource: 'project', prompt: '制作宣传海报', modelConfigId: 'image', credentialId: 'metadata-key' }, { id: 'quality', role: 'reviewer', name: '复核品牌与联系方式', kind: 'vision', enabled: true, inputSource: 'previous', prompt: '返回检查JSON', modelConfigId: 'vision', credentialId: 'metadata-key', qualityGate: { maxRepairs: 0, repairStepId: 'producer' } }, { id: 'export', name: '导出', kind: 'export', prompt: '', enabled: true, inputSource: 'previous' }] };
  const center = createAutomationCenter({ directory, liveEngine: engine, start: input => engine.start(input), control: input => engine.control(input) });
  await center.syncContext({ workspaceId: 'workspace', workspaces: [{ id: 'workspace', name: '当前区' }], projects: [project], workflows: [qualityFlow], models, connections });
  const f = { directory, store, state, engine, center, project, models, connections, qualityFlow }; active.push(f);
  f.base = flow => ({ project, workflow: flow, models, connections, input: '制作海报', variables: {}, attachmentIds: [], acknowledgePaidCalls: true, acknowledgeUnknownCost: true });
  f.quality = async () => { const rule = await center.saveRule({ workspaceId: 'workspace', projectId: 'project', workflowId: qualityFlow.id, name: '原制作', trigger: 'manual', enabled: false, input: '制作海报', variables: {} }); const job = await center.trigger({ ruleId: rule.id }); const result = await until(async () => { await center.tick(); const snapshot = await center.snapshot('workspace'), current = snapshot.jobs.find(item => item.id === job.id); return { snapshot, job: current, run: current?.runId ? await engine.runDetail(current.runId) : undefined }; }, value => value.job?.status === 'decision' && value.run?.status === 'waiting-review'); await engine.drain(); return result; };
  f.edit = (old, source) => ({ ...f.base({ id: 'quick-edit', workspaceId: 'workspace', name: '用户明确精修', outputKind: 'image', description: '', updatedAt: '', steps: [{ id: 'edit', name: '补品牌并移除联系方式', kind: 'image-editing', enabled: true, inputSource: 'project', prompt: '品牌改为已给定名称，删除联系方式', modelConfigId: 'image', credentialId: 'metadata-key', count: 1 }] }), input: '用户明确精修当前所选图片', attachmentIds: [source.id], dispatchKey: 'a'.repeat(64), replaceWaitingReviewRunId: old.id, replaceWaitingReviewAttemptId: old.qualityReviews.at(-1).attemptId, refinementFork: { reviewAttemptId: old.qualityReviews.at(-1).attemptId, sourceArtifactId: source.id } });
  return f;
}

describe('未通过质量检查的图片明确精修', () => {
  it.each(['current', 'history', 'import'])('所选%s本项目图片可直接精修，失败复核保持失败且原图/费用保留，旧决定标为superseded', async type => {
    const f = await fixture(), old = await f.quality(), original = old.run.attempts[0].artifacts[0];
    const selected = type === 'current' ? original : await f.store.write({ projectId: 'project', ...(type === 'history' ? { runId: 'earlier-image-run' } : {}), name: `${type}.png`, mimeType: 'image/png', buffer: PNG });
    const before = await f.engine.snapshot(), failed = structuredClone(old.run.qualityReviews), review = structuredClone(old.run.attempts[1]); expect(old.run.snapshot.steps[old.run.stepIndex].kind).toBe('vision');
    const reply = await startChecked(f.engine, input => f.engine.start(input), f.edit(old.run, selected)); expect(reply.status).toBe('started'); await until(() => f.engine.runDetail(reply.run.id), value => value.status === 'complete'); await f.center.tick();
    const preserved = await f.engine.runDetail(old.run.id); expect(preserved).toMatchObject({ status: 'cancelled', supersededByRunId: reply.run.id, error: old.run.error }); expect(preserved.qualityReviews).toEqual(failed); expect(preserved.attempts[1]).toEqual(review);
    const snapshot = await f.engine.snapshot(); for (const row of before.ledger) expect(snapshot.ledger.find(item => item.id === row.id)).toEqual(row); expect(snapshot.ledger).toHaveLength(before.ledger.length + 1);
    expect((await f.store.read(original.id)).buffer).toEqual(PNG); expect((await f.store.read(selected.id)).buffer).toEqual(PNG); expect(f.state.calls.at(-1).attachments.map(file => file.id)).toEqual([selected.id]);
    const card = (await f.center.snapshot('workspace')).decisions.find(item => item.jobId === old.job.id); expect(card.action).toBe('superseded'); expect(card.resolvedAt).toBeTruthy();
  });

  it('跨项目/未附带/过期复核/非精修请求全部拒绝，不改旧检查、不新增调用', async () => {
    const f = await fixture(), old = await f.quality(), original = old.run.attempts[0].artifacts[0], foreign = await f.store.write({ projectId: 'foreign-project', name: 'foreign.png', mimeType: 'image/png', buffer: PNG });
    const input = f.edit(old.run, original), before = await f.engine.snapshot();
    const wrongKind = structuredClone(input); wrongKind.workflow.steps[0].kind = 'image-generation';
    for (const invalid of [{ ...input, attachmentIds: [original.id], refinementFork: { ...input.refinementFork, sourceArtifactId: foreign.id } }, f.edit(old.run, foreign), { ...input, replaceWaitingReviewAttemptId: 'stale-attempt' }, { ...input, refinementFork: { ...input.refinementFork, reviewAttemptId: 'stale-attempt' } }, wrongKind, { ...input, refinementFork: undefined }]) expect((await startChecked(f.engine, request => f.engine.start(request), invalid)).status).toBe('rejected');
    expect(await f.engine.runDetail(old.run.id)).toEqual(old.run); expect((await f.engine.snapshot()).ledger).toEqual(before.ledger); expect(f.state.calls).toHaveLength(2);
    expect(replacementReview({ ...old.run, status: 'running' }, input.refinementFork)).toBeUndefined(); expect(replacementReview({ ...old.run, status: 'paused' }, input.refinementFork)).toBeUndefined();
  });

  it('原图不可用或原子保存失败时不取消旧检查、不新增收费', async () => {
    const f = await fixture(), old = await f.quality(), original = old.run.attempts[0].artifacts[0], input = f.edit(old.run, original), before = await f.engine.snapshot();
    f.state.failCommit = true; expect((await startChecked(f.engine, request => f.engine.start(request), input)).status).toBe('rejected'); f.state.failCommit = false;
    expect(await f.engine.runDetail(old.run.id)).toEqual(old.run); expect((await f.engine.snapshot()).ledger).toEqual(before.ledger);
    await f.store.trash(original.id); expect((await startChecked(f.engine, request => f.engine.start(request), input)).status).toBe('rejected'); expect(f.state.calls).toHaveLength(2); expect((await f.engine.runDetail(old.run.id)).status).toBe('waiting-review');
  });

  it('同key重试只有一份真实运行，改变原图/提示词/模型参数不能静默套用旧请求', async () => {
    const f = await fixture(), flow = { ...f.qualityFlow, id: 'single', steps: [f.qualityFlow.steps[0]] }, input = { ...f.base(flow), dispatchKey: 'b'.repeat(64) };
    const [a, b] = await Promise.all([f.engine.start(input), f.engine.start(structuredClone(input))]); expect(b.id).toBe(a.id); await until(() => f.engine.runDetail(a.id), value => value.status === 'complete');
    const changed = structuredClone(input); changed.workflow.steps[0].prompt = '不同的新提示词'; expect(await startChecked(f.engine, request => f.engine.start(request), changed)).toMatchObject({ status: 'rejected', code: 'START_KEY_CHANGED' }); expect(f.state.calls).toHaveLength(1);
    expect((await lookupStart(f.engine, { dispatchKey: input.dispatchKey, projectId: 'project', workspaceId: 'workspace' })).run.id).toBe(a.id); await expect(lookupStart(f.engine, { dispatchKey: input.dispatchKey, projectId: 'foreign', workspaceId: 'workspace' })).rejects.toThrow('不属于');
  });

  it('查询等待进入服务但尚未进入引擎的admission，不会把慢启动误判为未受理', async () => {
    const f = await fixture(), input = { ...f.base({ ...f.qualityFlow, id: 'slow', steps: [f.qualityFlow.steps[0]] }), dispatchKey: 'c'.repeat(64) }; let release; const gate = new Promise(resolve => { release = resolve; f.state.releases.push(resolve); });
    const starting = startChecked(f.engine, async request => { await gate; return f.engine.start(request); }, input); let resolved = false;
    const reading = lookupStart(f.engine, { dispatchKey: input.dispatchKey, projectId: 'project', workspaceId: 'workspace' }).then(result => { resolved = true; return result; });
    await new Promise(resolve => setTimeout(resolve, 15)); expect(resolved).toBe(false); expect(f.state.calls).toHaveLength(0); release(); expect((await starting).status).toBe('started'); expect((await reading).status).toBe('started');
  });

  it('直接引擎入场也有串行查询屏障；确未收到的key才返回权威不存在且不生成', async () => {
    const f = await fixture(), input = { ...f.base({ ...f.qualityFlow, id: 'slow-engine', steps: [f.qualityFlow.steps[0]] }), dispatchKey: 'd'.repeat(64) }; let release; f.state.credentialGate = new Promise(resolve => { release = resolve; f.state.releases.push(resolve); });
    const starting = f.engine.start(input); let resolved = false; const reading = lookupStart(f.engine, { dispatchKey: input.dispatchKey, projectId: 'project', workspaceId: 'workspace' }).then(result => { resolved = true; return result; });
    await new Promise(resolve => setTimeout(resolve, 15)); expect(resolved).toBe(false); f.state.credentialGate = undefined; release(); expect((await reading).status).toBe('started'); await starting;
    expect(await lookupStart(f.engine, { dispatchKey: 'e'.repeat(64), projectId: 'project', workspaceId: 'workspace' })).toEqual({ status: 'not-found' });
  });

  it('全新明确重试可去掉已终止的旧引用并只精修一次；别的活动任务仍阻止0额外调用', async () => {
    const f = await fixture(), old = await f.quality(), source = old.run.attempts[0].artifacts[0]; await f.engine.control({ id: old.run.id, action: 'cancel' });
    const original = await f.engine.runDetail(old.run.id), stale = f.edit(old.run, source);
    const prepared = await prepareLiveStartSource(stale, id => f.engine.runDetail(id), projectId => f.store.listProject(projectId));
    expect(prepared.replaceWaitingReviewRunId).toBeUndefined(); expect(prepared.replaceWaitingReviewAttemptId).toBeUndefined(); expect(prepared.refinementFork).toBeUndefined();
    const started = await startChecked(f.engine, input => f.engine.start(input), prepared); expect(started.status).toBe('started'); await until(() => f.engine.runDetail(started.run.id), run => run.status === 'complete'); expect(await f.engine.runDetail(old.run.id)).toEqual(original); expect(f.state.calls.filter(call => call.kind === 'image-editing')).toHaveLength(1);
    const activeFlow = { ...f.qualityFlow, id: 'other-active', steps: [f.qualityFlow.steps[0], { id: 'manual', name: '人工检查', kind: 'manual-review', prompt: '', inputSource: 'previous', enabled: true }] }, active = await f.engine.start(f.base(activeFlow)); await until(() => f.engine.runDetail(active.id), run => run.status === 'waiting-review'); const count = f.state.calls.length;
    const next = { ...prepared, dispatchKey: 'f'.repeat(64) }; expect(await startChecked(f.engine, input => f.engine.start(input), next)).toMatchObject({ status: 'rejected', code: 'PROJECT_BUSY' }); expect(f.state.calls).toHaveLength(count); expect((await f.engine.runDetail(active.id)).status).toBe('waiting-review');
    const foreign = { ...original, projectId: 'foreign-project' }; await expect(prepareLiveStartSource(stale, async () => foreign, async () => [])).rejects.toThrow('不属于');
  });
});
