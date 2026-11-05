import { readLiveHistory, writeLiveHistory } from './live-history-test-helper';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ArtifactMetadata, LivePreflight, LiveSnapshot, LiveStartRequest, ModelUsage } from '../live-types';
import type { WorkflowRun } from '../configuration-types';

interface Store { write: (input: { name: string; mimeType: string; text?: string; buffer?: Buffer; runId?: string; projectId?: string }) => Promise<ArtifactMetadata>; read: (id: string) => Promise<ArtifactMetadata & { buffer: Buffer }>; list: (ids: string[]) => Promise<ArtifactMetadata[]>; }
interface ExecuteRequest { kind: string; input: string; prompt: string; attachments: ArtifactMetadata[]; runId: string; projectId: string; options?: { existingTaskId?: string }; }
interface ModelResult { text: string; artifacts: ArtifactMetadata[]; usage: ModelUsage; }
interface Engine { recordLocalExport: (input: { projectId: string; workspaceId: string; name: string; kind: string; sourceRevision: number; artifacts: ArtifactMetadata[]; sourceArtifactIds: string[] }) => Promise<WorkflowRun>; manageRun: (input: { id: string; action: 'hide' | 'trash' | 'restore' }) => Promise<void>; preflight: (request: LiveStartRequest) => Promise<LivePreflight>; start: (request: LiveStartRequest) => Promise<WorkflowRun>; snapshot: () => Promise<LiveSnapshot>; control: (input: { id: string; action: string; stepId?: string; stepBudgetCents?: number | null; project?: LiveStartRequest['project'] }) => Promise<void>; reconcile: (input: { entryId: string; costCents: number }) => Promise<void>; shutdown: () => Promise<void>; }
const require = createRequire(import.meta.url);
const { createLiveWorkflowEngine } = require('../../electron/live-workflow-engine.cjs') as { createLiveWorkflowEngine: (options: Record<string, unknown>) => Engine };
const { createArtifactStore } = require('../../electron/artifact-store.cjs') as { createArtifactStore: (options: { directory: string; loadModule: NodeRequire }) => Store };
const { calculateCost } = require('../../electron/live-cost.cjs') as { calculateCost: (pricing: unknown, usage: ModelUsage) => { costCents: number; costState: string } };
const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const runtimeManifest = path.join(projectRoot, 'work/ui-build/package.json');
const dependencies = createRequire(existsSync(runtimeManifest) ? runtimeManifest : path.join(projectRoot, 'package.json'));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
const request = (): LiveStartRequest => ({
  project: { id: 'project', workspaceId: 'workspace', name: '真实交付验证', kind: 'word', description: '', status: 'draft', costCents: 0, budgetCents: 10000, version: 0, updatedAt: '', accent: 'blue' },
  workflow: { id: 'flow', workspaceId: 'workspace', name: '完整验证流程', description: '', outputKind: 'word', updatedAt: '', steps: [
    { id: 'text-step', name: '撰稿', kind: 'text', prompt: '制作{{主题}}内容', modelConfigId: 'text-model', credentialId: 'credential', inputSource: 'project', budgetCents: 1000, enabled: true },
    { id: 'image-step', name: '配图', kind: 'image-generation', prompt: '制作配图', modelConfigId: 'image-model', credentialId: 'credential', inputSource: 'previous', budgetCents: 1000, enabled: true },
    { id: 'human-step', name: '人工检查', kind: 'manual-review', prompt: '', inputSource: 'previous', budgetCents: 0, enabled: true },
    { id: 'export-step', name: '导出', kind: 'export', prompt: '', inputSource: 'previous', budgetCents: 0, enabled: true },
  ] },
  connections: [{ id: 'connection', name: '本机接口测试', providerId: 'custom', protocol: 'openai-chat', baseUrl: 'http://127.0.0.1:9000/v1', status: 'configured', enabled: true }],
  models: [
    { id: 'text-model', name: '测试文本', modelId: 'test-text', connectionId: 'connection', capabilities: ['text'], pricing: { unit: 'million-tokens', currency: 'CNY', input: '2', output: '8' }, enabled: true },
    { id: 'image-model', name: '测试图像', modelId: 'test-image', connectionId: 'connection', capabilities: ['image-generation'], pricing: { unit: 'image', currency: 'CNY', input: '', output: '0.10' }, enabled: true },
  ], input: '请保留事实并给出可编辑文件。', variables: { 主题: '茶园' }, attachmentIds: [], acknowledgePaidCalls: true, acknowledgeUnknownCost: true,
});
async function waitFor(engine: Engine, predicate: (snapshot: LiveSnapshot) => boolean): Promise<LiveSnapshot> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) { const snapshot = await engine.snapshot(); if (predicate(snapshot)) return snapshot; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error('engine deadline exceeded');
}
async function fixture(executeOverride?: (input: ExecuteRequest, options: { signal: AbortSignal }, standard: () => Promise<ModelResult>) => Promise<ModelResult>, fileSystem?: Record<string, unknown>) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-live-tests-'));
  const store = createArtifactStore({ directory: path.join(directory, 'artifacts'), loadModule: dependencies });
  const calls: ExecuteRequest[] = [];
  const runtime = { supports: (_connection: unknown, kind: string) => ['text', 'image-generation'].includes(kind), execute: async (input: ExecuteRequest, options: { signal: AbortSignal }) => {
    calls.push(input);
    const standard = async (): Promise<ModelResult> => input.kind === 'text' ? { text: '# 茶园项目\n这是真实测试服务返回的正文，不是内置示例。', artifacts: [await store.write({ name: '正文.txt', mimeType: 'text/plain', text: '# 茶园项目\n这是真实测试服务返回的正文，不是内置示例。', runId: input.runId, projectId: input.projectId })], usage: { inputTokens: 100, outputTokens: 50 } } : { text: '图像服务返回的实际图片', artifacts: [await store.write({ name: '配图.png', mimeType: 'image/png', buffer: PNG, runId: input.runId, projectId: input.projectId })], usage: { images: 1 } };
    return executeOverride ? executeOverride(input, options, standard) : standard();
  } };
  const options = { directory, credentials: { list: async () => [{ id: 'credential', connectionId: 'connection', name: '测试凭证', enabled: true }] }, artifactStore: store, modelRuntime: runtime, ...(fileSystem ? { fileSystem } : {}) };
  const engine = createLiveWorkflowEngine(options);
  return { directory, store, calls, engine, options };
}

