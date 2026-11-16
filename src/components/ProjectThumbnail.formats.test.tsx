// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactMetadata, ArtifactPreview } from '../live-types';
import type { WorkflowRunner } from '../configuration-types';
import type { Project } from '../types';
import { ProjectThumbnail } from './ProjectCard';

let root: Root | undefined, container: HTMLDivElement;
const observers: { callback: IntersectionObserverCallback; connected: boolean; options?: IntersectionObserverInit }[] = [];
const gif = 'R0lGODlhAQABAIAAAP8AAAAA/yH5BAAUAAAALAAAAAABAAEAAAICRAEAIfkEABQAAAAsAAAAAAEAAQAAAgJEAQA7';
const svg = btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="12"/></svg>');
beforeEach(() => {
  observers.length = 0; vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('IntersectionObserver', class {
    item: typeof observers[number];
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) { this.item = { callback, options, connected: false }; observers.push(this.item); }
    observe() { this.item.connected = true; }
    disconnect() { this.item.connected = false; }
    unobserve() { this.item.connected = false; }
  });
  container = document.createElement('div'); document.body.append(container);
});
afterEach(async () => { try { if (root) await act(async () => root!.unmount()); } finally { root = undefined; container.remove(); vi.unstubAllGlobals(); } });
function fixture(mimeType: string, changes: Partial<ArtifactMetadata> = {}) {
  const project: Project = { id: 'preview-project', workspaceId: 'workspace', name: '实际动图项目', kind: 'image', status: 'review', description: '', updatedAt: '', version: 1, costCents: 23, accent: 'blue' };
  const artifact: ArtifactMetadata = { id: 'preview-artifact', projectId: project.id, runId: 'run', kind: 'image', mimeType, name: 'preview', bytes: 100, createdAt: '', path: 'managed/preview', ...changes };
  const thumbnail = vi.fn(async (): Promise<ArtifactPreview> => ({ mimeType, dataUrl: `data:${mimeType};base64,${mimeType === 'image/gif' ? gif : svg}` }));
  const runner = { runs: [{ id: 'run', projectId: project.id, mode: 'live', updatedAt: '', attempts: [{ status: 'complete', stepId: 'image', artifacts: [artifact] }], snapshot: { steps: [{ id: 'image', kind: 'image-generation' }] } }], thumbnailArtifact: thumbnail, previewArtifact: vi.fn() } as unknown as WorkflowRunner;
  return { project, artifact, runner, thumbnail };
}
async function render(f: ReturnType<typeof fixture>) { await act(async () => { root ||= createRoot(container); root.render(<ProjectThumbnail project={f.project} runner={f.runner} />); }); }
async function intersect(visible: boolean, index = observers.length - 1, queued = false) {
  const observer = observers[index];
  await act(async () => { if (queued || observer.connected) observer.callback([{ isIntersecting: visible } as IntersectionObserverEntry], {} as IntersectionObserver); });
}

describe('项目GIF/SVG预览真实可见性与原格式', () => {
  it('仅为显式另存成品读取本地图片，不把同项目参考图冒充生成结果', async () => {
    const f = fixture('image/gif'); f.runner.runs = [];
    const list = vi.fn(async () => [{ ...f.artifact, id: 'reference-photo' }, f.artifact]); f.runner.listProjectArtifacts = list;
    await render(f); expect(list).not.toHaveBeenCalled(); expect(f.thumbnail).not.toHaveBeenCalled();
    f.project = { ...f.project, localOutputArtifactIds: [f.artifact.id] }; await render(f); expect(list).toHaveBeenCalledExactlyOnceWith(f.project.id); await intersect(true);
    expect(f.thumbnail).toHaveBeenCalledExactlyOnceWith(f.artifact.id); expect(container.textContent).toContain('已保存图片'); expect(container.textContent).not.toContain('实际生成图片');
  });
  it('原静态位图仍走已有缩略接口和160px懒加载，不套用GIF原图20MB限制', async () => {
    const f = fixture('image/png', { bytes: 21 * 1024 * 1024 }), url = 'data:image/png;base64,iVBORw0KGgo=';
    f.thumbnail.mockResolvedValue({ mimeType: 'image/png', dataUrl: url, thumbnail: true });
    await render(f); expect(observers[0].options?.rootMargin).toBe('160px'); expect(f.thumbnail).not.toHaveBeenCalled();
    await intersect(true); expect(f.thumbnail).toHaveBeenCalledExactlyOnceWith(f.artifact.id); expect(container.querySelector('img')!.src).toBe(url);
  });
  it.each(['image/gif', 'image/svg+xml'])('%s仅实际可见时读取和挂载，离屏卸载且不栅格化', async mimeType => {
    const f = fixture(mimeType); await render(f); expect(f.thumbnail).not.toHaveBeenCalled(); expect(container.querySelector('img')).toBeNull();
    expect(observers[0].options?.rootMargin).toBe('0px'); await intersect(true);
    expect(f.thumbnail).toHaveBeenCalledExactlyOnceWith(f.artifact.id); expect(container.querySelector('img')!.src).toBe(`data:${mimeType};base64,${mimeType === 'image/gif' ? gif : svg}`);
    await intersect(true); expect(f.thumbnail).toHaveBeenCalledTimes(1);
    await intersect(false); expect(container.querySelector('img')).toBeNull();
    await intersect(true); expect(f.thumbnail).toHaveBeenCalledTimes(2); expect(container.querySelector('img')).not.toBeNull(); expect(f.project.costCents).toBe(23);
  });
  it.each([
    ['image/tiff', 100, '此格式暂无缩略预览'],
    ['image/gif', 20 * 1024 * 1024 + 1, '图片较大'],
    ['image/svg+xml', 4 * 1024 * 1024 + 1, '图片较大'],
  ])('%s不支持或过大时不读取，保留明确打开提示', async (mimeType, bytes, hint) => {
    const f = fixture(mimeType, { bytes }); await render(f);
    if (observers.length) await intersect(true);
    expect(f.thumbnail).not.toHaveBeenCalled(); expect(container.querySelector('img')).toBeNull(); expect(container.textContent).toContain(hint); expect(container.textContent).toContain('打开项目查看');
  });
  it('项目切换后丢弃旧预览与旧观察器的排队可见事件', async () => {
    const first = fixture('image/gif'); let finish!: (value: ArtifactPreview) => void;
    first.thumbnail.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await render(first); await intersect(true);
    const next = fixture('image/svg+xml'); next.project = { ...next.project, id: 'second-project' }; next.artifact.projectId = next.project.id; next.artifact.id = 'next-artifact';
    next.runner.runs[0].projectId = next.project.id; await render(next); await intersect(true, 0, true); expect(next.thumbnail).not.toHaveBeenCalled();
    await act(async () => finish({ mimeType: 'image/gif', dataUrl: `data:image/gif;base64,${gif}` })); expect(container.querySelector('img')).toBeNull();
    await intersect(true); expect(next.thumbnail).toHaveBeenCalledExactlyOnceWith('next-artifact'); expect(container.querySelector('img')!.src).toBe(`data:image/svg+xml;base64,${svg}`);
  });
});
