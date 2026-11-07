// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageStudio } from './ImageStudio';
import { ENGINEERING_IMAGE_PROMPT } from '../lib/engineering-image';
import { imageDraftKey } from '../lib/image-studio';
import { studioPreferenceKey } from '../lib/studio-layout-state';
import { writeDisclosure } from '../lib/disclosure-state';
import type { PageProps, Project } from '../types';
import type { ArtifactMetadata } from '../live-types';
import type { WorkflowRun } from '../configuration-types';

const project: Project = { id: 'engineering-project', workspaceId: 'engineering-workspace', name: '工程图像本地验收', kind: 'image', status: 'draft', description: '', updatedAt: '2026-11-07T00:00:00Z', version: 0, costCents: 23, accent: 'blue' };
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';
let root: Root | undefined, container: HTMLDivElement, previousStorage: [string, string][], desktop: PropertyDescriptor | undefined;
beforeEach(() => {
  previousStorage = Array.from({ length: localStorage.length }, (_, i) => { const key = localStorage.key(i)!; return [key, localStorage.getItem(key)!]; }); localStorage.clear();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Engineering DOM acceptance must not call providers'); }));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 100, y: 100, left: 100, top: 100, right: 400, bottom: 144, width: 300, height: 44, toJSON: () => ({}) });
  desktop = Object.getOwnPropertyDescriptor(window, 'desktop'); Object.defineProperty(window, 'desktop', { configurable: true, value: undefined });
  container = document.createElement('div'); document.body.append(container);
  for (const [name, value] of [['initialized', true], ['panel-open', true], ['focus', false], ['tool', 'ai']] as const) writeDisclosure(studioPreferenceKey('images', { workspaceId: project.workspaceId, projectId: project.id }, name), value);
  saveDraft();
});
afterEach(async () => {
  try { if (root) await act(async () => root!.unmount()); expect(fetch).not.toHaveBeenCalled(); }
  finally { root = undefined; container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); for (const [key, value] of previousStorage) localStorage.setItem(key, value); if (desktop) Object.defineProperty(window, 'desktop', desktop); else delete window.desktop; }
});
function saveDraft(changes = {}) { localStorage.setItem(imageDraftKey(project.id), JSON.stringify({ preset: '宣传图', mode: 'create', prompt: '仅修改标注 A12 为 A13，其他内容保留', refinePrompt: '仅移除照片左下角杂物，保留构件与背景', quantity: 1, references: [], ...changes })); }
function artifact(id = 'original', name = '工程照片.png', mimeType = 'image/png'): ArtifactMetadata { return { id, projectId: project.id, runId: `run-${id}`, kind: 'image', mimeType, name, bytes: 68, path: `managed/${id}`, createdAt: project.updatedAt }; }
function resultRun(file = artifact()): WorkflowRun { return { id: `run-${file.id}`, workspaceId: project.workspaceId, projectId: project.id, workflowId: 'existing-image', workflowName: '已有图片', mode: 'live', status: 'complete', stepIndex: 1, input: '', variables: {}, createdAt: file.createdAt, updatedAt: file.createdAt, snapshot: { id: 'existing-image', workspaceId: project.workspaceId, name: '已有图片', description: '', outputKind: 'image', updatedAt: file.createdAt, steps: [{ id: 'image', kind: 'image-generation', name: '已有图片', prompt: '', inputSource: 'project', enabled: true }] }, attempts: [{ id: `attempt-${file.id}`, stepId: 'image', stepName: '已有图片', action: '初次生成', status: 'complete', modelLabel: '本地示例', costCents: 23, summary: '', input: '', prompt: '', artifacts: [file] }] }; }
function fixture(runs: WorkflowRun[] = []) {
  const onGenerate = vi.fn(), ledger = Object.freeze([Object.freeze({ id: 'existing-fee', projectId: project.id, projectName: project.name, time: project.updatedAt, action: '初次生成', model: '本地示例', status: 'complete', billingMode: 'live', costState: 'calculated', costCents: 23 })]);
  const runner = { runs, runtimeStatus: { available: true }, trashedArtifacts: [], previewArtifact: vi.fn(async () => ({ mimeType: 'image/png', supported: true, dataUrl: png })), inspectImageArtifact: vi.fn(async (id: string) => ({ id, mimeType: 'image/png', bytes: 68, width: 1724, height: 1280 })), importFiles: vi.fn(async (): Promise<ArtifactMetadata[]> => []), saveArtifact: vi.fn(async () => ({ saved: true })), prepareGeneratedAnimationReference: vi.fn(), prepareSvgReference: vi.fn() };
  const props = { activeProject: project, projects: [project], workspaceId: project.workspaceId, workspace: { id: project.workspaceId, name: '隔离工程工作区' }, preferences: {}, prompts: [], ledger, workflowRunner: runner, onGenerate, onPromptApplied: vi.fn(), onUpdateProject: vi.fn(), notify: vi.fn(), configuration: { categories: [], workflows: [], studioActions: [], credentials: [{ id: 'account-metadata', name: '仅账户元数据', connectionId: 'connection', enabled: true }], connections: [{ id: 'connection', name: '隔离服务', providerId: 'openai', enabled: true }], models: [{ id: 'generation-model', name: '仅生成模型', modelId: 'gpt-image-2.6-sunburst', connectionId: 'connection', capabilities: ['image-generation'], enabled: true }, { id: 'edit-model', name: '工程编辑模型', modelId: 'gpt-image-2.6-sunburst', connectionId: 'connection', capabilities: ['image-editing'], enabled: true }] } } as unknown as PageProps;
  return { props, runner, onGenerate, ledger };
}
async function render(props: PageProps) { await act(async () => { root ||= createRoot(container); root.render(<ImageStudio {...props} />); }); }
function button(label: string) { const found = [...container.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label); expect(found, label).toBeDefined(); return found!; }
async function click(label: string) { await act(async () => button(label).click()); }
async function instruction(value: string) { await act(async () => { const field = container.querySelector<HTMLTextAreaElement>('.ig-prompt')!; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); }); }
const generate = () => container.querySelector<HTMLButtonElement>('.ig-primary-action > button')!;

