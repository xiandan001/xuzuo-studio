import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { ArtifactMetadata, LiveStartRequest } from '../live-types';
import type { WorkflowRun } from '../configuration-types';
import { illustratedDocumentSteps } from './document-illustrations';
import { quickWorkflowTail } from './quick-workflow';
import { editorFromText } from './editor-generated';
import { replaceDocumentImage, selectedDocumentImage } from './document-image-edit';
const require = createRequire(import.meta.url);
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
const { createLiveWorkflowEngine } = require('../../electron/live-workflow-engine.cjs');
const { createEditorStore } = require('../../electron/editor-store.cjs');
const root = fileURLToPath(new URL('../../', import.meta.url));
const dependencies = createRequire(path.join(root, 'work/ui-build/package.json'));
const JSZip = dependencies('jszip');

function png(red: number) {
  const chunk = (name: string, content: Buffer) => {
    const type = Buffer.from(name), data = Buffer.concat([type, content]); let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    const header = Buffer.alloc(4), tail = Buffer.alloc(4); header.writeUInt32BE(content.length); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([header, data, tail]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(2); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = 6;
  const row = Buffer.from([0, red, 50, 100, 255, red, 50, 100, 255]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(Buffer.concat([row, row]))), chunk('IEND', Buffer.alloc(0))]);
}
const source = {
  word: { title: '实际图文交付', sections: [{ heading: '方案', paragraphs: ['完整方案文字-FIRST', '执行计划文字-END'] }] },
  ppt: { title: '实际图文交付', slides: [{ title: '方案', bullets: ['完整方案文字-FIRST'], notes: '讲解-FIRST' }, { title: '执行', bullets: ['执行计划文字-END'], notes: '讲解-END' }] },
};
const configurations = {
  connections: [{ id: 'text-c', name: '测试文字', providerId: 'custom', protocol: 'openai-chat', baseUrl: 'http://127.0.0.1:9000/v1', status: 'configured', enabled: true }, { id: 'image-c', name: '测试图片', providerId: 'custom', protocol: 'image', baseUrl: 'http://127.0.0.1:9001/v1', status: 'configured', enabled: true }],
  models: [{ id: 'text-model', name: '测试文字模型', modelId: 'fixture-text', connectionId: 'text-c', capabilities: ['text'], pricing: { unit: 'million-tokens', currency: 'CNY', input: '2', output: '8' }, enabled: true }, { id: 'image-model', name: '测试图片模型', modelId: 'fixture-image', connectionId: 'image-c', capabilities: ['image-generation', 'image-editing'], pricing: { unit: 'image', currency: 'CNY', input: '0', output: '1' }, enabled: true }],
  credentials: [{ id: 'text-key', name: '测试文字Key元数据', connectionId: 'text-c', enabled: true }, { id: 'image-key', name: '测试图片Key元数据', connectionId: 'image-c', enabled: true }],
} as unknown as Pick<import('../configuration-types').StudioConfiguration, 'models' | 'connections' | 'credentials'>;
async function waitFor(engine: ReturnType<typeof createLiveWorkflowEngine>, id: string, target: string) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const snapshot = await engine.snapshot(), run = snapshot.runs.find((item: WorkflowRun) => item.id === id);
    if (run?.status === target) return { snapshot, run };
    if (run?.status === 'failed') throw new Error(run.error);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`隔离测试等待 ${target} 超时`);
}
async function media(office: ArtifactMetadata, store: ReturnType<typeof createArtifactStore>) {
  const file = await store.read(office.id), zip = await JSZip.loadAsync(file.buffer);
  const names = Object.keys(zip.files).filter(name => /^(?:word|ppt)\/media\/[^/]+$/.test(name));
  return { zip, buffers: await Promise.all(names.map(name => zip.file(name).async('nodebuffer'))) as Buffer[] };
}