async function blockedByStepLimit(fileSystem?: Record<string, unknown>) {
  let store: Store;
  const f = await fixture(async (input, _options, standard) => {
    if (input.prompt !== '生成初稿') return standard();
    const text = '稿'.repeat(5000);
    return { text, artifacts: [await store.write({ name: '已成功初稿.txt', mimeType: 'text/plain', text, runId: input.runId, projectId: input.projectId })], usage: { inputTokens: 100, outputTokens: 1000 } };
  }, fileSystem);
  store = f.store;
  const input = request(); input.project.budgetCents = 500;
  input.models[0].pricing = { unit: 'million-tokens', currency: 'CNY', input: '10', output: '0' };
  input.workflow.steps = [
    { ...input.workflow.steps[0], id: 'draft', name: '初稿', prompt: '生成初稿', budgetCents: undefined, maxOutputTokens: 16 },
    { ...input.workflow.steps[0], id: 'refine', name: '精修', prompt: '精修正文', inputSource: 'previous', budgetCents: 10, maxOutputTokens: 16 },
    input.workflow.steps[3],
  ];
  const run = await f.engine.start(input);
  const failed = await waitFor(f.engine, value => value.runs[0]?.status === 'failed');
  expect(failed.runs[0].stepIndex).toBe(1); expect(f.calls).toHaveLength(1); expect(failed.ledger[0].costCents).toBe(1);
  return { ...f, input, run, failed };
}
describe('真实工作流状态、传递、费用与交付', () => {
  it('实际结果传到下游，人工确认后导出真正DOCX，重复快照不重复调用', async () => {
    const f = await fixture(); const run = await f.engine.start(request());
    const waiting = await waitFor(f.engine, snapshot => snapshot.runs[0]?.status === 'waiting-review');
    expect(f.calls).toHaveLength(2); expect(f.calls[1].input).toContain('真实测试服务返回');
    expect(waiting.ledger).toHaveLength(2); expect(waiting.ledger.reduce((sum, entry) => sum + entry.costCents, 0)).toBe(11);
    expect(waiting.runs[0].attempts.at(-1)?.status).toBe('waiting-review');
    await f.engine.control({ id: run.id, action: 'resume' });
    const done = await waitFor(f.engine, snapshot => snapshot.runs[0].status === 'complete');
    const files = done.runs[0].attempts.at(-1)?.artifacts || [];
    const docx = files.find(file => file.name.endsWith('.docx'));
    expect(docx).toBeDefined(); expect((await f.store.read(docx!.id)).buffer.subarray(0, 2).toString()).toBe('PK');
    await f.engine.snapshot(); await f.engine.snapshot(); expect(f.calls).toHaveLength(2);
    expect(await (f.engine.snapshot as (revision: number) => Promise<LiveSnapshot | null>)(done.revision!)).toBeNull();
    await f.engine.shutdown();
  });
  it('无Key或不支持能力在发送请求前拦截', async () => {
    const f = await fixture(); const input = request(); input.workflow.steps[0].credentialId = undefined;
    expect((await f.engine.preflight(input)).errors.join('')).toContain('API Key');
    await expect(f.engine.start(input)).rejects.toMatchObject({ code: 'WORKFLOW_PREFLIGHT' }); expect(f.calls).toHaveLength(0); expect((await f.engine.snapshot()).runs).toHaveLength(0); await f.engine.shutdown();
  });
  it('失败响应已返回用量时仍核算费用并保留请求ID', async () => {
    const f = await fixture(async () => { throw Object.assign(new Error('服务已产生用量但输出失败'), { name: 'ModelRuntimeError', requestStarted: true, usage: { inputTokens: 100, outputTokens: 50 }, providerRequestId: 'test-provider-request' }); });
    await f.engine.start(request()); const snapshot = await waitFor(f.engine, value => value.runs[0]?.status === 'failed');
    expect(snapshot.ledger[0].costCents).toBe(1); expect(snapshot.ledger[0].costState).toBe('calculated'); expect(snapshot.ledger[0].usage?.providerRequestId).toBe('test-provider-request'); await f.engine.shutdown();
  });
  it('中途失败保留前序真实结果，从失败位置继续，不重复成功步骤', async () => {
    let failed = false;
    const f = await fixture(async (input, _options, standard) => { if (input.kind === 'image-generation' && !failed) { failed = true; throw Object.assign(new Error('测试错误'), { name: 'ModelRuntimeError', requestStarted: true }); } return standard(); });
    const run = await f.engine.start(request());
    const failedSnapshot = await waitFor(f.engine, snapshot => snapshot.runs[0]?.status === 'failed');
    expect(failedSnapshot.ledger.find(entry => entry.status === 'failed')?.costState).toBe('unknown');
    await f.engine.control({ id: run.id, action: 'continue' });
    const resumed = await waitFor(f.engine, snapshot => snapshot.runs[0].status === 'waiting-review');
    expect(f.calls.filter(call => call.kind === 'text')).toHaveLength(1); expect(f.calls.filter(call => call.kind === 'image-generation')).toHaveLength(2);
    expect(resumed.ledger).toHaveLength(3); await f.engine.control({ id: run.id, action: 'cancel' }); await f.engine.shutdown();
  });
  it('暂停等待当前真实请求结束，继续时不重新调用已完成步骤', async () => {
    let release: (() => void) | undefined;
    const f = await fixture(async (input, _options, standard) => { if (input.kind === 'text') await new Promise<void>(resolve => { release = resolve; }); return standard(); });
    const run = await f.engine.start(request()); await waitFor(f.engine, snapshot => snapshot.ledger.length === 1 && f.calls.length > 0);
    await f.engine.control({ id: run.id, action: 'pause' }); while (!release) await new Promise(resolve => setTimeout(resolve, 5)); release();
    const paused = await waitFor(f.engine, snapshot => snapshot.runs[0].status === 'paused'); expect(paused.runs[0].attempts[0].status).toBe('complete');
    await f.engine.control({ id: run.id, action: 'resume' }); await waitFor(f.engine, snapshot => snapshot.runs[0].status === 'waiting-review');
    expect(f.calls.filter(call => call.kind === 'text')).toHaveLength(1); await f.engine.control({ id: run.id, action: 'cancel' }); await f.engine.shutdown();
  });
  it('步骤之间保存记录时点击暂停，不会多发下一次付费请求', async () => {
    const f = await fixture();
    let release: (() => void) | undefined;
    let reached: (() => void) | undefined;
    let gated = false;
    const gap = new Promise<void>(resolve => { reached = resolve; });
    const fileSystem = { ...fs, writeFile: async (filename: string, contents: string) => {
      const state = JSON.parse(contents) as { records: { run: WorkflowRun }[] };
      if (!gated && state.records[0]?.run.stepIndex === 1 && state.records[0].run.status === 'running') { gated = true; reached?.(); await new Promise<void>(resolve => { release = resolve; }); }
      await fs.writeFile(filename, contents, 'utf8');
    } };
    const engine = createLiveWorkflowEngine({ ...f.options, fileSystem });
    const run = await engine.start(request()); await gap;
    const paused = engine.control({ id: run.id, action: 'pause' });
    await new Promise(resolve => setImmediate(resolve)); release?.(); await paused;
    await waitFor(engine, snapshot => snapshot.runs[0].status === 'paused');
    expect(f.calls).toHaveLength(1); await engine.control({ id: run.id, action: 'cancel' }); await engine.shutdown();
  });
  it('取消请求记录未知费用，单步重试不会执行其余步骤，允许人工核对账单', async () => {
    let first = true;
    const f = await fixture(async (_input, options, standard) => { if (first) { first = false; await new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { requestStarted: true })), { once: true })); } return standard(); });
    const run = await f.engine.start(request()); await waitFor(f.engine, snapshot => snapshot.ledger.length === 1 && f.calls.length > 0);
    await f.engine.control({ id: run.id, action: 'cancel' });
    const cancelled = await waitFor(f.engine, snapshot => snapshot.ledger[0]?.status === 'cancelled'); expect(cancelled.ledger[0].costState).toBe('unknown');
    await f.engine.reconcile({ entryId: cancelled.ledger[0].id, costCents: 7 });
    await f.engine.control({ id: run.id, action: 'retry', stepId: 'text-step' });
    const retried = await waitFor(f.engine, snapshot => snapshot.runs[0].status === 'complete');
    expect(retried.runs[0].retryStepOnly).toBe(true); expect(f.calls.filter(call => call.kind === 'image-generation')).toHaveLength(0);
    expect(retried.ledger.reduce((sum, entry) => sum + entry.costCents, 0)).toBe(8); await f.engine.shutdown();
  });
  it('重开引擎保留人工待确认，不偷偷发起新的付费请求', async () => {
    const f = await fixture(); await f.engine.start(request()); await waitFor(f.engine, snapshot => snapshot.runs[0]?.status === 'waiting-review'); await f.engine.shutdown();
    const reopened = createLiveWorkflowEngine(f.options); const snapshot = await reopened.snapshot(); expect(snapshot.runs[0].status).toBe('waiting-review'); expect(snapshot.runs[0].attempts.at(-1)?.status).toBe('waiting-review'); expect(snapshot.ledger).toHaveLength(2); expect(f.calls).toHaveLength(2); await reopened.shutdown();
  });
  it('中断任务隐藏、回收和恢复保留同一费用与产物，重开也保持隐藏', async () => {
    const f = await fixture(); const run = await f.engine.start(request());
    const waiting = await waitFor(f.engine, snapshot => snapshot.runs[0]?.status === 'waiting-review');
    await expect(f.engine.manageRun({ id: run.id, action: 'hide' })).rejects.toThrow('完成或取消');
    await f.engine.control({ id: run.id, action: 'cancel' });
    const original = await f.engine.snapshot();
    await f.engine.manageRun({ id: run.id, action: 'hide' });
    const hidden = await f.engine.snapshot(); expect(hidden.runs[0].hiddenAt).toBeTruthy();
    expect(hidden.ledger).toEqual(original.ledger); expect(hidden.runs[0].attempts).toEqual(original.runs[0].attempts);
    expect(hidden.runs[0].attempts.flatMap(item => item.artifacts || [])).toHaveLength(waiting.runs[0].attempts.flatMap(item => item.artifacts || []).length);
    await expect(f.engine.control({ id: run.id, action: 'continue' })).rejects.toThrow('恢复');
    await f.engine.shutdown();
    const reopened = createLiveWorkflowEngine(f.options); expect((await reopened.snapshot()).runs[0].hiddenAt).toBeTruthy();
    await reopened.manageRun({ id: run.id, action: 'trash' }); expect((await reopened.snapshot()).runs[0].trashedAt).toBeTruthy();
    await reopened.manageRun({ id: run.id, action: 'restore' }); const restored = await reopened.snapshot();
    expect(restored.runs[0].hiddenAt).toBeUndefined(); expect(restored.runs[0].trashedAt).toBeUndefined(); expect(restored.ledger).toEqual(original.ledger);
    expect(f.calls).toHaveLength(2); await reopened.shutdown();
  });
  it('只有真正运行中的旧请求标为中断；暂停与人工检查保持原状且不重发', async () => {
    const f = await fixture(); await f.engine.start(request()); await waitFor(f.engine, snapshot => snapshot.runs[0]?.status === 'waiting-review'); await f.engine.shutdown();
    const directory = f.directory;
    for (const status of ['running', 'paused', 'waiting-review'] as const) {
      const data = await readLiveHistory(f.directory);
      data.records[0].run.status = status; data.records[0].run.attempts.at(-1).status = status === 'running' ? 'running' : 'waiting-review';
      await writeLiveHistory(directory, data);
      const reopened = createLiveWorkflowEngine(f.options); const snapshot = await reopened.snapshot();
      expect(snapshot.runs[0].status).toBe(status === 'running' ? 'interrupted' : status); expect(snapshot.ledger).toHaveLength(2); expect(f.calls).toHaveLength(2); await reopened.shutdown();
    }
  });
  it('生成A后人工编辑交付B，完成原检查尾段且不再导出A，不新增模型调用和费用', async () => {
    const f = await fixture(); const run = await f.engine.start(request());
    const waiting = await waitFor(f.engine, value => value.runs[0]?.status === 'waiting-review');
    const source = waiting.runs[0].attempts.find(attempt => attempt.stepId === 'text-step')!.artifacts![0];
    const officeStore = f.store as Store & { exportOffice: (input: Record<string, unknown>) => Promise<ArtifactMetadata[]> };
    const artifacts = await officeStore.exportOffice({ kind: 'word', title: '人工版本B', text: '# 人工版本B\n这是客户确认后的人工修改B正文。', projectId: 'project', runId: 'editor-project-3' });
    await f.engine.recordLocalExport({ projectId: 'project', workspaceId: 'workspace', name: '人工版本B', kind: 'word', sourceRevision: 3, artifacts, sourceArtifactIds: [source.id] });
    const final = await f.engine.snapshot(), original = final.runs.find(item => item.id === run.id)!;
    expect(original.status).toBe('complete'); expect(original.attempts.at(-1)!.artifacts).toEqual(artifacts); expect(original.attempts[0].summary).toContain('真实测试服务返回'); expect(final.ledger).toEqual(waiting.ledger); expect(f.calls).toHaveLength(2);
    const zip = await dependencies('jszip').loadAsync((await f.store.read(artifacts[0].id)).buffer); expect(await zip.file('word/document.xml').async('string')).toContain('人工修改B');
    await f.engine.recordLocalExport({ projectId: 'project', workspaceId: 'workspace', name: '人工版本B', kind: 'word', sourceRevision: 3, artifacts, sourceArtifactIds: [source.id] });
    expect((await f.engine.snapshot()).runs.find(item => item.id === run.id)!.attempts).toHaveLength(original.attempts.length); await f.engine.shutdown();
    const reopened = createLiveWorkflowEngine(f.options); expect((await reopened.snapshot()).runs.find(item => item.id === run.id)!.status).toBe('complete'); expect(f.calls).toHaveLength(2); await reopened.shutdown();
  });
  it('恢复已提交的视频只查询原任务，费用不再算一遍', async () => {
    let first = true; let store: Store | undefined;
    const f = await fixture(async input => {
      if (first) { first = false; throw Object.assign(new Error('本地等待中断'), { name: 'ModelRuntimeError', requestStarted: true, providerRequestId: 'owned-video-job', usage: { providerRequestId: 'owned-video-job' } }); }
      expect(input.options?.existingTaskId).toBe('owned-video-job');
      return { text: '原视频任务结果已恢复', artifacts: [await store!.write({ name: 'video.mp4', mimeType: 'video/mp4', buffer: Buffer.from('test-only-video-result') })], usage: { seconds: 4 }, providerRequestId: 'owned-video-job' } as ModelResult;
    });
    store = f.store;
    f.options.modelRuntime.supports = (_connection: unknown, kind: string) => kind === 'video-generation';
    const input = request(); input.project.kind = 'image'; input.workflow.outputKind = 'image';
    input.connections[0].providerId = 'siliconflow'; input.connections[0].protocol = 'video';
    input.models[0].capabilities = ['video-generation']; input.models[0].pricing = { unit: 'request', currency: 'CNY', input: '', output: '0.10' };
    input.workflow.steps = [{ ...input.workflow.steps[0], kind: 'video-generation' }, input.workflow.steps[3]];
    const run = await f.engine.start(input); await waitFor(f.engine, snapshot => snapshot.runs[0]?.status === 'failed');
    await f.engine.control({ id: run.id, action: 'continue', stepBudgetCents: 0 }); const done = await waitFor(f.engine, snapshot => snapshot.runs[0].status === 'complete');
    expect(done.ledger).toHaveLength(2); expect(done.ledger.reduce((sum, entry) => sum + entry.costCents, 0)).toBe(10); expect(done.ledger.some(entry => entry.queryOnly && entry.costCents === 0)).toBe(true);
    await f.engine.shutdown();
  });
  it('视频多次查询失败后仍只给原生成任务计费，不将失败查询当成新的生成费', async () => {
    let count = 0; let store: Store | undefined;
    const f = await fixture(async input => {
      count++;
      if (count === 1) throw Object.assign(new Error('生成等待中断'), { name: 'ModelRuntimeError', requestStarted: true, providerRequestId: 'owned-video-multiple', usage: { providerRequestId: 'owned-video-multiple' } });
      expect(input.options?.existingTaskId).toBe('owned-video-multiple');
      if (count === 2) throw Object.assign(new Error('只读查询暂时失败'), { name: 'ModelRuntimeError', requestStarted: true, providerRequestId: 'owned-video-multiple' });
      return { text: '已读取原视频结果', artifacts: [await store!.write({ name: 'video.mp4', mimeType: 'video/mp4', buffer: Buffer.from('owned-video-result') })], usage: { seconds: 4 }, providerRequestId: 'owned-video-multiple' } as ModelResult;
    });
    store = f.store; f.options.modelRuntime.supports = (_connection: unknown, kind: string) => kind === 'video-generation';
    const input = request(); input.project.kind = 'image'; input.workflow.outputKind = 'image'; input.connections[0].providerId = 'siliconflow'; input.connections[0].protocol = 'video'; input.models[0].capabilities = ['video-generation']; input.models[0].pricing = { unit: 'request', currency: 'CNY', input: '', output: '0.10' }; input.workflow.steps = [{ ...input.workflow.steps[0], kind: 'video-generation' }, input.workflow.steps[3]];
    const run = await f.engine.start(input); await waitFor(f.engine, snapshot => snapshot.runs[0]?.status === 'failed');
    await f.engine.control({ id: run.id, action: 'continue', stepBudgetCents: 0 }); await waitFor(f.engine, snapshot => snapshot.runs[0]?.status === 'failed' && snapshot.ledger.length === 2);
    await f.engine.control({ id: run.id, action: 'continue', stepBudgetCents: 0 }); const done = await waitFor(f.engine, snapshot => snapshot.runs[0]?.status === 'complete');
    expect(count).toBe(3); expect(done.ledger).toHaveLength(3); expect(done.ledger.find(entry => !entry.queryOnly)?.costCents).toBe(10); expect(done.ledger.filter(entry => entry.queryOnly).map(entry => entry.costCents)).toEqual([0, 0]); expect(done.ledger.reduce((sum, entry) => sum + entry.costCents, 0)).toBe(10);
    await f.engine.shutdown();
  });
});
describe('真实用量核算不冒充官方账单', () => {
  it('参考价经预检、请求白名单和账本仍待核对，手动对账保留原参考快照', async () => {
    const f = await fixture(), input = request();
    input.workflow.steps = [input.workflow.steps[0], input.workflow.steps[3]];
    input.models[0].pricing = { ...input.models[0].pricing, referenceOnly: true, referenceNote: '官方多档价格仅供参考', officialUrl: 'https://official.example/pricing', verifiedAt: '2026-10-30' };
    expect((await f.engine.preflight(input)).unknownCost).toBe(true);
    await expect(f.engine.start({ ...input, acknowledgeUnknownCost: false })).rejects.toThrow('待核对费用');
    expect(f.calls).toHaveLength(0);
    await f.engine.start(input);
    const done = await waitFor(f.engine, snapshot => snapshot.runs[0]?.status === 'complete');
    expect(f.calls).toHaveLength(1);
    expect(done.ledger[0]).toMatchObject({ costCents: 0, costState: 'unknown', pricingSnapshot: { referenceOnly: true, referenceNote: '官方多档价格仅供参考', officialUrl: 'https://official.example/pricing', verifiedAt: '2026-10-30' } });
    expect(done.runs[0].attempts[0].costState).toBe('unknown');
    await f.engine.reconcile({ entryId: done.ledger[0].id, costCents: 21 });
    const checked = await f.engine.snapshot();
    expect(checked.ledger[0]).toMatchObject({ costState: 'manual', costCents: 21, pricingSnapshot: { referenceOnly: true } });
    expect(checked.runs[0].attempts[0].costCents).toBe(21);
    await f.engine.shutdown();
  });
  it('美元Token费用按用户汇率精确向上取整到分', () => { expect(calculateCost({ unit: 'million-tokens', currency: 'USD', input: '2', output: '8', exchangeRate: '7.2' }, { inputTokens: 1000, outputTokens: 500 })).toMatchObject({ costCents: 5, costState: 'calculated' }); });
  it('按张累计，缺用量或价格/汇率标未知而非免费', () => {
    expect(calculateCost({ unit: 'image', currency: 'USD', input: '', output: '0.04', exchangeRate: '7.2' }, { images: 2 }).costCents).toBe(58);
    expect(calculateCost({ unit: 'million-tokens', currency: 'CNY', input: '1', output: '1' }, {}).costState).toBe('unknown');
    expect(calculateCost({ unit: 'image', currency: 'USD', input: '', output: '0.04' }, { images: 1 }).costState).toBe('calculated');
  });
});

