// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageStudio } from './ImageStudio';
import type { PageProps, Project } from '../types';
import type { ArtifactMetadata } from '../live-types';
import type { WorkflowRun } from '../configuration-types';
import type { WallpaperTarget } from '../wallpaper-types';
import { imageDraftKey } from '../lib/image-studio';
import { studioPreferenceKey } from '../lib/studio-layout-state';
import { writeDisclosure } from '../lib/disclosure-state';

const project: Project = { id: 'wallpaper-project', workspaceId: 'wallpaper-workspace', name: '壁纸本地验收', kind: 'image', status: 'draft', description: '', updatedAt: '2026-11-07T00:00:00Z', version: 0, costCents: 23, accent: 'blue' };
const target: WallpaperTarget = { width: 1170, height: 2532, fit: 'cover' };
let root: Root | undefined, container: HTMLDivElement, previousStorage: [string, string][], desktop: PropertyDescriptor | undefined;
beforeEach(() => {
  previousStorage = Array.from({ length: localStorage.length }, (_, i) => { const key = localStorage.key(i)!; return [key, localStorage.getItem(key)!]; }); localStorage.clear();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('No provider calls in wallpaper DOM acceptance'); }));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 100, y: 100, left: 100, top: 100, right: 400, bottom: 144, width: 300, height: 44, toJSON: () => ({}) });
  desktop = Object.getOwnPropertyDescriptor(window, 'desktop'); Object.defineProperty(window, 'desktop', { configurable: true, value: undefined });
  container = document.createElement('div'); document.body.append(container);
  saveDraft(); preparePanel(project);
});
afterEach(async () => {
  try { if (root) await act(async () => root!.unmount()); expect(fetch).not.toHaveBeenCalled(); }
  finally { root = undefined; container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); for (const [key, value] of previousStorage) localStorage.setItem(key, value); if (desktop) Object.defineProperty(window, 'desktop', desktop); else delete window.desktop; }
});
function preparePanel(item: Project) { for (const [name, value] of [['initialized', true], ['panel-open', true], ['focus', false], ['tool', 'ai']] as const) writeDisclosure(studioPreferenceKey('images', { workspaceId: item.workspaceId, projectId: item.id }, name), value); }
function saveDraft(changes = {}, item = project) { localStorage.setItem(imageDraftKey(item.id), JSON.stringify({ preset: '宣传图', mode: 'create', prompt: '安静的月夜与山峰，不要文字', refinePrompt: '保留主体，把背景改成夜空', quantity: 1, references: [], ...changes })); }
function artifact(id = 'source'): ArtifactMetadata { return { id, projectId: project.id, runId: 'source-run', kind: 'image', mimeType: 'image/png', name: `${id}.png`, bytes: 68, path: `managed/${id}`, createdAt: project.updatedAt }; }
function resultRun(file = artifact(), wallpaper?: WallpaperTarget): WorkflowRun {
  return { id: 'source-run', workspaceId: project.workspaceId, projectId: project.id, workflowId: 'image', workflowName: '本地图片记录', mode: 'live', status: 'complete', stepIndex: 1, variables: {}, input: '', createdAt: project.updatedAt, updatedAt: project.updatedAt, snapshot: { id: 'image', workspaceId: project.workspaceId, name: '本地图片记录', description: '', outputKind: 'image', updatedAt: project.updatedAt, steps: [{ id: 'image', name: wallpaper ? '本地壁纸导出' : '制作图片', kind: wallpaper ? 'export' : 'image-generation', inputSource: 'project', prompt: '', enabled: true, ...(wallpaper ? { wallpaperTarget: wallpaper } : {}) }] }, attempts: [{ id: 'existing-result', stepId: 'image', stepName: '制作图片', action: '初次生成', status: 'complete', modelLabel: '本地示例', costCents: 23, summary: '', input: '', prompt: '', artifacts: [file] }] };
}
function fixture(runs: WorkflowRun[] = []) {
  const onGenerate = vi.fn(), ledger = Object.freeze([Object.freeze({ id: 'existing-fee', projectId: project.id, projectName: project.name, time: project.updatedAt, action: '初次生成', model: '本地示例', status: 'complete', billingMode: 'live', costState: 'calculated', costCents: 23 })]);
  const runner = { runs, runtimeStatus: { available: true }, trashedArtifacts: [], previewArtifact: vi.fn(async () => ({ mimeType: 'image/png', supported: true })), inspectImageArtifact: vi.fn(async () => ({ mimeType: 'image/png', bytes: 68 })), importFiles: vi.fn(async () => []), saveArtifact: vi.fn(async () => ({ saved: true })) };
  const props = { activeProject: project, projects: [project], workspaceId: project.workspaceId, workspace: { id: project.workspaceId, name: '隔离工作区' }, preferences: {}, prompts: [], ledger, workflowRunner: runner, onGenerate, onPromptApplied: vi.fn(), onUpdateProject: vi.fn(), notify: vi.fn(), configuration: { categories: [], workflows: [], studioActions: [], credentials: [{ id: 'account-metadata', name: '仅账户元数据', connectionId: 'connection', enabled: true }], connections: [{ id: 'connection', name: '隔离服务', providerId: 'openai', enabled: true }], models: [{ id: 'image-model', name: '图像模型', modelId: 'gpt-image-2.6-sunburst', connectionId: 'connection', capabilities: ['image-generation', 'image-editing'], enabled: true }] } } as unknown as PageProps;
  return { props, onGenerate, ledger, runner };
}
async function render(props: PageProps) { await act(async () => { root ||= createRoot(container); root.render(<ImageStudio {...props} />); }); }
function button(label: string) { const found = [...container.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label); expect(found, `Missing ${label}`).toBeDefined(); return found!; }
async function click(label: string) { await act(async () => button(label).click()); }
const picker = () => container.querySelector<HTMLInputElement>('[aria-label="壁纸设备或分辨率"]')!;
async function type(value: string) { await act(async () => { picker().focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(picker(), value); picker().dispatchEvent(new Event('input', { bubbles: true })); }); }
async function key(value: string) { await act(async () => { picker().dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })); }); }
const generate = () => container.querySelector<HTMLButtonElement>('.ig-primary-action > button')!;

