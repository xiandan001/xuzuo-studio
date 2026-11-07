// @vitest-environment jsdom
import { act } from 'react';
import { Blob as NodeBlob } from 'node:buffer';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageProps, Project } from '../types';
import type { ArtifactMetadata, GeneratedAnimationReference, GeneratedAnimationReferenceInput } from '../live-types';
import type { WorkflowRun } from '../configuration-types';
import { ImageStudio } from './ImageStudio';
import { imageDraftKey } from '../lib/image-studio';
import { studioPreferenceKey } from '../lib/studio-layout-state';
import { writeDisclosure } from '../lib/disclosure-state';

const project: Project = Object.freeze({ id: 'mode-project', workspaceId: 'mode-workspace', name: '模式附件隔离', kind: 'image', status: 'draft', description: '生成描述', updatedAt: '2026-11-07T00:00:00Z', costCents: 23, version: 0, accent: 'blue' });
const image = (id: string): ArtifactMetadata => ({ id, projectId: project.id, kind: 'image', name: `${id}.png`, mimeType: 'image/png', bytes: 68, path: `files/${id}.png`, createdAt: project.updatedAt });
const a = image('create-a'), b = image('result-b'), b2 = image('result-b2'), c = image('refine-c');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';
const gifBytes = Uint8Array.from(Buffer.from('47494638396101000100800000ff00000000ff21ff0b4e45545343415045322e30030100000021f90400140000002c000000000100010000020244010021f90400140000002c00000000010001000002024c01003b', 'hex'));
const gifOne: ArtifactMetadata = { ...image('gif-one'), name: '动画一.gif', mimeType: 'image/gif', runId: 'generated-gif-one' }, gifTwo: ArtifactMetadata = { ...image('gif-two'), name: '动画二.gif', mimeType: 'image/gif', runId: 'generated-gif-two' };
let root: Root | undefined, container: HTMLDivElement, previousStorage: [string, string][], desktopDescriptor: PropertyDescriptor | undefined;

