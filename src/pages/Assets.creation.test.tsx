// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PageProps, Project } from '../types';
import type { StudioAsset } from '../asset-types';
import { BUILTIN_ASSETS } from '../lib/builtin-assets';
import { Assets } from './Assets';

let root: Root | undefined, host: HTMLDivElement;
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';
const owned: StudioAsset = { id: 'owned-source', workspaceId: 'workspace', name: '保留的原始素材.png', kind: 'image', mimeType: 'image/png', bytes: 68, createdAt: '2026-11-18T00:00:00Z', favorite: true };
const project = (id: string, kind: Project['kind'] = 'image', workspaceId = 'workspace') => ({ id, workspaceId, name: `作品-${id}`, kind, description: '', status: 'draft', costCents: 0, version: 0, accent: 'blue', updatedAt: '' } as Project);
beforeEach(() => { localStorage.clear(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', vi.fn(() => { throw Error('No model or network calls in material creation continuation'); })); vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }); vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0)); vi.stubGlobal('cancelAnimationFrame', clearTimeout); host = document.createElement('div'); document.body.append(host); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.replaceChildren(); delete window.desktop; expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function click(label: string) { const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label || node.getAttribute('aria-label') === label); expect(button, label).toBeTruthy(); await act(async () => button!.click()); }
async function fill(label: string, value: string) { const input = document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function fixture(bound = true) {
  const copied = (projectId: string) => ({ id: 'copied-file', projectId, name: owned.name, kind: 'image', mimeType: 'image/png', bytes: 68, path: 'managed', createdAt: '' });
  const bridge = { list: vi.fn(async () => [structuredClone(owned)]), preview: vi.fn(async () => ({ mimeType: 'image/png', dataUrl: image })), thumbnail: vi.fn(async () => ({ mimeType: 'image/png', dataUrl: image })), importBuiltin: vi.fn(), attach: vi.fn(async ({ projectId }: { projectId: string }) => copied(projectId)), attachBuiltin: vi.fn(async ({ projectId }: { projectId: string }) => copied(projectId)), saveBuiltin: vi.fn() };
  Object.defineProperty(window, 'desktop', { configurable: true, value: { assets: bridge } });
  const create = vi.fn<PageProps['onCreateProject']>(), useAsset = vi.fn(async () => true), onGenerate = vi.fn(), bind = vi.fn();
  const base = { workspaceId: 'workspace', workspace: { id: 'workspace', name: '本地工作区', ...(bound ? { directory: 'C:/fixture' } : {}) }, projects: [], activeProject: { id: '' }, configuration: { useTemplates: [] }, onCreateProject: create, onUseAsset: useAsset, onGenerate, onBindWorkspace: bind, onUpdateProject: vi.fn(), notify: vi.fn(), navigate: vi.fn() } as unknown as PageProps;
  const render = async (changes: Partial<PageProps> = {}) => { await act(async () => { root ||= createRoot(host); root.render(<Assets {...base} {...changes} />); }); };
  await render(); return { bridge, create, useAsset, onGenerate, bind, base, render };
}
async function openBuiltin() { const asset = BUILTIN_ASSETS.find(item => item.origin === 'open-source')!; await fill('搜索内置素材', asset.name); await click(`查看素材 ${asset.name}`); return asset; }
it('自有素材创建或取消都保留当前素材；新目标回显后仍需明确使用才复制和插入', async () => {
  const f = await fixture(); await click('我的素材'); await vi.waitFor(() => expect(document.querySelector(`[aria-label="预览素材 ${owned.name}"]`)).toBeTruthy()); await click(`预览素材 ${owned.name}`);
  await click('新建作品'); const first = f.create.mock.calls[0]; expect(first[0]).toBeUndefined(); expect(f.bridge.attach).not.toHaveBeenCalled(); await act(async () => first[1]!.onCancelled!());
  expect(document.querySelector('.asset-library-preview h2')?.textContent).toBe(owned.name); await click('新建作品'); const created = project('new'); await act(async () => f.create.mock.calls[1][1]!.onCreated!(created));
  expect(f.bridge.attach).not.toHaveBeenCalled(); await f.render({ projects: [created] }); expect(document.querySelector('[aria-label="素材目标项目"]')?.textContent).toContain(created.name); expect(document.querySelector('.asset-library-preview h2')?.textContent).toBe(owned.name);
  await click('作为精修参考'); expect(f.bridge.attach).toHaveBeenCalledWith({ workspaceId: 'workspace', id: owned.id, projectId: created.id }); expect(f.useAsset).toHaveBeenCalledWith(created.id, expect.objectContaining({ id: 'copied-file' })); expect(f.onGenerate).not.toHaveBeenCalled(); expect(owned.favorite).toBe(true);
});
it('内置素材新建后选中新目标并保留原许可，未确认前不复制，不误用先到的其他项目', async () => {
  const f = await fixture(), asset = await openBuiltin(), license = document.querySelector('.asset-license-info')?.textContent;
  await click('新建作品'); const created = project('new-word', 'word'); await act(async () => f.create.mock.calls[0][1]!.onCreated!(created)); await f.render({ projects: [project('other'), created] });
  expect(document.querySelector('.builtin-asset-dialog h2')?.textContent).toBe(asset.name); expect(document.querySelector('[aria-label="内置素材目标项目"]')?.textContent).toContain(created.name); expect(document.querySelector('.asset-license-info')?.textContent).toBe(license); expect(f.bridge.attachBuiltin).not.toHaveBeenCalled();
  await click('插入 Word 文档'); expect(f.bridge.attachBuiltin).toHaveBeenCalledWith({ workspaceId: 'workspace', id: asset.id, projectId: created.id }); expect(f.useAsset).toHaveBeenCalledWith(created.id, expect.objectContaining({ id: 'copied-file' })); expect(f.onGenerate).not.toHaveBeenCalled();
});
it('首次自动建立工作区目录也可回到原素材详情，目录props变化不会清掉新目标或素材', async () => {
  const f = await fixture(false), asset = await openBuiltin(); await click('新建作品'); const created = project('first'); await act(async () => f.create.mock.calls[0][1]!.onCreated!(created));
  await f.render({ workspace: { ...f.base.workspace, directory: 'C:/created-workspace' }, projects: [created] });
  expect(document.querySelector('.builtin-asset-dialog h2')?.textContent).toBe(asset.name); expect(document.querySelector('[aria-label="内置素材目标项目"]')?.textContent).toContain(created.name); expect(f.bind).not.toHaveBeenCalled(); expect(f.bridge.attachBuiltin).not.toHaveBeenCalled(); expect(f.onGenerate).not.toHaveBeenCalled();
});
it('切换工作区后旧创建回调不会重新打开旧素材或复制到新工作区', async () => {
  const f = await fixture(); await openBuiltin(); await click('新建作品'); const options = f.create.mock.calls[0][1]!;
  await f.render({ workspaceId: 'other', workspace: { id: 'other', name: '另一区', description: '', createdAt: '2026-11-01', directory: 'C:/other' }, projects: [] }); await act(async () => options.onCreated!(project('late')));
  expect(document.querySelector('.builtin-asset-dialog')).toBeNull(); expect(f.bridge.attachBuiltin).not.toHaveBeenCalled(); expect(f.useAsset).not.toHaveBeenCalled();
});