describe('壁纸图片工作台实际操作与提交', () => {
  it('直接选择壁纸和像素后一次提交，使用规范PNG/不透明并保留物理目标', async () => {
    const f = fixture(), before = JSON.stringify(f.ledger); await render(f.props); await click('壁纸');
    expect(picker()).not.toBeNull(); expect(generate().disabled).toBe(true); await type('1170x2532'); await key('Enter');
    expect(generate().textContent).toBe('生成壁纸 · 1 张'); expect(generate().disabled).toBe(false);
    await act(async () => generate().click()); expect(f.onGenerate).toHaveBeenCalledTimes(1);
    const submitted = f.onGenerate.mock.calls[0][4]; expect(submitted).toMatchObject({ wallpaperTarget: target, imageOutputFormat: 'png', imageBackground: 'opaque', modelConfigId: 'image-model', credentialId: 'account-metadata', capability: 'image-generation' });
    expect(submitted.prompt).toContain('安静的月夜与山峰'); expect(submitted.prompt).toContain('1170'); expect(submitted.imageSize).not.toBe('1170x2532'); expect(JSON.stringify(f.ledger)).toBe(before);
  });
  it('编辑搜索后不沿旧尺寸生成；Enter/Tab应用、Esc取消均不额外调用', async () => {
    saveDraft({ wallpaperEnabled: true, wallpaperTarget: target }); const f = fixture(); await render(f.props); expect(generate().disabled).toBe(false);
    await type('1080x2400'); expect(generate().disabled).toBe(true); await act(async () => generate().click()); expect(f.onGenerate).not.toHaveBeenCalled();
    await key('Tab'); expect(generate().disabled).toBe(false); await type('未知的未来机型'); await key('Enter'); expect(generate().disabled).toBe(true); expect(f.onGenerate).not.toHaveBeenCalled();
    await key('Escape'); expect(generate().disabled).toBe(false); expect(container.textContent).toContain('1080 × 2400');
  });
  it('描述中的尺寸只提供一键建议，不覆盖已选目标或输入要求', async () => {
    saveDraft({ wallpaperEnabled: true, wallpaperTarget: target, prompt: '请制作1080x2400的山峰壁纸' }); const f = fixture(); await render(f.props);
    expect(container.textContent).toContain('最终尺寸 1170 × 2532'); expect(button('应用尺寸')).toBeDefined(); expect(f.onGenerate).not.toHaveBeenCalled();
    await click('应用尺寸'); expect(container.textContent).toContain('最终尺寸 1080 × 2400'); expect(container.querySelector<HTMLTextAreaElement>('.ig-prompt')!.value).toBe('请制作1080x2400的山峰壁纸'); expect(f.onGenerate).not.toHaveBeenCalled();
  });
  it('待应用的尺寸不会从分组批量入口绕过校验并沿用旧目标', async () => {
    saveDraft({ wallpaperEnabled: true, wallpaperTarget: target }); const f = fixture(); await render(f.props); await type('1080x2400'); await click('分组批量生成');
    expect(document.querySelector('[aria-label="分组共用生成设置"]')).toBeNull(); expect(f.onGenerate).not.toHaveBeenCalled(); expect(generate().disabled).toBe(true);
  });
  it('目标随重开恢复，切项目不继承旧设备，撤销重做不影响费用', async () => {
    const f = fixture(), before = JSON.stringify(f.ledger); await render(f.props); await click('壁纸'); await type('1170x2532'); await key('Enter');
    const undo = container.querySelector<HTMLButtonElement>('[aria-label="撤销编辑"]')!; await act(async () => undo.click()); expect(generate().disabled).toBe(true);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="重做编辑"]')!.click()); expect(generate().disabled).toBe(false);
    await act(async () => root!.unmount()); root = undefined; await render(f.props); expect(container.textContent).toContain('最终尺寸 1170 × 2532');
    const other = { ...project, id: 'another-wallpaper', name: '另一个项目' }; preparePanel(other); f.props = { ...f.props, activeProject: other, projects: [project, other] }; await render(f.props); await click('壁纸'); expect(picker().value).toBe(''); expect(generate().disabled).toBe(true); expect(JSON.stringify(f.ledger)).toBe(before); expect(f.onGenerate).not.toHaveBeenCalled();
  });
  it('精修保留目标与真实原图ID，原有GIF格式不混入静态壁纸', async () => {
    saveDraft({ imageOptions: { imageOutputFormat: 'gif', imageFrameCount: 6 }, wallpaperTarget: target }); const f = fixture([resultRun()]); await render(f.props); await click('壁纸'); await click('精修图片');
    expect(generate().textContent).toBe('精修壁纸 · 1 张'); await act(async () => generate().click());
    expect(f.onGenerate.mock.calls[0][4]).toMatchObject({ wallpaperTarget: target, attachmentIds: ['source'], imageOutputFormat: 'png', imageBackground: 'opaque', capability: 'image-editing' }); expect(f.onGenerate.mock.calls[0][4].imageFrameCount).toBeUndefined();
    await click('图片'); expect(picker()).toBeNull(); await act(async () => generate().click()); expect(f.onGenerate.mock.calls.at(-1)?.[4].wallpaperTarget).toBeUndefined();
  });
  it('缺少主题时不靠内置壁纸要求绕过输入检查，尺寸错误可直接定位', async () => {
    saveDraft({ wallpaperEnabled: true, wallpaperTarget: target, prompt: '' }); const f = fixture(); await render(f.props); expect(generate().disabled).toBe(true); expect(f.onGenerate).not.toHaveBeenCalled();
    await act(async () => root!.unmount()); root = undefined; saveDraft({ wallpaperEnabled: true }); await render(f.props); await click('选择壁纸尺寸'); await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); }); expect(document.activeElement).toBe(picker()); expect(f.onGenerate).not.toHaveBeenCalled();
  });
  it('查看旧壁纸显示保存时目标，不把当前表单尺寸标到旧图上', async () => {
    saveDraft({ wallpaperEnabled: true, wallpaperTarget: { width: 1080, height: 2400, fit: 'contain' } }); const f = fixture([resultRun(artifact('old-wallpaper'), target)]); await render(f.props);
    expect(container.textContent).toContain('最终尺寸 1080 × 2400'); expect(container.querySelector('.sw-scope-label')?.textContent).toContain('所选壁纸目标：1170 × 2532'); expect(f.onGenerate).not.toHaveBeenCalled();
  });
});