describe('选填金额上限与失败位置续跑', () => {
  it('不填项目或步骤上限仍生成真实结果并累计费用', async () => {
    const f = await fixture(), input = request();
    input.project.budgetCents = undefined; input.workflow.steps.forEach(step => { step.budgetCents = undefined; });
    expect((await f.engine.preflight(input)).ok).toBe(true);
    const run = await f.engine.start(input); await waitFor(f.engine, value => value.runs[0]?.status === 'waiting-review');
    await f.engine.control({ id: run.id, action: 'resume' }); const done = await waitFor(f.engine, value => value.runs[0]?.status === 'complete');
    expect(done.ledger.reduce((sum, entry) => sum + entry.costCents, 0)).toBe(11); expect(f.calls).toHaveLength(2);
    expect(done.runs[0].attempts.at(-1)?.artifacts?.some(item => item.name.endsWith('.docx'))).toBe(true); await f.engine.shutdown();
  });

  it('零元项目或单步上限仍在发送前拦截正费用，旧数字上限仍保留', async () => {
    const f = await fixture();
    for (const scope of ['project', 'step', 'existing'] as const) {
      const input = request(); input.project.budgetCents = scope === 'project' ? 0 : scope === 'existing' ? 5 : undefined;
      input.workflow.steps.forEach(step => { step.budgetCents = undefined; });
      if (scope === 'step') input.workflow.steps[0].budgetCents = 0;
      expect((await f.engine.preflight(input)).ok).toBe(false); await expect(f.engine.start(input)).rejects.toThrow();
    }
    expect(f.calls).toHaveLength(0); await f.engine.shutdown();
  });

  it('零元上限下未知费用也拒绝，不能把未知当零元', async () => {
    const f = await fixture(), input = request();
    input.project.budgetCents = undefined; input.workflow.steps = [{ ...input.workflow.steps[0], budgetCents: 0 }]; input.models[0].pricing = { unit: 'million-tokens', currency: 'CNY', input: '', output: '' };
    const check = await f.engine.preflight(input); expect(check.unknownCost).toBe(true); expect(check.errors.join('')).toContain('零元上限');
    await expect(f.engine.start(input)).rejects.toThrow('零元上限'); expect(f.calls).toHaveLength(0); await f.engine.shutdown();
  });

  it('缺少价格且没有上限仍标待核对，不取消真实付费确认', async () => {
    const f = await fixture(), input = request(); input.project.budgetCents = undefined;
    input.workflow.steps = [{ ...input.workflow.steps[0], budgetCents: undefined }]; input.models[0].pricing = { unit: 'million-tokens', currency: 'CNY', input: '', output: '' };
    input.acknowledgePaidCalls = false; await expect(f.engine.start(input)).rejects.toThrow('确认'); expect(f.calls).toHaveLength(0);
    input.acknowledgePaidCalls = true; input.acknowledgeUnknownCost = false; await expect(f.engine.start(input)).rejects.toThrow('确认');
    input.acknowledgeUnknownCost = true; await f.engine.start(input); const done = await waitFor(f.engine, value => value.runs[0]?.status === 'complete');
    expect(done.ledger[0].costState).toBe('unknown'); expect(done.ledger[0].costState).not.toBe('not-incurred'); await f.engine.shutdown();
  });

  it('负数、小数、NaN、Infinity与数字字符串上限均无效', async () => {
    const f = await fixture();
    for (const value of [-1, 0.5, NaN, Infinity, '100', '']) {
      const projectInput = request(); projectInput.project.budgetCents = value as number;
      const stepInput = request(); stepInput.workflow.steps[0].budgetCents = value as number;
      expect((await f.engine.preflight(projectInput)).errors.join('')).toContain('无效'); expect((await f.engine.preflight(stepInput)).errors.join('')).toContain('无效');
    }
    expect(f.calls).toHaveLength(0); await f.engine.shutdown();
  });

  it('本地免费导出允许明确零上限，不发模型请求', async () => {
    const f = await fixture(), input = request(); input.project.budgetCents = 0;
    input.workflow.steps = [{ ...input.workflow.steps[3], inputSource: 'project', budgetCents: 0 }];
    await f.engine.start(input); const done = await waitFor(f.engine, value => value.runs[0]?.status === 'complete');
    expect(f.calls).toHaveLength(0); expect(done.ledger).toHaveLength(0); expect(done.runs[0].attempts[0].artifacts?.some(item => item.name.endsWith('.docx'))).toBe(true); await f.engine.shutdown();
  });

  it('存量null上限读取规范化为undefined，数字和0保持原值', async () => {
    const f = await fixture(); await f.engine.start(request()); await waitFor(f.engine, value => value.runs[0]?.status === 'waiting-review'); await f.engine.shutdown();
    const saved = await readLiveHistory(f.directory);
    for (const record of saved.records) { record.request.project.budgetCents = null; record.request.workflow.steps[0].budgetCents = null; record.run.snapshot.steps[0].budgetCents = null; }
    await writeLiveHistory(f.directory, saved);
    const reopened = createLiveWorkflowEngine(f.options); const snapshot = await reopened.snapshot();
    expect(snapshot.runs[0].snapshot.steps[0].budgetCents).toBeUndefined(); expect(snapshot.runs[0].snapshot.steps[1].budgetCents).toBe(1000); expect(snapshot.runs[0].snapshot.steps[2].budgetCents).toBe(0);
    const persisted = await readLiveHistory(f.directory); expect(persisted.records[0].request.project.budgetCents).toBeUndefined(); expect(f.calls).toHaveLength(2); await reopened.shutdown();
  });

  it('undefined保留原步上限，null仅清当前步并继续，不重发已成功正文', async () => {
    const f = await blockedByStepLimit();
    await f.engine.control({ id: f.run.id, action: 'continue' }); await waitFor(f.engine, value => value.runs[0]?.status === 'failed');
    expect(f.calls).toHaveLength(1); expect((await f.engine.snapshot()).runs[0].snapshot.steps[1].budgetCents).toBe(10);
    await f.engine.control({ id: f.run.id, action: 'continue', stepBudgetCents: null }); const done = await waitFor(f.engine, value => value.runs[0]?.status === 'complete');
    expect(f.calls.filter(call => call.prompt === '生成初稿')).toHaveLength(1); expect(f.calls.filter(call => call.prompt === '精修正文')).toHaveLength(1);
    expect(done.runs[0].snapshot.steps[1].budgetCents).toBeUndefined(); expect(done.runs[0].snapshot.steps[2].budgetCents).toBe(0);
    expect(done.ledger.reduce((sum, entry) => sum + entry.costCents, 0)).toBe(2);
    const saved = await readLiveHistory(f.directory); expect(saved.records[0].request.project.budgetCents).toBe(500); expect(saved.records[0].request.workflow.steps[1].budgetCents).toBeUndefined(); await f.engine.shutdown();
  });

  it('数字新上限可续跑，而0和非法上限失败时不修改旧快照或费用', async () => {
    const f = await blockedByStepLimit(), original = (await f.engine.snapshot()).runs[0];
    for (const value of [0, -1, 0.5, NaN, Infinity, '100']) {
      await expect(f.engine.control({ id: f.run.id, action: 'continue', stepBudgetCents: value as number })).rejects.toThrow();
      expect((await f.engine.snapshot()).runs[0]).toEqual(original); expect(f.calls).toHaveLength(1);
    }
    await f.engine.control({ id: f.run.id, action: 'continue', stepBudgetCents: 15 }); const done = await waitFor(f.engine, value => value.runs[0]?.status === 'complete');
    expect(done.runs[0].snapshot.steps[1].budgetCents).toBe(15); expect(f.calls).toHaveLength(2); expect(done.ledger[0].costCents).toBe(1); await f.engine.shutdown();
  });

  it('续跑状态持久化失败会回滚预算和游标，不开始新的模型请求', async () => {
    let fail = false;
    const fileSystem = { ...fs, writeFile: async (filename: string, contents: string, options: Parameters<typeof fs.writeFile>[2]) => {
      const value = JSON.parse(contents) as { records: { run: WorkflowRun }[] };
      if (fail && value.records[0]?.run.status === 'running' && value.records[0].run.snapshot.steps[1].budgetCents === undefined) { fail = false; throw Object.assign(new Error('owned control persistence failure'), { code: 'EIO' }); }
      await fs.writeFile(filename, contents, options);
    } };
    const f = await blockedByStepLimit(fileSystem), before = (await f.engine.snapshot()).runs[0]; fail = true;
    await expect(f.engine.control({ id: f.run.id, action: 'continue', stepBudgetCents: null })).rejects.toThrow('未开始新请求');
    expect((await f.engine.snapshot()).runs[0]).toEqual(before); expect(f.calls).toHaveLength(1);
    const saved = await readLiveHistory(f.directory); expect(saved.records[0].run.snapshot.steps[1].budgetCents).toBe(10); expect(saved.records[0].request.project.budgetCents).toBe(500); await f.engine.shutdown();
  });
});
