import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ArtifactMetadata, LiveSnapshot, LiveStartRequest } from '../live-types';
import type { WorkflowRun } from '../configuration-types';
import { quickImageWorkflowBudget, quickImageWorkflowSteps, quickImageWorkflowTail, quickWorkflowTail } from './quick-workflow';

const require = createRequire(import.meta.url), root = fileURLToPath(new URL('../../', import.meta.url));
const dependencies = createRequire(path.join(root, 'work/ui-build/package.json'));
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
const { createLiveWorkflowEngine } = require('../../electron/live-workflow-engine.cjs');
const { createDeliverySource } = require('../../electron/delivery-source.cjs');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
interface ImageCall { projectId: string; runId: string; kind: string; prompt: string; attachments: ArtifactMetadata[]; options: { count: number; size: string; background: string }; }
interface Engine { start(input: LiveStartRequest): Promise<WorkflowRun>; preflight(input: LiveStartRequest): Promise<{ ok: boolean; errors: string[] }>; snapshot(): Promise<LiveSnapshot>; control(input: { id: string; action: string }): Promise<void>; shutdown(): Promise<void>; drain(): Promise<void>; }

async function fixture(kind: 'image-generation' | 'image-editing', count: number, options: { failAt?: number; cancelAt?: number; duplicate?: boolean; excess?: boolean } = {}) {
  const directory = await fs.mkdtemp(path.join(root, 'work/quick-image-'));
  const store = createArtifactStore({ directory: path.join(directory, 'artifacts'), loadModule: dependencies });
  const calls: ImageCall[] = []; let engine: Engine, reused: ArtifactMetadata | undefined;
  engine = createLiveWorkflowEngine({ directory, artifactStore: store, credentials: { list: async () => [{ id: 'image-key', name: '仅隔离凭证元数据', connectionId: 'image-connection', enabled: true }] }, modelRuntime: {
    supports: () => true,
    execute: async (input: ImageCall) => {
      calls.push(input);
      if (calls.length === options.failAt) throw Object.assign(new Error('Owned isolated image failure'), { publicMessage: '隔离测试失败', requestStarted: false });
      const image: ArtifactMetadata = options.duplicate && reused ? reused : await store.write({ ...input, name: `actual-${calls.length}.png`, mimeType: 'image/png', buffer: PNG }); reused ||= image;
      const artifacts = [image]; if (options.excess) artifacts.push(await store.write({ ...input, name: `excess-${calls.length}.png`, mimeType: 'image/png', buffer: PNG }));
      if (calls.length === options.cancelAt) await engine.control({ id: input.runId, action: 'cancel' });
      return { artifacts, usage: { images: 1 } };
    },
  } });
  const reference: ArtifactMetadata | undefined = kind === 'image-editing' ? await store.write({ projectId: 'image-project', name: 'original-reference.png', mimeType: 'image/png', buffer: PNG }) : undefined;
  const request: LiveStartRequest = {
    project: { id: 'image-project', workspaceId: 'workspace', name: '自定义数量', kind: 'image', description: '', status: 'draft', costCents: 0, version: 0, updatedAt: '', accent: 'blue' },
    workflow: { id: 'quick-image', workspaceId: 'workspace', name: '实际逐张图片', outputKind: 'image', description: '', updatedAt: '', steps: quickImageWorkflowSteps({ id: 'producer', name: kind === 'image-editing' ? 'AI 精修' : '初次生成', kind, inputSource: 'project', enabled: true, prompt: '完整用户画面需求', count, modelConfigId: 'image-model', credentialId: 'image-key', imageSize: '1024x1024', imageBackground: 'transparent' }, quickWorkflowTail('image', kind, kind === 'image-editing' ? 'AI 精修' : '初次生成')) },
    connections: [{ id: 'image-connection', name: '隔离图片接口', providerId: 'custom', protocol: 'image', baseUrl: 'http://127.0.0.1:9001/v1', status: 'configured', enabled: true }],
    models: [{ id: 'image-model', name: '隔离图片模型', modelId: 'fixture-image', connectionId: 'image-connection', capabilities: ['image-generation', 'image-editing'], pricing: { unit: 'image', currency: 'CNY', input: '0', output: '1' }, enabled: true }],
    input: '制作本次用户图片', variables: {}, attachmentIds: reference ? [reference.id] : [], acknowledgePaidCalls: true, acknowledgeUnknownCost: true,
  };
  return { engine, store, calls, request, reference, directory };
}