function resultRun(file = b): WorkflowRun {
  return { id: `generated-${file.id}`, mode: 'live', workspaceId: project.workspaceId, projectId: project.id, workflowId: 'generated-image', workflowName: '生成图片', status: 'complete', stepIndex: 1, input: '', variables: {}, createdAt: project.updatedAt, updatedAt: project.updatedAt,
    snapshot: { id: 'generated-image', name: '生成图片', workspaceId: project.workspaceId, outputKind: 'image', description: '', updatedAt: project.updatedAt, steps: [{ id: 'image', name: '图片', kind: 'image-editing', modelConfigId: 'editing-model', prompt: '', inputSource: 'project', enabled: true }] },
    attempts: [{ id: `attempt-${file.id}`, stepId: 'image', stepName: '图片', modelLabel: '测试编辑模型', status: 'complete', costCents: 23, summary: '', input: '', prompt: '', action: '初次生成', artifacts: [file] }] };
}
function fixture() {
  const onGenerate = vi.fn(), removed = vi.fn(() => { throw Error('Mode changes must not remove artifacts'); });
  const ledger = Object.freeze([Object.freeze({ id: 'existing-fee', projectId: project.id, projectName: project.name, time: project.updatedAt, action: '初次生成', model: '测试编辑模型', status: 'complete', billingMode: 'live', costState: 'calculated', costCents: 23 })]);
  const runner = { runs: [] as WorkflowRun[], runtimeStatus: { available: true }, trashedArtifacts: [], importFiles: vi.fn(async () => [c]), previewArtifact: vi.fn(async (id: string) => ({ id, mimeType: 'image/png', supported: true, dataUrl: png })), inspectImageArtifact: vi.fn(async (id: string) => ({ id, mimeType: 'image/png', bytes: 68 })), trashArtifact: removed, deleteArtifact: removed };
  const props = { activeProject: project, projects: [project], workspaceId: project.workspaceId, workspace: { id: project.workspaceId, name: '隔离工作区' }, preferences: {}, ledger, prompts: [], workflowRunner: runner, onGenerate, onPromptApplied: vi.fn(), onUpdateProject: vi.fn(), notify: vi.fn(),
    configuration: { categories: [], workflows: [], studioActions: [], credentials: [{ id: 'fixture-key', name: '元数据账户', connectionId: 'connection', enabled: true }], connections: [{ id: 'connection', name: '隔离服务', enabled: true }], models: [{ id: 'generation-model', name: '生成模型', modelId: 'fixture-generation', connectionId: 'connection', capabilities: ['image-generation'], enabled: true }, { id: 'editing-model', name: '编辑模型', modelId: 'fixture-editing', connectionId: 'connection', capabilities: ['image-editing'], enabled: true }] } } as unknown as PageProps;
  return { props, runner, onGenerate, removed, ledger };
}
function animationFixture() {
  const f = fixture(), references = new Map<string, ArtifactMetadata>(), converted = vi.fn();
  f.props.configuration.models.find(model => model.id === 'editing-model')!.modelId = 'gpt-image-2.6-sunburst';
  const context = (id: string): GeneratedAnimationReference => ({ sourceArtifactId: id, sourceSha256: (id === gifOne.id ? 'a' : 'b').repeat(64), prompt: `原动画动作描述：${id}中的星星缓慢升起`, imageOptions: { imageOutputFormat: 'gif', imageFrameCount: 2, imageFrameDurationMs: 200 }, mimeType: 'image/gif', width: 1, height: 1 });
  const prepare = vi.fn(async (input: GeneratedAnimationReferenceInput): Promise<GeneratedAnimationReference> => {
    if (!input.pngBytes) return { ...context(input.sourceArtifactId), sourceBytes: gifBytes };
    expect(input.sourceSha256).toBe(context(input.sourceArtifactId).sourceSha256); expect(Array.from(input.pngBytes.slice(0, 4))).toEqual([137, 80, 78, 71]);
    const reference = image(`reference-${input.sourceArtifactId}`); references.set(reference.id, reference); return { ...context(input.sourceArtifactId), reference };
  });
  const runner = { ...f.runner, runs: [resultRun(gifOne)], prepareGeneratedAnimationReference: prepare, listProjectArtifacts: vi.fn(async () => [a, b, c, gifOne, gifTwo, ...references.values()]) };
  f.props.workflowRunner = runner as unknown as PageProps['workflowRunner'];
  const OriginalURL = URL; vi.stubGlobal('URL', class extends OriginalURL { static createObjectURL = vi.fn(() => 'blob:animation-fixture'); static revokeObjectURL = vi.fn(); });
  vi.stubGlobal('Image', class { naturalWidth = 1; naturalHeight = 1; onload: (() => void) | null = null; onerror: (() => void) | null = null; set src(value: string) { if (value) { converted(); queueMicrotask(() => this.onload?.()); } } });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => { queueMicrotask(() => callback(new NodeBlob([Buffer.from(png.split(',')[1], 'base64')], { type: 'image/png' }) as unknown as Blob)); });
  return { ...f, runner, prepare, context, converted, references };
}
beforeEach(() => {
  previousStorage = Array.from({ length: localStorage.length }, (_, index): [string, string] => { const key = localStorage.key(index)!; return [key, localStorage.getItem(key)!]; });
  localStorage.clear(); desktopDescriptor = Object.getOwnPropertyDescriptor(window, 'desktop'); Object.defineProperty(window, 'desktop', { configurable: true, value: undefined });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', vi.fn(() => { throw Error('No provider or network calls in mode fixture'); }));
  vi.stubGlobal('IntersectionObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  container = document.createElement('div'); document.body.append(container);
  for (const [name, value] of [['initialized', true], ['panel-open', true], ['focus', false], ['tool', 'ai']] as const) writeDisclosure(studioPreferenceKey('images', { workspaceId: project.workspaceId, projectId: project.id }, name), value);
  localStorage.setItem(imageDraftKey(project.id), JSON.stringify({ prompt: '生成描述', refinePrompt: '精修要求', mode: 'create', generationModelId: 'generation-model', editingModelId: 'editing-model', references: [{ id: a.id, name: a.name }] }));
});
afterEach(async () => {
  try { if (root) await act(async () => root!.unmount()); expect(fetch).not.toHaveBeenCalled(); }
  finally { root = undefined; container.remove(); if (desktopDescriptor) Object.defineProperty(window, 'desktop', desktopDescriptor); else delete window.desktop; vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); for (const [key, value] of previousStorage) localStorage.setItem(key, value); }
});
async function render(props: PageProps) { await act(async () => { root ||= createRoot(container); root.render(<ImageStudio {...props} />); }); }
async function click(selector: string) { const button = container.querySelector<HTMLButtonElement>(selector); expect(button).not.toBeNull(); expect(button!.disabled).toBe(false); await act(async () => button!.click()); }
const mode = (value: 'create' | 'refine') => click(`.ig-mode-tabs button:nth-child(${value === 'create' ? 1 : 2})`);
const generate = () => click('.ig-primary-action > button');

