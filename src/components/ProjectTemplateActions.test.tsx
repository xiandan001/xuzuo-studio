// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageProps, Project } from '../types';
import type { ProjectTemplatesBridge } from '../project-template-types';
import type { ArtifactMetadata } from '../live-types';
import { imageDraftKey } from '../lib/image-studio';
import { ProjectTemplateDialog } from './ProjectTemplateActions';
let root: Root | undefined, host: HTMLDivElement;
beforeEach(() => { localStorage.clear(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }); vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0)); vi.stubGlobal('cancelAnimationFrame', clearTimeout); vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 10, y: 10, left: 10, top: 10, right: 410, bottom: 60, width: 400, height: 50, toJSON() {} }); host = document.createElement('div'); document.body.append(host); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.replaceChildren(); delete window.desktop; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const project = { id: 'source', workspaceId: 'workspace', name: '已有作品', kind: 'image', description: '', status: 'draft', version: 0, costCents: 0, updatedAt: '', accent: 'blue' } as Project;
const file = { id: 'poster-png', projectId: project.id, name: '原图.png', kind: 'image' as const, mimeType: 'image/png', bytes: 68, path: 'managed', createdAt: '' };
function button(label: string) { const result = [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label || node.getAttribute('aria-label') === label); if (!result) throw Error('Missing button ' + label); return result; }
async function click(label: string) { await act(async () => button(label).click()); }
async function setup(kind: 'commerce' | 'animation', mode: 'save' | 'copy' = 'save', listProjectArtifacts: (projectId: string) => Promise<ArtifactMetadata[]> = async () => [file]) {
  const saved = vi.fn(async () => ({ id: 'template' })), instantiated = vi.fn(async () => ({ projectId: 'target', artifacts: [{ ...file, id: 'copied', projectId: 'target' }], creative: kind === 'commerce' ? { kind: 'commerce', sourceArtifactId: 'copied', documentId: 'new-doc' } : { kind: 'animation', mode: 'gif' } }));
  const bridge = { save: saved, instantiate: instantiated, sources: vi.fn(async () => [{ kind, label: kind === 'commerce' ? '可编辑海报图层' : 'GIF 动画工程', sourceArtifactId: file.id, documentId: 'saved-doc', animationMode: 'gif', revision: 1, width: 400, height: 400 }]), list: vi.fn(async () => []), remove: vi.fn() } as unknown as ProjectTemplatesBridge;
  Object.defineProperty(window, 'desktop', { configurable: true, value: { projectTemplates: bridge } });
  const props = { workspaceId: 'workspace', configuration: { workflows: [], saveWorkflow: vi.fn(() => true) }, workflowRunner: { listProjectArtifacts: vi.fn(listProjectArtifacts) }, onCreateProject: vi.fn(), onUpdateProject: vi.fn(), notify: vi.fn(), navigate: vi.fn() } as unknown as PageProps, onClose = vi.fn();
  root = createRoot(host); await act(async () => root!.render(<ProjectTemplateDialog props={props} mode={mode} project={project} onClose={onClose} />)); await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  return { bridge, saved, instantiated, props, onClose };
}
describe('可编辑模板的明确来源与素材选择', () => {
  it('只在检测到真实工程后默认选可编辑海报，客户文字和原图保持默认不带入', async () => {
    const ui = await setup('commerce'); expect(button('可编辑模板来源').textContent).toContain('可编辑海报'); const choices = [...document.querySelectorAll<HTMLInputElement>('.template-options input[type="checkbox"]')]; expect(choices.every(input => !input.checked)).toBe(true);
    await click('保存模板'); expect(ui.saved).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'workspace', sourceProjectId: 'source', sourceArtifactId: file.id, creativeSource: { kind: 'commerce', documentId: 'saved-doc' }, retain: { content: false, assets: false, workflow: false, formulas: false } })); expect(ui.props.onCreateProject).not.toHaveBeenCalled();
  });
  it('保留配图/客户文字只有用户明确勾选后才传入；不要求额外付费确认', async () => {
    const ui = await setup('commerce'); const choices = [...document.querySelectorAll<HTMLInputElement>('.template-options input[type="checkbox"]')]; await act(async () => { choices[0].click(); choices[1].click(); }); await click('保存模板'); expect(ui.saved).toHaveBeenCalledWith(expect.objectContaining({ retain: expect.objectContaining({ content: true, assets: true }) })); expect(ui.onClose).toHaveBeenCalledOnce();
  });
  it('从动画工程新建后直接进入现有GIF工作台，新草稿不带旧模型或Key', async () => {
    const ui = await setup('animation', 'copy'); await click('创建并继续'); const call = vi.mocked(ui.props.onCreateProject).mock.calls[0]; expect(call[0]).toBe('image'); expect(call[1]).toMatchObject({ quick: true, initial: { name: '已有作品副本', description: '从已保存作品或模板创建' } }); await act(async () => { call[1]!.onCreated!({ ...project, id: 'target', name: '新动画' }); });
    expect(ui.instantiated).toHaveBeenCalledWith(expect.objectContaining({ creativeSource: { kind: 'animation' }, targetProjectId: 'target' })); const draft = JSON.parse(localStorage.getItem(imageDraftKey('target'))!); expect(draft.preset).toBe('GIF动画工坊'); expect([draft.generationModelId, draft.editingModelId]).toEqual(['', '']); expect(draft.references).toEqual([]); expect(ui.props.navigate).toHaveBeenCalledWith('images', 'target');
  });
  it('实例化回执未确认只重试已创建的新项目，既不重走命名也不再创建项目', async () => {
    const ui = await setup('animation', 'copy'); ui.instantiated.mockRejectedValueOnce(Error('复制回执尚未确认，原文件保留')); expect(ui.props.onCreateProject).not.toHaveBeenCalled(); expect(ui.instantiated).not.toHaveBeenCalled();
    await click('创建并继续'); const options = vi.mocked(ui.props.onCreateProject).mock.calls[0][1]!; await act(async () => options.onCreated!({ ...project, id: 'target', name: '已创建的新项目' }));
    expect(document.body.textContent).toContain('回执尚未确认'); expect(ui.props.navigate).not.toHaveBeenCalled(); expect(ui.props.onCreateProject).toHaveBeenCalledOnce();
    await click('重试保存到新项目'); expect(ui.props.onCreateProject).toHaveBeenCalledOnce(); expect(ui.instantiated).toHaveBeenCalledTimes(2); expect(ui.instantiated).toHaveBeenNthCalledWith(1, expect.objectContaining({ targetProjectId: 'target' })); expect(ui.instantiated).toHaveBeenNthCalledWith(2, expect.objectContaining({ targetProjectId: 'target' })); expect(ui.props.navigate).toHaveBeenCalledWith('images', 'target');
  });
  it('同一弹窗换来源后旧项目的文件晚回包不会串入新项目列表', async () => {
    let release!: (files: ArtifactMetadata[]) => void; const old = new Promise<ArtifactMetadata[]>(resolve => { release = resolve; }), other = { ...project, id: 'other-project', name: '新来源' }, owned = { ...file, id: 'other-image', projectId: other.id, name: '仅新项目可见.png' };
    const ui = await setup('commerce', 'save', id => id === project.id ? old : Promise.resolve([owned])); await act(async () => root!.render(<ProjectTemplateDialog props={ui.props} mode="save" project={other} onClose={ui.onClose} />)); await act(async () => release([file]));
    expect(button('复制或模板的内容来源').textContent).toContain('仅新项目可见'); expect(button('复制或模板的内容来源').textContent).not.toContain('原图.png'); expect(ui.saved).not.toHaveBeenCalled();
  });
});
