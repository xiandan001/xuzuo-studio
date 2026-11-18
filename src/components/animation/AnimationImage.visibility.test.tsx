// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkflowRunner } from '../../configuration-types';
import type { ArtifactPreview } from '../../live-types';
import { createArtifactPreviewCache } from '../../lib/artifact-preview-cache';
import { AnimationImage } from './AnimationImage';

let host: HTMLDivElement, root: Root;
const observers: Observer[] = [];
class Observer {
  target?: Element; connected = false;
  constructor(readonly callback: IntersectionObserverCallback) { observers.push(this); }
  observe(target: Element) { this.target = target; this.connected = true; }
  disconnect() { this.connected = false; }
  queued() { this.callback([{ target: this.target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
}
const preview = (tag: string): ArtifactPreview => ({ mimeType: 'image/png', dataUrl: 'data:image/png;base64,' + btoa(tag), thumbnail: true });
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('IntersectionObserver', Observer); observers.length = 0;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function reveal(ids: string[]) {
  await act(async () => { for (const observer of observers) if (observer.connected && ids.includes((observer.target as HTMLElement).dataset.animationPreview || '')) observer.queued(); });
}
it('100项列表首屏0→可见6→滚动12，重挂复用真实预览缓存不再读', async () => {
  const ids = Array.from({ length: 100 }, (_, index) => 'image-' + index), raw = vi.fn(async (id: string) => preview(id));
  const cache = createArtifactPreviewCache({ completed: true, maxEntries: 32, ttlMs: 5000 });
  const runner = { thumbnailArtifact: (id: string) => cache.preview('workspace', id, () => raw(id)), previewArtifact: vi.fn() } as unknown as WorkflowRunner;
  const list = () => <>{ids.map(id => <AnimationImage key={id} artifactId={id} projectId="project-a" runner={runner} />)}</>;
  await act(async () => root.render(list())); expect(raw).not.toHaveBeenCalled();
  await reveal(ids.slice(0, 6)); expect(raw).toHaveBeenCalledTimes(6); expect(host.querySelectorAll('img')).toHaveLength(6);
  await reveal(ids.slice(6, 12)); expect(raw).toHaveBeenCalledTimes(12); expect(host.querySelectorAll('img')).toHaveLength(12);
  await act(async () => root.render(<></>)); await act(async () => root.render(list()));
  await reveal(ids.slice(0, 12)); expect(raw).toHaveBeenCalledTimes(12); expect(host.querySelectorAll('img')).toHaveLength(12); expect(runner.previewArtifact).not.toHaveBeenCalled();
});

it('切项目后旧观察回调和晚到的原项目读取都不显示，也不为新列表提前排IPC', async () => {
  let complete!: (value: ArtifactPreview) => void;
  const thumbnailArtifact = vi.fn().mockImplementationOnce(() => new Promise<ArtifactPreview>(resolve => { complete = resolve; })).mockResolvedValue(preview('project-b'));
  const runner = { thumbnailArtifact, previewArtifact: vi.fn() } as unknown as WorkflowRunner;
  await act(async () => root.render(<AnimationImage projectId="a" artifactId="same-id" runner={runner} />));
  await reveal(['same-id']); expect(thumbnailArtifact).toHaveBeenCalledTimes(1);
  const old = observers[0]; await act(async () => root.render(<AnimationImage projectId="b" artifactId="same-id" runner={runner} />));
  await act(async () => { old.queued(); complete(preview('project-a')); }); expect(host.querySelector('img')).toBeNull(); expect(thumbnailArtifact).toHaveBeenCalledTimes(1);
  await reveal(['same-id']); expect(thumbnailArtifact).toHaveBeenCalledTimes(2); expect(host.querySelector('img')!.getAttribute('src')).toBe(preview('project-b').dataUrl);
});

it('只有明确播放的当前GIF直接读取完整预览，静态列表仍等进入可见区', async () => {
  const runner = { thumbnailArtifact: vi.fn(async () => preview('static')), previewArtifact: vi.fn(async () => ({ mimeType: 'image/gif', dataUrl: 'data:image/gif;base64,fixture' })) } as unknown as WorkflowRunner;
  await act(async () => root.render(<><AnimationImage projectId="a" artifactId="selected" runner={runner} animated /><AnimationImage projectId="a" artifactId="other" runner={runner} /></>));
  expect(runner.previewArtifact).toHaveBeenCalledTimes(1); expect(runner.previewArtifact).toHaveBeenCalledWith('selected'); expect(runner.thumbnailArtifact).not.toHaveBeenCalled();
  expect(host.querySelector('img')!.getAttribute('loading')).toBe('eager');
  await reveal(['other']); expect(runner.thumbnailArtifact).toHaveBeenCalledTimes(1); expect(runner.previewArtifact).toHaveBeenCalledTimes(1);
});

it('无IntersectionObserver的环境保留可用预览，但静态GIF不会当作列表动图播放', async () => {
  vi.stubGlobal('IntersectionObserver', undefined);
  const runner = { previewArtifact: vi.fn(async () => ({ mimeType: 'image/gif', dataUrl: 'data:image/gif;base64,fixture' })) } as unknown as WorkflowRunner;
  await act(async () => root.render(<AnimationImage projectId="a" artifactId="gif" runner={runner} />));
  expect(runner.previewArtifact).toHaveBeenCalledTimes(1); expect(host.querySelector('img')).toBeNull(); expect(host.textContent).toContain('动态素材需选中后播放');
});
