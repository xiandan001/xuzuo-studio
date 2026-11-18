// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageProps, Project } from '../types';
import { imageDraftKey } from '../lib/image-studio';
import { ImageStudio } from './ImageStudio';
vi.mock('../components/CommerceEditorDialog', () => ({ CommerceEditorDialog: ({ artifactId, documentId, onClose }: { artifactId: string; documentId?: string; onClose: () => void }) => <div role="dialog" aria-label="图层模板目标" data-source={artifactId} data-document={documentId}><button onClick={onClose}>关闭模板目标</button></div> }));
let root: Root | undefined, host: HTMLDivElement;
const project = { id: 'template-target', workspaceId: 'workspace', name: '新海报', kind: 'image', description: '', status: 'draft', version: 0, costCents: 50, updatedAt: '', accent: 'blue', localOutputArtifactIds: ['template-source'] } as Project;
const file = { id: 'template-source', projectId: project.id, name: '新模板原图.png', kind: 'image' as const, mimeType: 'image/png', bytes: 100, path: 'managed', createdAt: '' };
beforeEach(() => { localStorage.clear(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', vi.fn(() => { throw Error('No network in template routing tests'); })); vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} }); vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0)); vi.stubGlobal('cancelAnimationFrame', clearTimeout); Object.defineProperty(window, 'desktop', { configurable: true, value: { commerceImages: { read: vi.fn() } } }); host = document.createElement('div'); document.body.append(host); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host.remove(); document.body.replaceChildren(); delete window.desktop; expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function props(list = vi.fn(async () => [file])) {
  const onGenerate = vi.fn(), ledger = Object.freeze([{ id: 'old-fee', projectId: project.id, billingMode: 'live', costState: 'calculated', costCents: 50, status: 'complete' }]);
  return { activeProject: project, projects: [project], workspaceId: project.workspaceId, workspace: { id: project.workspaceId, name: '工作区' }, ledger, preferences: { confirmGeneration: true }, prompts: [], notify: vi.fn(), onUpdateProject: vi.fn(), onGenerate, onPromptApplied: vi.fn(), configuration: { models: [], connections: [], credentials: [], workflows: [], categories: [], studioActions: [], useTemplates: [] }, workflowRunner: { runs: [], trashedArtifacts: [], runtimeStatus: { available: true }, listProjectArtifacts: list, previewArtifact: vi.fn(async () => ({ mimeType: 'image/png', dataUrl: 'data:image/png;base64,AA==' })) } } as unknown as PageProps;
}
function draft(id = project.id) { localStorage.setItem(imageDraftKey(id), JSON.stringify({ prompt: '保留用户现有草稿', quantity: 2, templateLayerSourceId: file.id, templateLayerDocumentId: 'new-layout' })); }
async function render(value: PageProps, strict = false) { root ||= createRoot(host); await act(async () => root!.render(strict ? <StrictMode><ImageStudio {...value} /></StrictMode> : <ImageStudio {...value} />)); }
describe('新建可编辑海报的一次导航意图', () => {
  it('直接打开正确工程，仅清除一次意图；关闭/重进不再弹窗，旧草稿和费用保持', async () => {
    draft(); const value = props(); await render(value, true); expect(host.querySelector('[aria-label="图层模板目标"]')?.getAttribute('data-source')).toBe(file.id); expect(host.querySelector('[aria-label="图层模板目标"]')?.getAttribute('data-document')).toBe('new-layout');
    const saved = JSON.parse(localStorage.getItem(imageDraftKey(project.id))!); expect(saved.prompt).toBe('保留用户现有草稿'); expect(saved.quantity).toBe(2); expect(saved.templateLayerSourceId).toBeUndefined(); expect(saved.templateLayerDocumentId).toBeUndefined();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="图层模板目标"] button')!.click()); expect(host.querySelector('[aria-label="图层模板目标"]')).toBeNull(); await act(async () => root!.unmount()); root = undefined; await render(value); expect(host.querySelector('[aria-label="图层模板目标"]')).toBeNull(); expect(value.onGenerate).not.toHaveBeenCalled(); expect(value.ledger[0].costCents).toBe(50); expect(host.textContent).toContain('继续本地图片排版');
  });
  it('无法验证本项目的源图时不打开其他工程，也不覆盖当前草稿', async () => {
    draft(); const value = props(vi.fn(async () => [{ ...file, projectId: 'foreign' }])); await render(value); expect(host.querySelector('[aria-label="图层模板目标"]')).toBeNull(); expect(JSON.parse(localStorage.getItem(imageDraftKey(project.id))!).prompt).toBe('保留用户现有草稿'); expect(host.textContent).toContain('模板原图暂不可用'); expect(value.onGenerate).not.toHaveBeenCalled();
  });
  it('切到其他项目后忽略旧项目迟到的目标回复', async () => {
    let release!: (files: typeof file[]) => void; const delayed = vi.fn(() => new Promise<typeof file[]>(resolve => { release = resolve; })); draft(); const value = props(delayed); await render(value);
    const other = { ...project, id: 'other-project', localOutputArtifactIds: [] }; await render({ ...value, activeProject: other, projects: [project, other] }); await act(async () => release([file])); expect(host.querySelector('[aria-label="图层模板目标"]')).toBeNull(); expect(value.onGenerate).not.toHaveBeenCalled();
  });
});
