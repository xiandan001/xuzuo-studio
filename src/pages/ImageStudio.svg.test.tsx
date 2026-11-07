// @vitest-environment jsdom
import { act } from 'react';
import { Blob as NodeBlob } from 'node:buffer';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageProps, Project } from '../types';
import type { ArtifactMetadata, SvgReference, SvgReferenceInput } from '../live-types';
import { ImageStudio } from './ImageStudio';
import { imageDraftKey } from '../lib/image-studio';

const project: Project = { id: 'svg-project', workspaceId: 'svg-workspace', name: 'SVG本地参考', kind: 'image', status: 'draft', description: '制作红色图标', updatedAt: '2026-11-07T00:00:00Z', costCents: 23, version: 0, accent: 'blue' };
const svgBytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="1"><path d="M0 0h1v1H0z"/></svg>');
const original: ArtifactMetadata = { id: 'svg-source', projectId: project.id, kind: 'image', name: '原矢量.svg', mimeType: 'image/svg+xml', bytes: svgBytes.length, path: 'files/source.svg', createdAt: project.updatedAt };
const reference: ArtifactMetadata = { ...original, id: 'png-reference', name: '原矢量-参考.png', mimeType: 'image/png', bytes: 68, path: 'files/reference.png' };
const source: SvgReference = { sourceArtifactId: original.id, sourceSha256: 'a'.repeat(64), mimeType: 'image/svg+xml', sourceWidth: 32, sourceHeight: 1, width: 2048, height: 64, sourceBytes: svgBytes };
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';
let root: Root | undefined, container: HTMLDivElement;
const scrollDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');