async function waitFor(engine: Engine, id: string, status: WorkflowRun['status']) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const snapshot = await engine.snapshot(), run = snapshot.runs.find(item => item.id === id);
    if (run?.status === status) return { snapshot, run };
    if (run?.status === 'failed') throw new Error(run.error || 'Unexpected failure');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Waiting for ${status} timed out`);
}

function produced(run: WorkflowRun) { return run.attempts.filter(attempt => attempt.status === 'complete' && run.snapshot.steps.some(step => step.id === attempt.stepId && ['image-generation', 'image-editing'].includes(step.kind))).flatMap(attempt => attempt.artifacts || []).filter(file => file.kind === 'image'); }
const cases = (['image-generation', 'image-editing'] as const).flatMap(kind => [3, 7, 20].map(count => ({ kind, count })));

describe('快捷图片自定义数量实际执行与交付', () => {
  it.each(cases)('$kind 数量 $count : 实际执行N次、保存N份PNG、只交付N张结果并记N次费用', async ({ kind, count }) => {
    const f = await fixture(kind, count);
    try {
      const started = await f.engine.start(f.request), waiting = await waitFor(f.engine, started.id, 'waiting-review');
      expect(f.calls).toHaveLength(count); expect(produced(waiting.run)).toHaveLength(count); expect(waiting.snapshot.ledger).toHaveLength(count);
      expect(waiting.snapshot.ledger.reduce((sum, entry) => sum + entry.costCents, 0)).toBe(100 * count);
      for (const call of f.calls) { expect(call.options).toMatchObject({ count: 1, size: '1024x1024', background: 'transparent' }); expect(call.attachments.map(file => file.id)).toEqual(f.reference ? [f.reference.id] : []); }
      const fees = structuredClone(waiting.snapshot.ledger);
      await f.engine.control({ id: started.id, action: 'resume' }); const done = await waitFor(f.engine, started.id, 'complete');
      const exported = done.run.attempts.find(attempt => done.run.snapshot.steps.some(step => step.id === attempt.stepId && step.kind === 'export'))!;
      const images = exported.artifacts!.filter(file => file.kind === 'image'); expect(images).toHaveLength(count); expect(new Set(images.map(file => file.id)).size).toBe(count);
      expect(images.map(file => file.id)).toEqual(produced(waiting.run).map(file => file.id)); expect(images.some(file => file.id === f.reference?.id)).toBe(false);
      for (const image of images) expect((await f.store.read(image.id)).buffer).toEqual(PNG);
      expect((await f.engine.snapshot()).ledger).toEqual(fees); expect(f.calls).toHaveLength(count);
      const inspect = createDeliverySource({ workspaceStorage: { projectDirectory: async () => ({ directory: f.directory }), list: async () => ({ projects: [{ projectId: f.request.project.id, name: f.request.project.name }] }) }, artifactStore: f.store, liveEngine: f.engine });
      const delivered = await inspect({ projectId: f.request.project.id, kind: 'image', artifactIds: images.map(file => file.id) });
      expect(delivered.errors).toEqual([]); expect(delivered.files).toHaveLength(count);
      if (f.reference) { expect((await f.store.read(f.reference.id)).buffer).toEqual(PNG); expect((await inspect({ projectId: f.request.project.id, kind: 'image', artifactIds: [f.reference.id] })).errors.join('')).toContain('原图'); }
    } finally { await f.engine.shutdown(); }
  });

  it('失败继续只补未完成图片，首张/原始参考/旧费用保留，不从前张产物级联精修', async () => {
    const f = await fixture('image-editing', 5, { failAt: 2 });
    try {
      const started = await f.engine.start(f.request), failed = await waitFor(f.engine, started.id, 'failed');
      const originalImage = produced(failed.run)[0], completedFees = failed.snapshot.ledger.filter(entry => entry.status === 'complete'); expect(f.calls).toHaveLength(2);
      await f.engine.control({ id: started.id, action: 'resume' }); const waiting = await waitFor(f.engine, started.id, 'waiting-review');
      expect(f.calls).toHaveLength(6); expect(produced(waiting.run)).toHaveLength(5); expect(produced(waiting.run)[0].id).toBe(originalImage.id);
      for (const call of f.calls) expect(call.attachments.map(file => file.id)).toEqual([f.reference!.id]);
      for (const old of completedFees) expect(waiting.snapshot.ledger.find(entry => entry.id === old.id)).toEqual(old);
      await f.engine.control({ id: started.id, action: 'resume' }); const done = await waitFor(f.engine, started.id, 'complete');
      expect(done.snapshot.ledger.reduce((sum, entry) => sum + entry.costCents, 0)).toBe(500); expect((await f.store.read(originalImage.id)).buffer).toEqual(PNG);
    } finally { await f.engine.shutdown(); }
  });

  it('取消后停止后续单图调用，已返回两张与两次真实用量仍保留', async () => {
    const f = await fixture('image-generation', 7, { cancelAt: 2 });
    try {
      const started = await f.engine.start(f.request); await waitFor(f.engine, started.id, 'cancelled'); await f.engine.drain();
      const snapshot = await f.engine.snapshot(), run = snapshot.runs[0]; expect(f.calls).toHaveLength(2); expect(snapshot.ledger).toHaveLength(2);
      expect(snapshot.ledger.reduce((sum, entry) => sum + entry.costCents, 0)).toBe(200);
      const images = run.attempts.flatMap(attempt => attempt.artifacts || []).filter(file => file.kind === 'image'); expect(images).toHaveLength(2);
      for (const image of images) expect((await f.store.read(image.id)).buffer).toEqual(PNG);
      await f.engine.snapshot(); expect(f.calls).toHaveLength(2);
    } finally { await f.engine.shutdown(); }
  });

  it('非法或跨能力交付来源在预检拒绝，未创建模型调用或费用', async () => {
    const f = await fixture('image-generation', 3);
    try {
      const last = f.request.workflow.steps.length - 1;
      for (const ids of [[], ['producer', 'producer'], ['unknown'], [f.request.workflow.steps[last - 1].id], Array.from({ length: 21 }, (_, index) => `invalid-${index}`), 'not-array']) {
        const invalid = structuredClone(f.request); invalid.workflow.steps[last].contentSourceStepIds = ids as string[];
        expect((await f.engine.preflight(invalid)).ok).toBe(false); await expect(f.engine.start(invalid)).rejects.toThrow();
      }
      const conflict = structuredClone(f.request); conflict.workflow.steps[last].contentSourceStepId = 'producer'; expect((await f.engine.preflight(conflict)).ok).toBe(false);
      const wrongKind = structuredClone(f.request); wrongKind.workflow.steps[0].contentSourceStepIds = ['producer']; expect((await f.engine.preflight(wrongKind)).ok).toBe(false);
      const tooLong = structuredClone(f.request); while (tooLong.workflow.steps.length <= 40) tooLong.workflow.steps.push({ id: `extra-${tooLong.workflow.steps.length}`, name: '额外人工检查', kind: 'manual-review', prompt: '', inputSource: 'previous', enabled: true }); expect((await f.engine.preflight(tooLong)).errors.join('')).toContain('40');
      expect(f.calls).toHaveLength(0); expect((await f.engine.snapshot()).ledger).toEqual([]);
    } finally { await f.engine.shutdown(); }
  });

  it('原多张步骤总预算分配后不放大；不足以覆盖N张时预检拒绝且没有新费用', async () => {
    const f = await fixture('image-generation', 3);
    try {
      const first = { ...f.request.workflow.steps[0], count: 3, budgetCents: 250 };
      f.request.workflow.steps = quickImageWorkflowSteps(first, quickImageWorkflowTail(f.request.workflow.steps)!);
      expect(f.request.workflow.steps.filter(step => step.kind === 'image-generation').reduce((sum, step) => sum + step.budgetCents!, 0)).toBe(250);
      expect((await f.engine.preflight(f.request)).ok).toBe(false); await expect(f.engine.start(f.request)).rejects.toThrow('预算');
      expect(f.calls).toHaveLength(0); expect((await f.engine.snapshot()).ledger).toEqual([]);
    } finally { await f.engine.shutdown(); }
  });

  it('实际连续请求7改3改1不累积旧变体，同批多图可交付而跨运行混选仍拒绝', async () => {
    const f = await fixture('image-editing', 7); const runs: WorkflowRun[] = [];
    try {
      f.request.workflow.steps = quickImageWorkflowSteps({ ...f.request.workflow.steps[0], count: 7, budgetCents: 777 }, quickImageWorkflowTail(f.request.workflow.steps)!);
      for (const count of [7, 3, 1]) {
        f.request.workflow.steps = quickImageWorkflowSteps({ ...f.request.workflow.steps[0], count, budgetCents: quickImageWorkflowBudget(f.request.workflow.steps) }, quickImageWorkflowTail(f.request.workflow.steps)!);
        expect(quickImageWorkflowBudget(f.request.workflow.steps)).toBe(777);
        const started = await f.engine.start(f.request); const waiting = await waitFor(f.engine, started.id, 'waiting-review'); expect(produced(waiting.run)).toHaveLength(count);
        await f.engine.control({ id: started.id, action: 'resume' }); const done = await waitFor(f.engine, started.id, 'complete');
        expect(done.run.attempts.at(-1)?.artifacts?.filter(file => file.kind === 'image')).toHaveLength(count); runs.push(done.run);
      }
      expect(f.calls).toHaveLength(11); for (const call of f.calls) expect(call.attachments.map(file => file.id)).toEqual([f.reference!.id]);
      const inspect = createDeliverySource({ workspaceStorage: { projectDirectory: async () => ({ directory: f.directory }), list: async () => ({ projects: [] }) }, artifactStore: f.store, liveEngine: f.engine });
      const mixed = await inspect({ projectId: f.request.project.id, kind: 'image', artifactIds: [produced(runs[0])[0].id, produced(runs[1])[0].id] }); expect(mixed.errors.join('')).toContain('同一次生成');
      expect((await f.engine.snapshot()).ledger.reduce((sum, entry) => sum + entry.costCents, 0)).toBe(1100);
    } finally { await f.engine.shutdown(); }
  });

  it.each([{ duplicate: true }, { excess: true }])('返回重复编号或超额图片不冒充所需张数完成，保留已有产物和费用 %j', async options => {
    const f = await fixture('image-generation', 3, options);
    try {
      const started = await f.engine.start(f.request); await waitFor(f.engine, started.id, 'waiting-review');
      if ('excess' in options) await expect(f.engine.control({ id: started.id, action: 'resume' })).rejects.toThrow('来源不完整');
      else { await f.engine.control({ id: started.id, action: 'resume' }); expect((await waitFor(f.engine, started.id, 'failed')).run.error).toContain('重复'); }
      const snapshot = await f.engine.snapshot(); expect(f.calls).toHaveLength(3); expect(snapshot.ledger.reduce((sum, entry) => sum + entry.costCents, 0)).toBe(300);
      for (const image of produced(snapshot.runs[0])) expect((await f.store.read(image.id)).buffer).toEqual(PNG);
    } finally { await f.engine.shutdown(); }
  });
});
