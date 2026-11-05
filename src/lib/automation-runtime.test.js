import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createAutomationCenter } = require('../../electron/automation-center.cjs');
const { reviewVerdict, evaluateQuality, repairInput } = require('../../electron/automation-quality.cjs');
const { createModelReceipts } = require('../../electron/model-receipts.cjs');
const owned = [], centers = [];
const stamp = '2026-11-03T00:00:00.000Z';
async function directory() { const result = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-automation-test-')); owned.push(result); return result; }
afterEach(async () => { await Promise.all(centers.splice(0).map(center => center.shutdown())); for (const root of owned.splice(0)) { if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + 'xuzuo-automation-test-')) throw Error('Unowned test cleanup'); await fs.rm(root, { recursive: true, force: true }); } });
async function setup(extra = {}) {
  const root = await directory(), runs = [], calls = []; let revision = 1, time = Date.parse(stamp);
  const context = { workspaces: [{ id: 'workspace', name: 'Fixture' }], projects: [1, 2, 3].map(n => ({ id: `project-${n}`, workspaceId: 'workspace', kind: 'word', name: `Project${n}`, description: '', costCents: 17 })), workflows: [{ id: 'flow', workspaceId: 'workspace', name: 'Fixture', outputKind: 'word', steps: [] }], models: [], connections: [] };
  const snapshot = async after => after >= revision ? null : { revision, runs: structuredClone(runs), ledger: [] };
  const start = async request => { calls.push(request); const run = { id: `run-${calls.length}`, dispatchKey: request.dispatchKey, projectId: request.project.id, workspaceId: 'workspace', workflowId: request.workflow.id, status: 'running', attempts: [], createdAt: new Date(time).toISOString(), updatedAt: new Date(time).toISOString() }; runs.push(run); revision++; return structuredClone(run); };
  const control = async input => { const run = runs.find(run => run.id === input.id); run.status = input.action === 'cancel' ? 'cancelled' : 'running'; revision++; };
  const center = createAutomationCenter({ directory: root, liveEngine: { snapshot }, start, control, clock: () => time, ...extra }); centers.push(center);
  await center.syncContext(context);
  const add = changes => center.saveRule({ workspaceId: 'workspace', projectId: 'project-1', workflowId: 'flow', name: 'Rule', enabled: false, trigger: 'manual', input: 'Actual goal', variables: {}, ...changes });
  const settle = async () => { for (let i = 0; i < 4; i++) await center.tick(); };
  return { center, root, context, runs, calls, add, settle, advance: minutes => { time += minutes * 60000; revision++; }, changed: () => { revision++; } };
}
describe('自动化事件、派工与恢复', () => {
  it('同规则连续点击只接收一次，不重复派工，队列与事件可重新读取', async () => {
    const f = await setup(), rule = await f.add(); const [a, b] = await Promise.all([f.center.trigger({ ruleId: rule.id }), f.center.trigger({ ruleId: rule.id })]); await f.settle();
    expect(a.id).toBe(b.id); expect(f.calls).toHaveLength(1); expect((await f.center.snapshot('workspace')).jobs).toHaveLength(1);
    const saved = JSON.parse(await fs.readFile(path.join(f.root, 'automation-center-v1.json'), 'utf8')); expect(saved.jobs[0].dispatchKey).toBe(f.calls[0].dispatchKey); expect(saved.context.projects[0].costCents).toBe(17);
  });
  it('同一资料事件重复上报不新增任务，定时计划不会补发所有错过时段', async () => {
    const f = await setup(); await f.add({ enabled: true, trigger: 'reference-imported' });
    const input = { projectId: 'project-1', workspaceId: 'workspace', files: [{ id: 'file-1' }] }; await f.center.referenceImported(input); await f.center.referenceImported(input); await f.settle(); expect(f.calls).toHaveLength(1);
    f.runs[0].status = 'complete'; f.runs[0].completedAt = stamp; f.changed(); await f.settle();
    await f.add({ projectId: 'project-2', enabled: true, trigger: 'schedule', intervalMinutes: 10 }); f.advance(60); await f.settle(); expect(f.calls).toHaveLength(2);
  });
  it('全局最多2项派工，同项目后续任务等待，不将运行中任务重复执行', async () => {
    const f = await setup(); for (const id of [1, 2, 3]) { const rule = await f.add({ projectId: `project-${id}` }); await f.center.trigger({ ruleId: rule.id }); } await f.settle();
    expect(f.calls).toHaveLength(2); expect((await f.center.snapshot('workspace')).jobs.filter(job => job.status === 'queued')).toHaveLength(1);
    f.runs[0].status = 'complete'; f.runs[0].completedAt = stamp; f.changed(); await f.settle(); expect(f.calls).toHaveLength(3);
  });
  it('派工尚未确认时仅读取不会重发，无记录时保持待办直到明确继续', async () => {
    const requests = []; let calls = 0; const f = await setup({ start: async request => { requests.push(request); calls++; throw Error('lost acknowledgement'); } }); const rule = await f.add(); await f.center.trigger({ ruleId: rule.id }); await f.settle();
    const decision = (await f.center.snapshot('workspace')).decisions[0]; await f.center.resolve({ id: decision.id, action: 'refresh' }); await f.settle(); expect(calls).toBe(1); expect((await f.center.snapshot('workspace')).jobs[0].status).toBe('decision');
    f.context.workflows[0].steps = [{ id: 'changed', kind: 'text', enabled: true, prompt: '新的流程不能替换未知派工的快照' }]; await f.center.syncContext(f.context);
    await f.center.resolve({ id: decision.id, action: 'continue' }); await f.settle(); expect(calls).toBe(2); expect(requests[1].workflow).toEqual(requests[0].workflow); expect(requests[1].dispatchKey).toBe(requests[0].dispatchKey);
  });
  it('未创建真实运行的配置缺项修复后可按最新流程继续，原任务目标保持', async () => {
    const requests = [];
    const f = await setup({ start: async request => { requests.push(request); if (!request.workflow.steps[0]?.modelConfigId) throw Object.assign(Error('缺少制作模型'), { code: 'WORKFLOW_PREFLIGHT' }); return { id: 'configured-run', dispatchKey: request.dispatchKey, projectId: 'project-1', workspaceId: 'workspace', workflowId: 'flow', status: 'running', attempts: [] }; } });
    const rule = await f.add(); await f.center.trigger({ ruleId: rule.id }); await f.settle(); const decision = (await f.center.snapshot('workspace')).decisions[0];
    f.context.workflows[0].steps = [{ id: 'step', kind: 'text', enabled: true, modelConfigId: 'configured-model', credentialId: 'configured-key', prompt: '生产规范', inputSource: 'project' }]; await f.center.syncContext(f.context);
    await f.center.resolve({ id: decision.id, action: 'continue' }); await f.settle();
    expect(requests).toHaveLength(2); expect(requests[1].workflow.steps[0].modelConfigId).toBe('configured-model'); expect(requests[1].input).toBe('Actual goal'); expect(requests[1].dispatchKey).toBe(requests[0].dispatchKey);
  });
  it('停用规则在准入等待期间取消队列，不在迟到回调后复活派工', async () => {
    let release, admitted = false; const f = await setup({ assertAdmission: () => { admitted = true; return new Promise(resolve => { release = resolve; }); } }); const rule = await f.add({ enabled: true }); await f.center.trigger({ ruleId: rule.id });
    for (let n = 0; n < 100 && !admitted; n++) await new Promise(resolve => setTimeout(resolve, 2)); expect(admitted).toBe(true);
    await f.center.setEnabled({ id: rule.id, enabled: false }); release(true); await f.settle(); expect(f.calls).toHaveLength(0); expect((await f.center.snapshot('workspace')).jobs[0].status).toBe('cancelled');
  });
  it('错误记录受保护，刷新和上下文同步不覆盖损坏文件', async () => {
    const root = await directory(), filename = path.join(root, 'automation-center-v1.json'); await fs.writeFile(filename, '{broken');
    const center = createAutomationCenter({ directory: root, liveEngine: { snapshot: async () => ({ runs: [] }) }, start: async () => { throw Error('forbidden'); } }); centers.push(center);
    expect((await center.snapshot('workspace')).available).toBe(false); await expect(center.syncContext({ workspaces: [], projects: [], workflows: [], models: [], connections: [] })).rejects.toThrow(); expect(await fs.readFile(filename, 'utf8')).toBe('{broken');
  });
});
describe('独立检查和有限修订', () => {
  const producer = { id: 'producer', kind: 'text', enabled: true }, reviewer = { id: 'review', role: 'reviewer', qualityGate: { repairStepId: 'producer', maxRepairs: 1, minScore: 80 } };
  const run = () => ({ input: '真实目标', snapshot: { steps: [producer, reviewer] }, attempts: [{ id: 'source', stepId: 'producer', status: 'complete', input: '已确认事实', summary: '完整原稿', costCents: 17 }] });
  it('仅有效结构和达到分数才通过；超上限不继续自动调用', () => {
    expect(() => reviewVerdict('{"passed":"true","issues":[]}')).toThrow();
    const value = run(), attempt = { id: 'verdict', completedAt: stamp, summary: '{"passed":false,"score":40,"issues":["缺少交付物"],"summary":"有明确缺项"}' };
    const failed = evaluateQuality(value, reviewer, attempt); expect(failed.repair.number).toBe(1); expect(value.attempts[0].costCents).toBe(17);
    value.repairCounts = { review: 1 }; expect(evaluateQuality(value, reviewer, attempt).repair).toBeUndefined();
    value.repairContext = failed.repair; expect(repairInput(value, producer, 'ignored')).toContain('完整原稿'); expect(repairInput(value, producer, 'ignored')).toContain('缺少交付物');
  });
});
describe('模型回执先落盘，已收到结果可免费恢复', () => {
  const request = () => ({ requestId: 'request-1', runId: 'run-1', projectId: 'project-1', connection: { providerId: 'fixture', baseUrl: 'https://fixture.invalid' }, model: { modelId: 'fixture-model' }, kind: 'text', input: 'goal', prompt: 'produce', credentialId: 'metadata-only', secret: 'NOT-PERSIST-KEY', attachments: [], options: {} });
  const store = { read: async () => ({ projectId: 'project-1', buffer: Buffer.from('verified') }) };
  it('同一请求并发/重启后只执行一次，回执不保存Key并校验结果哈希', async () => {
    const root = await directory(), receipts = createModelReceipts({ directory: root, artifactStore: store }); let count = 0;
    const execute = async () => { count++; return { text: 'real received result', artifacts: [{ id: 'artifact' }], usage: { inputTokens: 3 } }; };
    await Promise.all([receipts.execute(request(), execute), receipts.execute(request(), execute)]); const restored = createModelReceipts({ directory: root, artifactStore: store });
    expect((await restored.execute(request(), execute)).text).toBe('real received result'); expect(count).toBe(1);
    const filename = path.join(root, 'model-receipts-v1/request-1.json'), raw = await fs.readFile(filename, 'utf8'); expect(raw).not.toContain('NOT-PERSIST-KEY');
    const tampered = JSON.parse(raw); tampered.result.text = 'tampered'; await fs.writeFile(filename, JSON.stringify(tampered)); await expect(restored.recoverReceipt(request())).rejects.toThrow('无法核验');
  });
  it('派发过但没有确认结果时不自动重发，明确新尝试必须使用新编号', async () => {
    const root = await directory(), receipts = createModelReceipts({ directory: root, artifactStore: store }); let count = 0;
    const execute = async () => { count++; throw Object.assign(Error('unknown response'), { requestStarted: true }); };
    await expect(receipts.execute(request(), execute)).rejects.toThrow(); await expect(receipts.execute(request(), execute)).rejects.toThrow('不能自动重发'); expect(count).toBe(1);
    await expect(receipts.execute({ ...request(), requestId: 'request-2' }, execute)).rejects.toThrow(); expect(count).toBe(2);
  });
  it('回执随所选项目恢复后可免费读取，重绑文件路径且重复导入不覆盖', async () => {
    const root = await directory(), source = createModelReceipts({ directory: root, artifactStore: store });
    await source.execute(request(), async () => ({ text: '已收到的原始结果', artifacts: [{ id: 'artifact', projectId: 'project-1', name: 'result.txt', mimeType: 'text/plain', kind: 'text', bytes: 8, path: 'C:/old-private-path' }], usage: { inputTokens: 2 } }));
    const bundle = await source.backupEntries({ projectIds: ['project-1'], availableRuns: [{ id: 'run-1', projectId: 'project-1', attempts: [{ id: 'request-1' }] }] });
    expect(JSON.stringify(bundle)).not.toContain('old-private-path');
    const restoredRoot = await directory(), metadata = { id: 'artifact-2', projectId: 'project-2', name: 'result.txt', mimeType: 'text/plain', kind: 'text', bytes: 8, path: 'C:/restored-managed-path', createdAt: stamp };
    const target = createModelReceipts({ directory: restoredRoot, artifactStore: { list: async () => [metadata], read: async () => ({ ...metadata, buffer: Buffer.from('verified') }) } });
    const input = { records: bundle, idMap: new Map([['project-1', 'project-2'], ['run-1', 'run-2'], ['request-1', 'request-2'], ['artifact', 'artifact-2']]), backupId: 'backup-owned', availableRuns: [{ id: 'run-2', projectId: 'project-2', workspaceId: 'workspace', attempts: [{ id: 'request-2' }] }] };
    expect((await target.importEntries(input)).imported).toEqual(['request-2']); expect((await target.importEntries(input)).skipped).toBe(1);
    const result = await target.recoverReceipt({ requestId: 'request-2', runId: 'run-2', projectId: 'project-2' });
    expect(result.text).toBe('已收到的原始结果'); expect(result.artifacts[0].path).toBe('C:/restored-managed-path'); expect(result.artifacts[0].unavailable).toBe(false);
  });
});