describe('图文生成到真实Office以及独立替图的完整流水线', () => {
  it.each([{ kind: 'word', mode: 'generate' }, { kind: 'ppt', mode: 'generate' }, { kind: 'word', mode: 'references' }, { kind: 'ppt', mode: 'references' }] as const)('$kind/$mode配图与编辑源/导出一致，单图精修后保留历史与全部费用', async ({ kind, mode }) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-illustrated-'));
    const store = createArtifactStore({ directory: path.join(directory, 'artifacts'), loadModule: dependencies });
    const calls: string[] = [], originalPng = png(100), changedPng = png(210);
    const engine = createLiveWorkflowEngine({ directory, artifactStore: store, credentials: { list: async () => configurations.credentials }, modelRuntime: {
      supports: (_connection: unknown, capability: string) => ['text', 'image-generation', 'image-editing'].includes(capability),
      execute: async (input: { kind: string; projectId: string; runId: string; input: string; attachments: ArtifactMetadata[] }) => {
        calls.push(input.kind);
        if (input.kind !== 'text') {
          if (input.kind === 'image-editing') expect(input.attachments.map(file => file.id)).toHaveLength(1);
          return { artifacts: [await store.write({ ...input, name: '独立插图.png', mimeType: 'image/png', buffer: input.kind === 'image-editing' ? changedPng : originalPng })], usage: { images: 1 } };
        }
        expect(input.input).toContain('完整正文');
        const text = JSON.stringify(source[kind]);
        return { text, artifacts: [await store.write({ ...input, name: 'result.txt', mimeType: 'text/plain', text })], usage: { inputTokens: 100, outputTokens: 300 } };
      },
    } });
    const project = { id: 'project', workspaceId: 'workspace', name: '实际图文交付', kind, description: '', status: 'draft', costCents: 0, version: 0, updatedAt: '', accent: 'blue' } as const;
    const textStep = { id: 'body', name: '完整正文', kind: 'text', prompt: '生成完整正文', inputSource: 'project', enabled: true, modelConfigId: 'text-model', credentialId: 'text-key' } as const;
    const references = mode === 'references' ? [await store.write({ projectId: 'project', name: '本地参考图.png', mimeType: 'image/png', buffer: originalPng })] : [];
    const initialCalls = mode === 'generate' ? ['image-generation', 'text'] : ['text'];
    const request: LiveStartRequest = { project, workflow: { id: 'illustrated', workspaceId: 'workspace', name: '图文', outputKind: kind, description: '', updatedAt: '', steps: illustratedDocumentSteps(textStep, quickWorkflowTail(kind, 'text', '初次生成'), { mode, count: 1, modelConfigId: 'image-model' }, configurations, '完整图文需求') }, connections: configurations.connections, models: configurations.models, input: '完整图文需求', variables: {}, attachmentIds: references.map(image => image.id), acknowledgePaidCalls: true, acknowledgeUnknownCost: true };
    try {
      const started = await engine.start(request), { snapshot, run } = await waitFor(engine, started.id, 'waiting-review');
      expect(calls).toEqual(initialCalls); expect(snapshot.ledger).toHaveLength(initialCalls.length);
      expect(snapshot.ledger.every((entry: { costState: string }) => entry.costState === 'calculated')).toBe(true);
      const body = run.attempts.find((attempt: { stepId: string }) => attempt.stepId === 'body'), canonical = body.artifacts.at(-1);
      const document = editorFromText(kind, project.name, (await store.read(canonical.id)).buffer.toString());
      expect(JSON.stringify(document)).toContain('执行计划文字-END');
      const target = selectedDocumentImage(document, (kind === 'word' && document.kind === 'word' ? document.blocks.find(block => block.type === 'image')!.id : document.kind === 'ppt' ? document.slides.find(slide => slide.imageId)!.id : ''))!;
      const exportAttempt = run.attempts.find((attempt: { stepId: string }) => run.snapshot.steps.some((step: { id: string; kind: string }) => step.id === attempt.stepId && step.kind === 'export'));
      const initialOffice = exportAttempt.artifacts.find((file: ArtifactMetadata) => file.kind === 'office'), initial = await media(initialOffice, store);
      expect(initial.buffers.some(buffer => buffer.equals(originalPng))).toBe(true);
      expect(await initial.zip.file(kind === 'word' ? 'word/document.xml' : 'ppt/slides/slide2.xml').async('string')).toContain('执行计划文字-END');
      const projectDirectory = path.join(directory, 'project'); await fs.mkdir(path.join(projectDirectory, '.xuzuo'), { recursive: true });
      const editor = createEditorStore({ workspaceStorage: { projectDirectory: async () => projectDirectory }, artifactStore: store });
      const revision1 = await editor.save({ projectId: project.id, expectedRevision: 0, document, sourceArtifactIds: [canonical.id] });
      await engine.control({ id: run.id, action: 'resume' }); await waitFor(engine, run.id, 'complete');
      const edit = await engine.start({ ...request, workflow: { ...request.workflow, id: 'document-image-edit-project-test', steps: [{ id: 'edit-image', kind: 'image-editing', name: '精修插图', prompt: '改变配色，保留主体', enabled: true, inputSource: 'project', modelConfigId: 'image-model', credentialId: 'image-key', count: 1 }] }, input: JSON.stringify({ version: 1, targetId: target.id, sourceImageId: target.imageId }), attachmentIds: [target.imageId] });
      const edited = await waitFor(engine, edit.id, 'complete'), image = edited.run.attempts[0].artifacts[0];
      expect(calls).toEqual([...initialCalls, 'image-editing']); expect(edited.snapshot.ledger).toHaveLength(initialCalls.length + 1);
      expect((await editor.load({ projectId: project.id, kind })).document).toEqual(document);
      const changed = replaceDocumentImage(document, target, image.id), revision2 = await editor.export({ projectId: project.id, expectedRevision: revision1.revision, document: changed, sourceArtifactIds: [canonical.id] });
      const changedMedia = await media(revision2.artifacts.find((file: ArtifactMetadata) => file.kind === 'office'), store);
      expect(changedMedia.buffers.some(buffer => buffer.equals(changedPng))).toBe(true); expect(changedMedia.buffers.some(buffer => buffer.equals(originalPng))).toBe(false);
      expect((await editor.loadVersion({ projectId: project.id, revision: revision1.revision })).document).toEqual(document);
      expect((await store.read(target.imageId)).buffer.equals(originalPng)).toBe(true);
      await editor.export({ projectId: project.id, expectedRevision: revision2.record.revision, document, sourceArtifactIds: [canonical.id] });
      const afterUndo = await engine.snapshot(); expect(afterUndo.ledger).toEqual(edited.snapshot.ledger); expect(calls).toHaveLength(initialCalls.length + 1);
    } finally {
      await engine.shutdown();
      if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep + 'xuzuo-illustrated-')) throw new Error('Refusing non-owned cleanup');
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});