function fixture() {
  const prepare = vi.fn(async (input: SvgReferenceInput): Promise<SvgReference> => input.pngBytes ? { ...source, sourceBytes: undefined, reference } : { ...source });
  const onGenerate = vi.fn(), ledger = Object.freeze([{ id: 'charged', projectId: project.id, costCents: 23, billingMode: 'live', costState: 'calculated' }]);
  const runner = { prepareSvgReference: prepare, runtimeStatus: { available: true }, trashedArtifacts: [], previewArtifact: vi.fn(async (id: string) => ({ mimeType: id === original.id ? 'image/svg+xml' : 'image/png', supported: true, dataUrl: id === original.id ? 'data:image/svg+xml;base64,' + Buffer.from(svgBytes).toString('base64') : png })), inspectImageArtifact: vi.fn(async (id: string) => ({ id, mimeType: 'image/png', bytes: 68 })), listProjectArtifacts: vi.fn(async () => [original, reference]), runs: [{ id: 'source-run', mode: 'live', workspaceId: project.workspaceId, projectId: project.id, workflowId: 'image-workflow', workflowName: '矢量制作', status: 'complete', stepIndex: 1, input: '', variables: {}, createdAt: project.updatedAt, updatedAt: project.updatedAt, snapshot: { steps: [{ id: 'image', kind: 'image-generation' }] }, attempts: [{ id: 'attempt', stepId: 'image', stepName: '生成', status: 'complete', action: '初次生成', costCents: 23, artifacts: [original] }] }] };
  const props = { activeProject: project, projects: [project], workspaceId: project.workspaceId, workspace: { id: project.workspaceId, name: '本地验收' }, preferences: {}, prompts: [], ledger, workflowRunner: runner, onGenerate, onPromptApplied: vi.fn(), onUpdateProject: vi.fn(), notify: vi.fn(), configuration: { categories: [], workflows: [], studioActions: [], credentials: [{ id: 'metadata-only', name: '仅账户元数据', connectionId: 'connection', enabled: true }], connections: [{ id: 'connection', name: '隔离', providerId: 'openai', enabled: true }], models: [{ id: 'image-model', name: '2.6图片', modelId: 'gpt-image-2.6-sunburst', connectionId: 'connection', capabilities: ['image-generation', 'image-editing'], enabled: true }] } } as unknown as PageProps;
  return { props, prepare, onGenerate, ledger };
}
async function render(props: PageProps) { await act(async () => { root ??= createRoot(container); root.render(<ImageStudio {...props} />); }); }
async function convert() {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === '转PNG作参考'); expect(button?.disabled).toBe(false);
  await act(async () => button!.click());
}
beforeEach(() => {
  localStorage.clear(); localStorage.setItem(imageDraftKey(project.id), JSON.stringify({ mode: 'create', quantity: 1, prompt: '文字制作SVG', refinePrompt: '把红色改成蓝色', imageOptions: { imageOutputFormat: 'svg', imageSvgModel: 'author-model' } }));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', vi.fn(() => { throw Error('No model or network calls'); }));
  Object.defineProperty(window, 'desktop', { configurable: true, value: undefined });
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  const OriginalURL = URL; vi.stubGlobal('URL', class extends OriginalURL { static createObjectURL = vi.fn(() => 'blob:svg-ui'); static revokeObjectURL = vi.fn(); });
  vi.stubGlobal('Image', class { onload: (() => void) | null = null; onerror: (() => void) | null = null; set src(value: string) { if (value) queueMicrotask(() => this.onload?.()); } });
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(png);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => queueMicrotask(() => callback(new NodeBlob([Buffer.from(png.split(',')[1], 'base64')], { type: 'image/png' }) as unknown as Blob)));
  container = document.createElement('div'); document.body.append(container);
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; container.remove(); localStorage.clear(); if (scrollDescriptor) Object.defineProperty(Element.prototype, 'scrollIntoView', scrollDescriptor); else Reflect.deleteProperty(Element.prototype, 'scrollIntoView'); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('SVG workbench explicit local reference action', () => {
  it('shows the vector limitation and locally creates a fixed PNG reference; only a later click starts PNG editing', async () => {
    const f = fixture(); await render(f.props);
    expect(container.textContent).toContain('静态矢量原文件，可在矢量工具中编辑'); expect(container.textContent).toContain('另存原SVG');
    await convert(); await vi.waitFor(() => expect(f.prepare).toHaveBeenCalledTimes(2));
    const saved = JSON.parse(localStorage.getItem(imageDraftKey(project.id))!);
    expect(saved).toMatchObject({ mode: 'refine', references: [{ id: reference.id }], imageOptions: { imageOutputFormat: 'png' } });
    expect(saved.galleryBaseId).toBeUndefined(); expect(saved.animationReference).toBeUndefined(); expect(saved.imageOptions.imageSvgModel).toBeUndefined(); expect(f.onGenerate).not.toHaveBeenCalled();
    const generate = container.querySelector<HTMLButtonElement>('.ig-primary-action > .btn-primary'); expect(generate?.disabled).toBe(false);
    await act(async () => generate!.click());
    expect(f.onGenerate).toHaveBeenCalledTimes(1); expect(f.onGenerate.mock.calls[0][4]).toMatchObject({ capability: 'image-editing', attachmentIds: [reference.id], imageOutputFormat: 'png' });
    expect(f.ledger[0].costCents).toBe(23);
  });
  it('switching projects discards a late SVG admission without conversion, save or model calls', async () => {
    const f = fixture(); let finish!: (value: SvgReference) => void;
    f.prepare.mockImplementationOnce(() => new Promise<SvgReference>(resolve => { finish = resolve; }));
    await render(f.props); await convert();
    const next = { ...project, id: 'next-project', name: '另一个项目' }; await render({ ...f.props, activeProject: next, projects: [project, next] });
    await act(async () => finish(source));
    expect(f.prepare).toHaveBeenCalledTimes(1); expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled(); expect(f.onGenerate).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(imageDraftKey(project.id))!).imageOptions.imageOutputFormat).toBe('svg'); expect(f.ledger[0].costCents).toBe(23);
  });
});
