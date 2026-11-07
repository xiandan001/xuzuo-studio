// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageGallery } from './ImageGallery';
import type { WorkflowRunner } from '../configuration-types';
import type { ArtifactMetadata, ArtifactPreview } from '../live-types';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';
const large: ArtifactMetadata = { id: 'large-png', projectId: 'project', kind: 'image', mimeType: 'image/png', bytes: 21 * 1024 * 1024, name: '原尺寸壁纸.png', path: 'managed/large', createdAt: '' };
const thumbnail: ArtifactPreview = { mimeType: 'image/png', dataUrl: png, thumbnail: true, width: 240, height: 320, originalWidth: 2048, originalHeight: 2732, transparency: 'unknown' };
let root: Root | undefined, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', vi.fn(() => { throw Error('Native preview fallback must not call a provider'); })); container = document.createElement('div'); document.body.append(container); });
afterEach(async () => { try { if (root) await act(async () => root!.unmount()); expect(fetch).not.toHaveBeenCalled(); } finally { root = undefined; container.remove(); vi.unstubAllGlobals(); } });
function fixture(file = large) {
  const previewArtifact = vi.fn(async (): Promise<ArtifactPreview> => ({ mimeType: file.mimeType })), thumbnailArtifact = vi.fn(async (): Promise<ArtifactPreview> => thumbnail);
  const onImageReady = vi.fn(), onMetadataReady = vi.fn(), onSave = vi.fn();
  const props = { images: [file], selectedId: file.id, runner: { previewArtifact, thumbnailArtifact } as unknown as WorkflowRunner, onSelect: vi.fn(), onRefine: vi.fn(), onSave, saving: false, canRefine: true, onImageReady, onMetadataReady, showHistory: false };
  return { props, previewArtifact, thumbnailArtifact, onImageReady, onMetadataReady, onSave };
}
async function render(props: ReturnType<typeof fixture>['props']) { await act(async () => { root ||= createRoot(container); root.render(<ImageGallery {...props} />); }); }
const mainImage = () => container.querySelector<HTMLImageElement>('.ig-main-image');
async function imageLoad() { await act(async () => mainImage()!.dispatchEvent(new Event('load', { bubbles: true }))); }

describe('大图只读缩略兜底与真实尺寸', () => {
  it.each(['unsupported', 'failure'])('全图%s后显示受控缩略，使用native原尺寸，不把320px当成品', async reason => {
    const f = fixture(); if (reason === 'failure') f.previewArtifact.mockRejectedValueOnce(Error('over preview limit'));
    await render(f.props); expect(mainImage()?.src).toBe(png); expect(container.textContent).toContain('缩略预览，原尺寸文件仍可另存'); expect(f.previewArtifact).toHaveBeenCalledTimes(1); expect(f.thumbnailArtifact).toHaveBeenCalledExactlyOnceWith(large.id);
    expect(f.onMetadataReady).toHaveBeenCalledExactlyOnceWith(large.id, { width: 2048, height: 2732, transparency: 'unknown' });
    await imageLoad(); expect(f.onImageReady).not.toHaveBeenCalled();
    const zoom = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '放大缩略图')!; await act(async () => zoom.click()); expect(document.querySelector('[role=dialog][aria-label="查看缩略图"]')).not.toBeNull(); expect(document.querySelector('[role=dialog][aria-label="查看原图"]')).toBeNull();
    const save = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '另存图片')!; await act(async () => save.click()); expect(f.onSave).toHaveBeenCalledExactlyOnceWith(large);
  });
  it('普通可用PNG保持全图路径与原onImageReady，不额外读取缩略', async () => {
    const f = fixture({ ...large, bytes: 68 }); f.previewArtifact.mockResolvedValue({ mimeType: 'image/png', dataUrl: png }); await render(f.props); await imageLoad();
    expect(f.thumbnailArtifact).not.toHaveBeenCalled(); expect(f.onMetadataReady).not.toHaveBeenCalled(); expect(f.onImageReady).toHaveBeenCalledWith(large.id, mainImage()); expect(container.textContent).not.toContain('缩略预览');
  });
  it.each(['image/gif', 'image/svg+xml'])('%s读取失败不会拿静态PNG伪装原格式', async mimeType => {
    const f = fixture({ ...large, mimeType }); f.previewArtifact.mockRejectedValueOnce(Error('unavailable')); await render(f.props);
    expect(mainImage()).toBeNull(); expect(f.thumbnailArtifact).not.toHaveBeenCalled(); expect(container.textContent).toContain('这张图片暂不能内置预览'); expect(f.onMetadataReady).not.toHaveBeenCalled();
  });
  it('原图和缩略均失效仍明确提示，保留另存入口', async () => {
    const f = fixture(); f.previewArtifact.mockRejectedValueOnce(Error('missing source')); f.thumbnailArtifact.mockRejectedValueOnce(Error('source hash mismatch')); await render(f.props);
    expect(mainImage()).toBeNull(); expect(container.textContent).toContain('这张图片暂不能内置预览'); expect(container.textContent).toContain('尝试另存'); expect(f.onMetadataReady).not.toHaveBeenCalled(); expect(f.onImageReady).not.toHaveBeenCalled();
  });
  it('切换图片后迟到的旧缩略与原尺寸不会污染当前图片', async () => {
    const f = fixture(); let finish!: (value: ArtifactPreview) => void; f.thumbnailArtifact.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await render(f.props);
    const current = { ...large, id: 'current', name: '当前图片.png', bytes: 68 }; f.previewArtifact.mockResolvedValue({ mimeType: 'image/png', dataUrl: png }); f.props.images = [large, current]; f.props.selectedId = current.id; await render(f.props);
    await act(async () => finish(thumbnail)); expect(container.textContent).toContain(current.name); expect(container.textContent).not.toContain('缩略预览'); expect(f.onMetadataReady).not.toHaveBeenCalled(); expect(mainImage()?.alt).toBe(current.name);
  });
  it('没有可信原尺寸时不回报缩略像素作为已验证尺寸', async () => {
    const f = fixture(); f.thumbnailArtifact.mockResolvedValue({ ...thumbnail, originalWidth: undefined, originalHeight: undefined }); await render(f.props); await imageLoad();
    expect(mainImage()).not.toBeNull(); expect(container.textContent).toContain('缩略预览'); expect(f.onMetadataReady).not.toHaveBeenCalled(); expect(f.onImageReady).not.toHaveBeenCalled();
  });
});
