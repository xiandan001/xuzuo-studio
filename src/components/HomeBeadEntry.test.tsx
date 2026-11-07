// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageProps, Project } from '../types';
import { HomeBeadEntry } from './HomeBeadEntry';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type ProjectStartOptions = NonNullable<Parameters<PageProps['onCreateProject']>[1]>;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); document.body.replaceChildren(); });
const project = (id: string, workspaceId = 'workspace', kind: Project['kind'] = 'image') => ({ id, workspaceId, kind } as Project);
async function mount(projects: Project[], projectId?: string) {
  const onUsePrompt = vi.fn(), onCreateProject = vi.fn(), host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host); roots.push(root);
  await act(async () => root.render(<HomeBeadEntry props={{ workspaceId: 'workspace', projects, onUsePrompt, onCreateProject } as unknown as PageProps} projectId={projectId} request="做64×64拼豆图纸，要色号采购" />));
  return { host, onUsePrompt, onCreateProject, open: () => act(async () => host.querySelector('button')!.click()) };
}
describe('首页拼豆入口不会付费制作假网格', () => {
  it('当前图片项目直接进入拼豆用途，不选择模型、不创建另一个项目', async () => {
    const ui = await mount([project('image')], 'image'); await ui.open();
    expect(ui.onUsePrompt).toHaveBeenCalledWith(expect.objectContaining({ builtin: true, imagePreset: '拼豆', category: 'image' }), '做64×64拼豆图纸，要色号采购', 'image'); expect(ui.onCreateProject).not.toHaveBeenCalled();
  });
  it('没有图片项目时只请求一次保存位置，回调绑定新项目而不是原文档', async () => {
    const ui = await mount([project('word', 'workspace', 'word')], 'word'); await ui.open(); await ui.open();
    expect(ui.onCreateProject).toHaveBeenCalledTimes(1); expect(ui.onUsePrompt).not.toHaveBeenCalled();
    const options = ui.onCreateProject.mock.calls[0][1] as ProjectStartOptions;
    await act(async () => options.onCreated!(project('new-image')));
    expect(ui.onUsePrompt).toHaveBeenCalledWith(expect.objectContaining({ imagePreset: '拼豆' }), expect.any(String), 'new-image');
  });
  it('取消保存位置保留需求，可重试，跨工作区迟到回调不切走当前页面', async () => {
    const ui = await mount([]); await ui.open(); const first = ui.onCreateProject.mock.calls[0][1] as ProjectStartOptions;
    await act(async () => first.onCancelled!()); expect(ui.host.textContent).toContain('需求仍保留');
    await ui.open(); const second = ui.onCreateProject.mock.calls[1][1] as ProjectStartOptions;
    await act(async () => second.onCreated!(project('foreign', 'other'))); expect(ui.onUsePrompt).not.toHaveBeenCalled();
  });
});