describe('自定义配图数量与可恢复逐张流水线', () => {
  it.each([{ kind: 'word', count: 7, recover: true }, { kind: 'ppt', count: 7, recover: false }, { kind: 'word', count: 20, recover: false }] as const)('$kind生成$count张真实插图，完整嵌入并累计每次调用费用', async ({ kind, count, recover }) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-illustration-count-'));
    const store = createArtifactStore({ directory: path.join(directory, 'artifacts'), loadModule: dependencies });
    const calls: string[] = [], images = new Map<number, Buffer>(); let imageCalls = 0, failed = false, paused = false;
    const content = kind === 'word' ? source.word : { title: '完整配图演示', slides: Array.from({ length: count }, (_, index) => ({ title: `第${index + 1}页`, bullets: [`完整正文-${index + 1}-END`], notes: `演讲备注-${index + 1}` })) };
    const engine = createLiveWorkflowEngine({ directory, artifactStore: store, credentials: { list: async () => configurations.credentials }, modelRuntime: {
      supports: (_connection: unknown, capability: string) => ['text', 'image-generation'].includes(capability),
      execute: async (input: { kind: string; projectId: string; runId: string; prompt: string; options: { count: number } }) => {
        calls.push(input.kind);
        if (input.kind === 'text') {
          const text = JSON.stringify(content);
          return { text, artifacts: [await store.write({ ...input, name: 'result.txt', mimeType: 'text/plain', text })], usage: { inputTokens: 100, outputTokens: 300 } };
        }
        imageCalls++; expect(input.options.count).toBe(1);
        const index = Number(input.prompt.match(/本次制作第 (\d+) 张/)?.[1]); expect(index).toBeGreaterThan(0);
        if (recover && index === 4 && !failed) { failed = true; throw Object.assign(new Error('隔离临时故障'), { publicMessage: '隔离临时故障，可继续', requestStarted: true, usage: { images: 1 } }); }
        const buffer = png(50 + index); images.set(index, buffer);
        const artifact = await store.write({ ...input, name: `插图-${index}.png`, mimeType: 'image/png', buffer });
        if (recover && index === 2 && !paused) { paused = true; await engine.control({ id: input.runId, action: 'pause' }); }
        return { artifacts: [artifact], usage: { images: 1 } };
      },
    } });
    const project = { id: 'count-project', workspaceId: 'workspace', name: '自定义数量交付', kind, description: '', status: 'draft', costCents: 0, version: 0, updatedAt: '', accent: 'blue' } as const;
    const body = { id: 'body', name: '完整正文', kind: 'text', prompt: '生成完整正文', inputSource: 'project', enabled: true, modelConfigId: 'text-model', credentialId: 'text-key' } as const;
    const request: LiveStartRequest = { project, workflow: { id: 'custom-count', workspaceId: 'workspace', name: '自定义配图', outputKind: kind, description: '', updatedAt: '', steps: illustratedDocumentSteps(body, quickWorkflowTail(kind, 'text', '初次生成'), { mode: 'generate', count, modelConfigId: 'image-model' }, configurations, `完整图文 ${count} 张`) }, connections: configurations.connections, models: configurations.models, input: '完整图文需求', variables: {}, attachmentIds: [], acknowledgePaidCalls: true, acknowledgeUnknownCost: true };
    try {
      const run = await engine.start(request);
      if (recover) {
        const pausedState = await waitFor(engine, run.id, 'paused'); expect(calls).toHaveLength(2); expect(pausedState.snapshot.ledger).toHaveLength(2);
        await engine.control({ id: run.id, action: 'continue' });
        const failedState = await waitFor(engine, run.id, 'failed'); expect(calls).toHaveLength(4); expect(failedState.snapshot.ledger).toHaveLength(4);
        const paidFailure = failedState.snapshot.ledger.find((entry: { status: string }) => entry.status === 'failed'); expect(paidFailure?.costCents).toBe(100);
        await engine.control({ id: run.id, action: 'continue' });
      }
      const finished = await waitFor(engine, run.id, 'waiting-review');
      expect(imageCalls).toBe(count + (recover ? 1 : 0)); expect(calls.at(-1)).toBe('text');
      const imageEntries = finished.snapshot.ledger.filter((entry: { operation: string }) => entry.operation === 'image-generation');
      expect(imageEntries).toHaveLength(imageCalls); expect(imageEntries.reduce((sum: number, entry: { costCents: number }) => sum + entry.costCents, 0)).toBe(imageCalls * 100);
      const actual = finished.run.attempts.find((attempt: { stepId: string }) => attempt.stepId === 'body');
      const document = editorFromText(kind, project.name, actual.summary);
      const embeddedIds = document.kind === 'word' ? document.blocks.filter(block => block.type === 'image').map(block => block.imageId) : document.slides.map(slide => slide.imageId);
      expect(embeddedIds).toHaveLength(count); expect(new Set(embeddedIds).size).toBe(count);
      const office = finished.run.attempts.flatMap((attempt: { artifacts?: ArtifactMetadata[] }) => attempt.artifacts || []).find((artifact: ArtifactMetadata) => artifact.kind === 'office');
      const exported = await media(office, store); expect(exported.buffers).toHaveLength(count);
      for (const buffer of images.values()) expect(exported.buffers.some(actual => actual.equals(buffer))).toBe(true);
      const ledger = structuredClone(finished.snapshot.ledger); await engine.control({ id: run.id, action: 'resume' });
      expect((await waitFor(engine, run.id, 'complete')).snapshot.ledger).toEqual(ledger);
    } finally {
      await engine.shutdown();
      if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep + 'xuzuo-illustration-count-')) throw new Error('Refusing non-owned cleanup');
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
  it('手工篡改配图来源或超过20张时预检拒绝，模型与账本均未执行', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-illustration-invalid-'));
    const store = createArtifactStore({ directory: path.join(directory, 'artifacts'), loadModule: dependencies }); let calls = 0;
    const engine = createLiveWorkflowEngine({ directory, artifactStore: store, credentials: { list: async () => configurations.credentials }, modelRuntime: { supports: () => true, execute: async () => { calls++; throw new Error('Must never execute'); } } });
    const project = { id: 'invalid-project', workspaceId: 'workspace', name: '非法配置', kind: 'word', description: '', status: 'draft', costCents: 0, version: 0, updatedAt: '', accent: 'blue' } as const;
    const body = { id: 'body', name: '正文', kind: 'text', prompt: '完整正文', inputSource: 'project', enabled: true, modelConfigId: 'text-model', credentialId: 'text-key' } as const;
    const steps = illustratedDocumentSteps(body, quickWorkflowTail('word', 'text', '初次生成'), { mode: 'generate', count: 7, modelConfigId: 'image-model' }, configurations, '完整需求');
    const request: LiveStartRequest = { project, workflow: { id: 'invalid-flow', workspaceId: 'workspace', name: '配图', outputKind: 'word', description: '', updatedAt: '', steps }, connections: configurations.connections, models: configurations.models, input: '完整需求', variables: {}, attachmentIds: [], acknowledgePaidCalls: true, acknowledgeUnknownCost: true };
    try {
      for (const ids of [[steps[0].id, steps[0].id], ['body'], ['not-existing'], 'not-array']) {
        const invalid = structuredClone(request); invalid.workflow.steps[7].documentImageStepIds = ids as string[];
        expect((await engine.preflight(invalid)).ok).toBe(false); await expect(engine.start(invalid)).rejects.toThrow();
      }
      const tooMany = structuredClone(request); tooMany.workflow.steps.slice(0, 7).forEach(step => { step.count = 4; });
      expect((await engine.preflight(tooMany)).errors.join('')).toContain('20'); await expect(engine.start(tooMany)).rejects.toThrow();
      expect(calls).toBe(0); expect((await engine.snapshot()).ledger).toEqual([]);
    } finally {
      await engine.shutdown();
      if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep + 'xuzuo-illustration-invalid-')) throw new Error('Refusing non-owned cleanup');
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
  it('取消后不再继续逐张请求，已返回图片与两次费用保留', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-illustration-cancel-'));
    const store = createArtifactStore({ directory: path.join(directory, 'artifacts'), loadModule: dependencies }); let calls = 0;
    const engine = createLiveWorkflowEngine({ directory, artifactStore: store, credentials: { list: async () => configurations.credentials }, modelRuntime: {
      supports: () => true,
      execute: async (input: { kind: string; runId: string; projectId: string }) => {
        calls++; const image = await store.write({ ...input, name: `图片-${calls}.png`, mimeType: 'image/png', buffer: png(calls) });
        if (calls === 2) await engine.control({ id: input.runId, action: 'cancel' });
        return { artifacts: [image], usage: { images: 1 } };
      },
    } });
    const project = { id: 'cancel-project', workspaceId: 'workspace', name: '取消图文', kind: 'word', description: '', status: 'draft', costCents: 0, version: 0, updatedAt: '', accent: 'blue' } as const;
    const body = { id: 'body', name: '正文', kind: 'text', prompt: '完整正文', inputSource: 'project', enabled: true, modelConfigId: 'text-model', credentialId: 'text-key' } as const;
    try {
      const run = await engine.start({ project, workflow: { id: 'cancel-flow', workspaceId: 'workspace', name: '配图', outputKind: 'word', description: '', updatedAt: '', steps: illustratedDocumentSteps(body, quickWorkflowTail('word', 'text', '初次生成'), { mode: 'generate', count: 5, modelConfigId: 'image-model' }, configurations, '完整需求') }, connections: configurations.connections, models: configurations.models, input: '完整需求', variables: {}, attachmentIds: [], acknowledgePaidCalls: true, acknowledgeUnknownCost: true });
      await waitFor(engine, run.id, 'cancelled'); await engine.drain();
      const result = await engine.snapshot(); expect(calls).toBe(2); expect(result.ledger).toHaveLength(2);
      expect(result.ledger.reduce((sum: number, entry: { costCents: number }) => sum + entry.costCents, 0)).toBe(200);
      const imageIds = result.runs[0].attempts.flatMap((attempt: { artifacts?: ArtifactMetadata[] }) => attempt.artifacts || []).map((image: ArtifactMetadata) => image.id);
      expect(imageIds).toHaveLength(2); for (const id of imageIds) expect((await store.read(id)).buffer.length).toBeGreaterThan(0);
    } finally {
      await engine.shutdown();
      if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep + 'xuzuo-illustration-cancel-')) throw new Error('Refusing non-owned cleanup');
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
