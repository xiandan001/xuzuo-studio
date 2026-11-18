// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DocumentArtifactPreview } from './DocumentArtifactPreview';
import type { EditorDocument } from '../editor-types';
import type { ArtifactMetadata } from '../live-types';
import type { DocumentPreviewImageContext } from '../document-preview-types';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lVQAAAAASUVORK5CYII=';
const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
let host: HTMLDivElement, root: Root;
const image = (id: string, projectId = 'project'): ArtifactMetadata => ({ id, projectId, path: '/managed/' + id + '.png', name: `${id}.png`, mimeType: 'image/png', kind: 'image', bytes: 68, createdAt: '2026-11-17T10:00:00Z' });
function doc(kind: 'word' | 'ppt', imageId = 'picture'): EditorDocument {
  return kind === 'word' ? { schemaVersion: 1, kind, title: '真实图文', blocks: [{ id: 'paragraph', type: 'paragraph', text: '原有正文保持', fontSize: 12, bold: false, italic: false, align: 'left' }, { id: 'picture-block', type: 'image', imageId, text: '实际配图说明', fontSize: 12, bold: false, italic: false, align: 'center' }] } : { schemaVersion: 1, kind, title: '真实图文', theme: 'paper', slides: [{ id: 'slide-one', title: '带图页面', body: '实际页面正文', notes: '', layout: 'image-right', fontSize: 22, align: 'left', imageId }, { id: 'slide-two', title: '第二页仍可查看', body: '完整第二页正文', notes: '讲解内容', layout: 'title-body', fontSize: 22, align: 'left' }] };
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0)); vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  vi.stubGlobal('IntersectionObserver', class { constructor(private callback: IntersectionObserverCallback) {} observe(target: Element) { this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); } disconnect() {} });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function settle() { for (let index = 0; index < 5; index++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); }
async function show(value: EditorDocument, context?: DocumentPreviewImageContext) { await act(async () => root.render(<DocumentArtifactPreview text={JSON.stringify(value)} title="实际文件" hint={value.kind} imageContext={context} />)); await settle(); }
it.each(['word', 'ppt'] as const)('%s预览读取当前项目实际插图并点击定位对应块或页面，正文保持', async kind => {
  const thumbnailArtifact = vi.fn(async () => ({ mimeType: 'image/png', dataUrl: PNG })), onEditUnit = vi.fn();
  await show(doc(kind), { scope: 'workspace/project/file', projectId: 'project', runner: { listProjectArtifacts: async () => [image('picture')], thumbnailArtifact, previewArtifact: thumbnailArtifact }, onEditUnit });
  expect(thumbnailArtifact).toHaveBeenCalledWith('picture'); expect(host.querySelector('img')?.src).toBe(PNG); expect(host.textContent).toContain(kind === 'word' ? '原有正文保持' : '完整第二页正文');
  await act(async () => host.querySelector<HTMLButtonElement>('.dap-image-open')!.click()); expect(onEditUnit).toHaveBeenCalledWith(kind === 'word' ? 'picture-block' : 'slide-one');
});
it('不读取其他项目ID，缺失插图有明确恢复入口', async () => {
  const read = vi.fn(async () => ({ mimeType: 'image/png', dataUrl: PNG }));
  await show(doc('word'), { scope: 'workspace/project/file', projectId: 'project', runner: { listProjectArtifacts: async () => [image('picture', 'other-project')], thumbnailArtifact: read, previewArtifact: read } });
  expect(read).not.toHaveBeenCalled(); expect(host.textContent).toContain('此插图已移除或暂不可用'); expect(host.textContent).toContain('重新读取');
});
it('切换文档后旧插图迟到不会混进新文档', async () => {
  let release!: (value: { mimeType: string; dataUrl: string }) => void; const old = new Promise<{ mimeType: string; dataUrl: string }>(resolve => { release = resolve; });
  const read = vi.fn((id: string) => id === 'old-picture' ? old : Promise.resolve({ mimeType: 'image/png', dataUrl: PNG }));
  await show(doc('word', 'old-picture'), { scope: 'workspace/project/old', projectId: 'project', runner: { listProjectArtifacts: async () => [image('old-picture')], thumbnailArtifact: read, previewArtifact: read } });
  await show(doc('word', 'new-picture'), { scope: 'workspace/new-project/new', projectId: 'new-project', runner: { listProjectArtifacts: async () => [image('new-picture', 'new-project')], thumbnailArtifact: read, previewArtifact: read } });
  await act(async () => release({ mimeType: 'image/gif', dataUrl: GIF })); await settle(); expect(host.querySelector('img')?.src).toBe(PNG); expect([...host.querySelectorAll('img')].some(node => node.src === GIF)).toBe(false);
});
it('没有受管项目上下文时不从正文里的ID擅自读取文件', async () => {
  await show(doc('word')); expect(host.querySelector('img')).toBeNull(); expect(host.textContent).toContain('此预览未关联项目'); expect(host.textContent).toContain('原有正文保持');
});