describe('工程照片、图纸和效果图的实际工作台交互', () => {
  it('无主原图时直接定位导入，工程入口不会使用纯生成或无参考分组', async () => {
    const f = fixture(); await render(f.props); await click('工程P图');
    expect(container.querySelector('[aria-label="工程P图主原图"]')?.textContent).toContain('尚未选择'); expect(generate().disabled).toBe(true);
    expect(container.querySelector('[aria-label="图片实际使用模型"]')?.textContent).toContain('工程编辑模型'); expect(button('分组批量生成').disabled).toBe(true);
    await act(async () => generate().click()); expect(f.onGenerate).not.toHaveBeenCalled();
    await act(async () => button('导入工程原图').click()); expect(f.runner.importFiles).toHaveBeenCalledTimes(1); expect(f.onGenerate).not.toHaveBeenCalled();
  });
  it.each([['工程照片.png', '仅移除左下角杂物，保留工程构件'], ['结构图纸.png', '仅将标注 A12 改成 A13，保留尺寸与其他线条'], ['建筑效果图.png', '仅把指定墙面改为浅灰，保留透视和其他材质']])('%s直接使用已有静态结果，单次提交编辑模型和明确主图ID', async (name, request) => {
    saveDraft({ refinePrompt: request }); const original = artifact('original', name), f = fixture([resultRun(original)]), before = JSON.stringify(f.ledger); await render(f.props); await click('工程P图');
    expect(container.querySelector('[aria-label="工程P图主原图"]')?.textContent).toContain(name); expect(container.querySelector<HTMLTextAreaElement>('.ig-prompt')!.value).toBe(request); expect(generate().textContent).toBe('精修工程图 · 1 张');
    await vi.waitFor(() => expect(generate().disabled).toBe(false)); await act(async () => generate().click()); expect(f.onGenerate).toHaveBeenCalledTimes(1);
    expect(f.onGenerate.mock.calls[0][4]).toMatchObject({ engineeringEnabled: true, engineeringReferenceId: original.id, capability: 'image-editing', modelConfigId: 'edit-model', credentialId: 'account-metadata', imageOutputFormat: 'png', attachmentIds: [original.id] });
    expect(f.onGenerate.mock.calls[0][4].prompt).toContain(request); expect(f.onGenerate.mock.calls[0][4].wallpaperTarget).toBeUndefined(); expect(JSON.stringify(f.ledger)).toBe(before); expect(f.runner.importFiles).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(imageDraftKey(project.id))!).galleryBaseId).toBeUndefined();
  });
  it('程序默认修改话术、空要求和纯规范都不能被当作明确工程修改', async () => {
    const f = fixture([resultRun()]); saveDraft({ refinePrompt: '保留主体与整体构图，按我的要求调整细节。' }); await render(f.props); await click('工程P图');
    expect(container.querySelector<HTMLTextAreaElement>('.ig-prompt')!.value).toBe(''); expect(generate().disabled).toBe(true);
    for (const text of ['', '保留主体与整体构图，按我的要求调整细节。', ENGINEERING_IMAGE_PROMPT]) { await instruction(text); expect(generate().disabled).toBe(true); await act(async () => generate().click()); expect(f.onGenerate).not.toHaveBeenCalled(); }
    await instruction('仅删除图中左侧红色批注，其他线条不改'); await vi.waitFor(() => expect(generate().disabled).toBe(false)); expect(f.onGenerate).not.toHaveBeenCalled();
  });
  it.each(['image/gif', 'image/svg+xml'])('%s不会自动转动画、转矢量或作为工程主原图发送', async mimeType => {
    const f = fixture([resultRun(artifact('unsupported', '非静态原图', mimeType))]); await render(f.props); await click('工程P图');
    expect(generate().disabled).toBe(true); expect(f.onGenerate).not.toHaveBeenCalled(); expect(f.runner.prepareGeneratedAnimationReference).not.toHaveBeenCalled(); expect(f.runner.prepareSvgReference).not.toHaveBeenCalled();
  });
  it('新结果不会悄悄替换固定主原图，显式选择当前图片后才替换', async () => {
    const original = artifact('original', '原始工程照片.png'), changed = { ...artifact('new-result', '新版本.png'), createdAt: '2026-11-07T00:01:00Z' };
    saveDraft({ preset: '工程P图', references: [{ id: original.id, name: original.name }], mode: 'create' }); const f = fixture([resultRun(original)]); await render(f.props);
    f.runner.runs = [resultRun(changed), ...f.runner.runs]; await render(f.props);
    expect(container.querySelector('[aria-label="工程P图主原图"]')?.textContent).toContain(original.name);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="打开格式与属性"]')!.click()); await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="打开 AI 创作与修改"]')!.click());
    expect(container.querySelector('[aria-label="工程P图主原图"]')?.textContent).toContain(original.name);
    const request = container.querySelector<HTMLTextAreaElement>('.ig-prompt')!.value;
    await click('用当前图片作主原图'); expect(container.querySelector('[aria-label="工程P图主原图"]')?.textContent).toContain(changed.name); expect(container.querySelector<HTMLTextAreaElement>('.ig-prompt')!.value).toBe(request);
    await vi.waitFor(() => expect(generate().disabled).toBe(false)); await act(async () => generate().click()); expect(f.onGenerate.mock.calls[0][4].engineeringReferenceId).toBe(changed.id);
  });
  it('添加辅助参考图保留首张主原图与当前明确要求，不把辅助图当新主画布', async () => {
    const original = artifact('original', '主工程图.png'), auxiliary = artifact('auxiliary', '材料参考.png'), request = '只按辅助图替换指定饰面，工程结构与标注不动';
    saveDraft({ preset: '工程P图', mode: 'create', prompt: request, references: [{ id: original.id, name: original.name }] }); const f = fixture([resultRun(original)]); f.runner.importFiles.mockResolvedValueOnce([auxiliary]); await render(f.props); await click('导入工程原图');
    expect(container.querySelector('[aria-label="工程P图主原图"]')?.textContent).toContain(original.name); expect(container.querySelector<HTMLTextAreaElement>('.ig-prompt')!.value).toBe(request);
    await vi.waitFor(() => expect(generate().disabled).toBe(false)); await act(async () => generate().click()); expect(f.onGenerate.mock.calls[0][4]).toMatchObject({ engineeringReferenceId: original.id, attachmentIds: [original.id, auxiliary.id] }); expect(f.onGenerate.mock.calls[0][4].prompt).toContain(request);
  });
  it('工程、图片、壁纸入口能直接切换，撤销和重开保留原图与费用', async () => {
    const f = fixture([resultRun()]), before = JSON.stringify(f.ledger); await render(f.props); await click('工程P图');
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="撤销编辑"]')!.click()); expect(container.querySelector('[aria-label="工程P图主原图"]')).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="重做编辑"]')!.click()); expect(container.querySelector('[aria-label="工程P图主原图"]')?.textContent).toContain('工程照片.png');
    await act(async () => root!.unmount()); root = undefined; await render(f.props); expect(container.querySelector('[aria-label="工程P图主原图"]')?.textContent).toContain('工程照片.png');
    await click('图片'); expect(container.querySelector('[aria-label="工程P图主原图"]')).toBeNull(); expect(button('图片').getAttribute('aria-pressed')).toBe('true');
    await click('壁纸'); expect(container.querySelector('[aria-label="壁纸设备或分辨率"]')).not.toBeNull(); await click('工程P图'); expect(container.querySelector('[aria-label="壁纸设备或分辨率"]')).toBeNull(); expect(JSON.stringify(f.ledger)).toBe(before); expect(f.onGenerate).not.toHaveBeenCalled();
  });
  it('移除最后主原图后不能让当前成品自动顶替，显式选回后才就绪', async () => {
    const original = artifact(), f = fixture([resultRun(original)]); await render(f.props); await click('工程P图');
    const remove = container.querySelector<HTMLButtonElement>(`[aria-label="移除参考图 ${original.name}"]`)!; const summary = remove.closest('details')?.querySelector('summary'); if (summary) await act(async () => summary.click());
    await act(async () => remove.click()); expect(generate().disabled).toBe(true); expect(container.querySelector('[aria-label="工程P图主原图"]')?.textContent).toContain('尚未选择'); expect(f.onGenerate).not.toHaveBeenCalled();
    await click('用当前图片作主原图'); await vi.waitFor(() => expect(generate().disabled).toBe(false)); expect(f.onGenerate).not.toHaveBeenCalled();
  });
});