describe('图片工作台模式与实际提交附件', () => {
  it('继续修改GIF在同次主按钮点击免费准备PNG，保留动作描述且最新修改与可见动画参数优先', async () => {
    const f = animationFixture(), saved = JSON.parse(localStorage.getItem(imageDraftKey(project.id))!);
    saved.imageOptions = { imageOutputFormat: 'gif', imageFrameCount: 6, imageFrameDurationMs: 300 }; localStorage.setItem(imageDraftKey(project.id), JSON.stringify(saved));
    await render(f.props); await mode('refine'); expect(container.querySelector('.ig-primary-action > button')!.textContent).toContain('继续修改动画 · 1 份'); await generate(); await vi.waitFor(() => expect(f.onGenerate).toHaveBeenCalledTimes(1));
    expect(f.prepare).toHaveBeenCalledTimes(2); expect(f.converted).toHaveBeenCalledTimes(1); expect(f.onGenerate).toHaveBeenCalledTimes(1);
    const payload = f.onGenerate.mock.calls[0][4];
    expect(payload.attachmentIds).toEqual(['reference-gif-one']); expect(payload.attachmentIds).not.toContain(gifOne.id);
    expect(payload).toMatchObject({ imageOutputFormat: 'gif', imageFrameCount: 6, imageFrameDurationMs: 300 });
    expect(payload.prompt).toContain('星星缓慢升起'); expect(payload.prompt).toContain('本次修改，优先执行'); expect(payload.prompt.endsWith('精修要求')).toBe(true);
    expect(container.querySelector<HTMLTextAreaElement>('.ig-prompt')!.value).toBe('精修要求'); expect(f.removed).not.toHaveBeenCalled(); expect(f.ledger[0].costCents).toBe(23);
  });
  it('切换当前GIF和重挂载均自动重准备，旧GIF的PNG不会进入新版本请求', async () => {
    const f = animationFixture(); await render(f.props); await mode('refine'); await generate(); await vi.waitFor(() => expect(f.onGenerate).toHaveBeenCalledTimes(1));
    await act(async () => root!.unmount()); root = undefined;
    f.runner.runs = [resultRun(gifTwo), resultRun(gifOne)]; await render(f.props); await generate(); await vi.waitFor(() => expect(f.onGenerate).toHaveBeenCalledTimes(2));
    expect(f.onGenerate.mock.calls.map(call => call[4].attachmentIds)).toEqual([['reference-gif-one'], ['reference-gif-two']]);
    expect(JSON.parse(localStorage.getItem(imageDraftKey(project.id))!).animationReference.sourceArtifactId).toBe(gifTwo.id);
    expect(f.references.has('reference-gif-one')).toBe(true); expect(f.references.has('reference-gif-two')).toBe(true); expect(f.ledger[0].costCents).toBe(23);
  });
  it('取消原生检查期间的动画准备后，晚回复不转换、不保存、不提交', async () => {
    const f = animationFixture(); let finish!: (value: GeneratedAnimationReference) => void;
    f.prepare.mockImplementationOnce(() => new Promise<GeneratedAnimationReference>(resolve => { finish = resolve; }));
    await render(f.props); await mode('refine'); await generate(); await click('[aria-label="取消动画准备"]');
    await act(async () => finish({ ...f.context(gifOne.id), sourceBytes: gifBytes }));
    expect(f.converted).not.toHaveBeenCalled(); expect(f.prepare).toHaveBeenCalledTimes(1); expect(f.references.size).toBe(0); expect(f.onGenerate).not.toHaveBeenCalled(); expect(f.ledger[0].costCents).toBe(23);
  });
  it('准备期间切换到另一个GIF会丢弃旧回复，随后本次点击只提交新GIF的PNG', async () => {
    const f = animationFixture(); let finish!: (value: GeneratedAnimationReference) => void;
    f.prepare.mockImplementationOnce(() => new Promise<GeneratedAnimationReference>(resolve => { finish = resolve; }));
    await render(f.props); await mode('refine'); await generate();
    f.runner.runs = [resultRun(gifTwo), resultRun(gifOne)]; await render(f.props);
    await act(async () => finish({ ...f.context(gifOne.id), sourceBytes: gifBytes })); expect(f.onGenerate).not.toHaveBeenCalled();
    await generate(); await vi.waitFor(() => expect(f.onGenerate).toHaveBeenCalledTimes(1));
    expect(f.onGenerate.mock.calls[0][4].attachmentIds).toEqual(['reference-gif-two']); expect(f.references.has('reference-gif-one')).toBe(false); expect(f.ledger[0].costCents).toBe(23);
  });
  it('PNG保存已接受后取消，晚保存结果保留但不改草稿或提交模型', async () => {
    const f = animationFixture(), original = f.prepare.getMockImplementation()!;
    let accepted!: () => void, finish!: () => void;
    const saving = new Promise<void>(resolve => { accepted = resolve; });
    f.prepare.mockImplementation(async input => {
      const value = await original(input); if (!input.pngBytes) return value;
      accepted(); return new Promise<GeneratedAnimationReference>(resolve => { finish = () => resolve(value); });
    });
    await render(f.props); await mode('refine'); await generate(); await act(async () => { await saving; });
    await click('[aria-label="取消动画准备"]'); await act(async () => finish());
    expect(f.references.has('reference-gif-one')).toBe(true); expect(f.onGenerate).not.toHaveBeenCalled(); expect(f.removed).not.toHaveBeenCalled(); expect(f.ledger[0].costCents).toBe(23);
    expect(JSON.parse(localStorage.getItem(imageDraftKey(project.id))!).animationReference).toBeUndefined();
  });
  it('明确手动PNG参考仍固定，选中GIF也不会自动替换或转换', async () => {
    const saved = JSON.parse(localStorage.getItem(imageDraftKey(project.id))!); saved.mode = 'refine'; saved.references = [b, c]; localStorage.setItem(imageDraftKey(project.id), JSON.stringify(saved));
    const f = animationFixture(); await render(f.props); await generate();
    expect(f.onGenerate.mock.calls[0][4].attachmentIds).toEqual([b.id, c.id]); expect(f.prepare).not.toHaveBeenCalled(); expect(f.converted).not.toHaveBeenCalled(); expect(f.ledger[0].costCents).toBe(23);
  });
  it('外部GIF导入明确拒绝，当前PNG参考/原件与费用保留且零转换零提交', async () => {
    const f = animationFixture(); f.runner.runs = []; f.runner.importFiles.mockResolvedValueOnce([{ ...gifOne, runId: undefined }]);
    await render(f.props); await click('[aria-label="导入图片"]');
    expect(container.textContent).toContain('外部GIF暂不支持直接精修'); expect(f.prepare).not.toHaveBeenCalled(); expect(f.converted).not.toHaveBeenCalled(); expect(f.onGenerate).not.toHaveBeenCalled(); expect(f.removed).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(imageDraftKey(project.id))!).references.map((file: { id: string }) => file.id)).toEqual([a.id]); expect(f.ledger[0].costCents).toBe(23);
  });
  it('生成A→产物B→精修仅B→导入C为B+C→回生成A，重挂载仍隔离且不删文件或费用', async () => {
    const f = fixture(), originalLedger = JSON.stringify(f.ledger);
    await render(f.props); await generate();
    f.runner.runs = [resultRun()]; await render(f.props);
    await mode('refine'); await generate();
    expect(container.querySelector('[aria-label="移除参考图 create-a.png"]')).toBeNull();
    await click('[aria-label="导入图片"]'); await generate();
    await mode('create'); await generate();
    expect(f.onGenerate.mock.calls.map(call => call[4].attachmentIds)).toEqual([[a.id], [b.id], [b.id, c.id], [a.id]]);
    f.runner.runs = [resultRun(b2), resultRun()]; await render(f.props);
    await mode('refine'); await generate();
    expect(f.onGenerate.mock.calls.at(-1)![4].attachmentIds).toEqual([b2.id, c.id]);
    await mode('create'); await generate();
    expect(f.onGenerate.mock.calls.at(-1)![4].attachmentIds).toEqual([a.id]);
    await act(async () => root!.unmount()); root = undefined;
    await render(f.props); await mode('refine'); await generate();
    expect(f.onGenerate.mock.calls.at(-1)![4]).toMatchObject({ capability: 'image-editing', attachmentIds: [b2.id, c.id], credentialId: 'fixture-key', prompt: '精修要求' });
    expect(f.runner.importFiles).toHaveBeenCalledWith(project.id); expect(f.removed).not.toHaveBeenCalled(); expect(f.props.onUpdateProject).not.toHaveBeenCalled(); expect(JSON.stringify(f.ledger)).toBe(originalLedger); expect(project.costCents).toBe(23);
  });
  it('精修B+C关闭后后台返回B2，重挂载直接提交B2+C并保存新的自动基底', async () => {
    const f = fixture(); f.runner.runs = [resultRun()];
    await render(f.props); await mode('refine'); await click('[aria-label="导入图片"]');
    expect(JSON.parse(localStorage.getItem(imageDraftKey(project.id))!).galleryBaseId).toBe(b.id);
    await act(async () => root!.unmount()); root = undefined;
    f.runner.runs = [resultRun(b2), resultRun()]; await render(f.props); await generate();
    expect(f.onGenerate.mock.calls[0][4].attachmentIds).toEqual([b2.id, c.id]);
    const persisted = JSON.parse(localStorage.getItem(imageDraftKey(project.id))!);
    expect(persisted.references.map((file: { id: string }) => file.id)).toEqual([b2.id, c.id]); expect(persisted.galleryBaseId).toBe(b2.id);
    expect(f.removed).not.toHaveBeenCalled(); expect(f.ledger[0].costCents).toBe(23);
  });
  it('没有自动标记的手动B+C在新产物B2、模式往返和重挂载后仍提交原基底', async () => {
    const saved = JSON.parse(localStorage.getItem(imageDraftKey(project.id))!);
    saved.mode = 'refine'; saved.references = [b, c]; saved.referenceDrafts = { create: { references: [a] }, refine: { references: [b, c] } };
    localStorage.setItem(imageDraftKey(project.id), JSON.stringify(saved));
    const f = fixture(); f.runner.runs = [resultRun(b2), resultRun()];
    await render(f.props); await generate(); await mode('create'); await generate(); await mode('refine'); await generate();
    await act(async () => root!.unmount()); root = undefined; await render(f.props); await generate();
    expect(f.onGenerate.mock.calls.map(call => call[4].attachmentIds)).toEqual([[b.id, c.id], [a.id], [b.id, c.id], [b.id, c.id]]);
    expect(JSON.parse(localStorage.getItem(imageDraftKey(project.id))!).galleryBaseId).toBeUndefined();
    expect(f.removed).not.toHaveBeenCalled(); expect(f.ledger[0].costCents).toBe(23);
  });
  it('导入期间切回生成后迟到的精修参考不污染任一模式，文件删除和费用操作均不发生', async () => {
    const f = fixture(); f.runner.runs = [resultRun()];
    let release!: (files: ArtifactMetadata[]) => void;
    f.runner.importFiles.mockImplementationOnce(() => new Promise<ArtifactMetadata[]>(resolve => { release = resolve; }));
    await render(f.props); await mode('refine'); await click('[aria-label="导入图片"]');
    await mode('create'); await act(async () => release([c])); await generate();
    await mode('refine'); await generate();
    expect(f.onGenerate.mock.calls.map(call => call[4].attachmentIds)).toEqual([[a.id], [b.id]]);
    expect(f.removed).not.toHaveBeenCalled(); expect(f.props.onUpdateProject).not.toHaveBeenCalled(); expect(f.ledger[0].costCents).toBe(23);
  });
});
