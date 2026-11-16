// @vitest-environment jsdom
// Production DOM/state with a mocked dispatch boundary; no provider calls or native geometry claims.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageProps, Project } from '../types';
import type { WorkflowRun } from '../configuration-types';
import { imageDraftKey } from '../lib/image-studio';
import { studioPreferenceKey } from '../lib/studio-layout-state';
import { writeDisclosure } from '../lib/disclosure-state';
import { ImageStudio } from './ImageStudio';

const project: Project = { id: 'image-usability', workspaceId: 'usability-workspace', name: '图片设置', kind: 'image', description: '保留我的画面描述', status: 'draft', updatedAt: '2026-11-16T00:00:00Z', costCents: 23, version: 1, accent: 'blue' };
let root: Root | undefined, container: HTMLDivElement, previousStorage: [string, string][], desktopDescriptor: PropertyDescriptor | undefined, scrollDescriptor: PropertyDescriptor | undefined;
let nextFrame = 0;
const frames = new Map<number, FrameRequestCallback>();
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';

function fixture() {
  const onGenerate = vi.fn(), ledger = Object.freeze([Object.freeze({ id: 'fee', projectId: project.id, projectName: project.name, action: '初次生成', model: '原模型', billingMode: 'live', costState: 'calculated', costCents: 23, status: 'complete', time: project.updatedAt })]);
  const props = { activeProject: project, projects: [project], workspaceId: project.workspaceId, workspace: { id: project.workspaceId, name: '隔离工作区' }, preferences: { confirmGeneration: true }, ledger, prompts: [], notify: vi.fn(), onPromptApplied: vi.fn(), onGenerate,
    configuration: { categories: [], workflows: [], studioActions: [], useTemplates: [], connections: [{ id: 'image-service', name: '图片服务', enabled: true }, { id: 'assist-service', name: '辅助服务', enabled: true }], credentials: [{ id: 'image-key', connectionId: 'image-service', name: '图片账户', enabled: true }, { id: 'assist-a', connectionId: 'assist-service', name: '辅助账户甲', enabled: true }, { id: 'assist-b', connectionId: 'assist-service', name: '辅助账户乙', enabled: true }], models: [
      { id: 'image-model', name: '图片模型', modelId: 'gpt-image-2.6-sunburst', connectionId: 'image-service', enabled: true, capabilities: ['image-generation', 'image-editing'] },
      { id: 'text-a', name: '文本模型甲', modelId: 'fixture-text-a', connectionId: 'assist-service', enabled: true, capabilities: ['text'] },
      { id: 'text-b', name: '文本模型乙', modelId: 'fixture-text-b', connectionId: 'assist-service', enabled: true, capabilities: ['text'] },
      { id: 'vision-a', name: '视觉模型甲', modelId: 'fixture-vision-a', connectionId: 'assist-service', enabled: true, capabilities: ['vision'] },
      { id: 'vision-b', name: '视觉模型乙', modelId: 'fixture-vision-b', connectionId: 'assist-service', enabled: true, capabilities: ['vision'] },
    ] },
    workflowRunner: { runs: [] as WorkflowRun[], runtimeStatus: { available: true }, trashedArtifacts: [], previewArtifact: vi.fn(async () => ({ supported: true, mimeType: 'image/png', dataUrl: png })), inspectImageArtifact: vi.fn(async () => ({ id: 'result', mimeType: 'image/png', bytes: 68 })) },
  } as unknown as PageProps;
  return { props, onGenerate, ledger };
}
beforeEach(() => {
  previousStorage = Array.from({ length: localStorage.length }, (_, index): [string, string] => { const key = localStorage.key(index)!; return [key, localStorage.getItem(key)!]; }); localStorage.clear();
  desktopDescriptor = Object.getOwnPropertyDescriptor(window, 'desktop'); Object.defineProperty(window, 'desktop', { configurable: true, value: undefined });
  scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView'); Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', vi.fn(() => { throw Error('No provider or network calls in usability fixture'); }));
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; }); vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  container = document.createElement('div'); document.body.append(container);
  for (const [name, value] of [['initialized', true], ['panel-open', true], ['focus', false], ['tool', 'ai']] as const) writeDisclosure(studioPreferenceKey('images', { workspaceId: project.workspaceId, projectId: project.id }, name), value);
  localStorage.setItem(imageDraftKey(project.id), JSON.stringify({ prompt: project.description, quantity: 3, generationModelId: 'image-model', editingModelId: 'image-model' }));
});
afterEach(async () => {
  try { if (root) await act(async () => root!.unmount()); expect(fetch).not.toHaveBeenCalled(); }
  finally {
    root = undefined; frames.clear(); container.remove();
    if (desktopDescriptor) Object.defineProperty(window, 'desktop', desktopDescriptor); else delete window.desktop;
    if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollDescriptor); else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); for (const [key, value] of previousStorage) localStorage.setItem(key, value);
  }
});
async function render(props: PageProps) { await act(async () => { root ||= createRoot(container); root.render(<ImageStudio {...props} />); }); }
async function click(selector: string) { const button = container.querySelector<HTMLButtonElement>(selector); expect(button).not.toBeNull(); expect(button!.disabled).toBe(false); await act(async () => button!.click()); }
async function flushFrames() { const pending = [...frames.values()]; frames.clear(); await act(async () => { for (const callback of pending) callback(0); }); }
async function input(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); });
}

describe('图片生成设置与辅助调用可用性', () => {
  it.each(['png', 'svg', 'gif'])('%s参数只在AI面板编辑，属性页返回设置保留描述、数量和格式且不调用模型', async format => {
    const f = fixture(), draft = JSON.parse(localStorage.getItem(imageDraftKey(project.id))!);
    draft.imageOptions = { imageOutputFormat: format, imageFrameCount: 4, imageFrameDurationMs: 250 }; localStorage.setItem(imageDraftKey(project.id), JSON.stringify(draft));
    await render(f.props);
    await input(container.querySelector<HTMLTextAreaElement>('.ig-prompt')!, '往返面板仍保留的描述');
    await input(container.querySelector<HTMLInputElement>('[aria-label="图像生成数量"]')!, '5');
    expect(container.querySelectorAll('[aria-label="图像生成数量"]')).toHaveLength(1);
    await click('[aria-label="打开格式与属性"]');
    expect(container.querySelector('[aria-label="当前图片属性"]')?.textContent).toContain('尚无生成结果');
    expect(container.querySelector('[aria-label="下一次生成设置"]')?.textContent).toContain(format.toUpperCase());
    expect(container.querySelector('[aria-label="下一次生成设置"]')?.textContent).toContain('5');
    expect(container.querySelectorAll('[aria-label="图像生成数量"],[aria-label="图像输出尺寸"],[aria-label="图片输出格式"],[aria-label="图像输出背景"]')).toHaveLength(0);
    const adjust = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '调整生成设置')!;
    await act(async () => adjust.click()); await flushFrames();
    expect(container.querySelector<HTMLDetailsElement>('.ig-generation-settings > details')!.open).toBe(true);
    expect(container.querySelector<HTMLTextAreaElement>('.ig-prompt')!.value).toBe('往返面板仍保留的描述');
    expect(container.querySelector<HTMLInputElement>('[aria-label="图像生成数量"]')!.value).toBe('5');
    const saved = JSON.parse(localStorage.getItem(imageDraftKey(project.id))!); expect(saved.imageOptions.imageOutputFormat).toBe(format);
    expect(f.onGenerate).not.toHaveBeenCalled(); expect(f.ledger[0].costCents).toBe(23); expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
  it('数量错误直达唯一设置字段，展开折叠并选择当前值', async () => {
    const f = fixture(); await render(f.props);
    await input(container.querySelector<HTMLInputElement>('[aria-label="图像生成数量"]')!, '0');
    await click('.studio-action-status button'); await flushFrames();
    const quantity = container.querySelector<HTMLInputElement>('[aria-label="图像生成数量"]')!;
    expect(document.activeElement).toBe(quantity); expect(quantity.selectionStart).toBe(0); expect(quantity.selectionEnd).toBe(1);
    expect(container.querySelector<HTMLDetailsElement>('.ig-generation-settings > details')!.open).toBe(true); expect(f.onGenerate).not.toHaveBeenCalled();
  });
  it('优化和检查显示并提交各自已存文本/视觉模型与账户，保留原有确认偏好', async () => {
    const f = fixture(), file = { id: 'result', projectId: project.id, kind: 'image', name: '当前成品.png', mimeType: 'image/png', bytes: 68, path: 'files/result.png', createdAt: project.updatedAt };
    f.props.workflowRunner.runs = [{ id: 'image-run', workflowId: 'image-run', mode: 'live', workspaceId: project.workspaceId, projectId: project.id, status: 'complete', createdAt: project.updatedAt, updatedAt: project.updatedAt, snapshot: { id: 'image-run', steps: [{ id: 'image', kind: 'image-generation', modelConfigId: 'image-model', enabled: true }] }, attempts: [{ id: 'attempt', stepId: 'image', status: 'complete', artifacts: [file] }] }] as unknown as WorkflowRun[];
    f.props.configuration.workflows = [
      { id: `quick-${project.id}-text-refine`, steps: [{ kind: 'text', modelConfigId: 'text-b', credentialId: 'assist-b' }] },
      { id: `quick-${project.id}-vision-review`, steps: [{ kind: 'vision', modelConfigId: 'vision-b', credentialId: 'assist-a' }] },
    ] as unknown as PageProps['configuration']['workflows'];
    await render(f.props);
    const optimize = container.querySelector(`#image-optimize-${project.id}`)!, inspect = container.querySelector(`#image-inspect-${project.id}`)!;
    expect(optimize.textContent).toContain('文本模型乙'); expect(optimize.textContent).toContain('辅助账户乙'); expect(optimize.textContent).toContain('按实际调用计费');
    expect(inspect.textContent).toContain('视觉模型乙'); expect(inspect.textContent).toContain('辅助账户甲'); expect(inspect.textContent).toContain('按实际调用计费');
    await click(`[aria-describedby="${optimize.id}"]`); await click(`[aria-describedby="${inspect.id}"]`);
    expect(f.onGenerate).toHaveBeenCalledTimes(2);
    expect(f.onGenerate.mock.calls[0][4]).toMatchObject({ capability: 'text', modelConfigId: 'text-b', credentialId: 'assist-b' });
    expect(f.onGenerate.mock.calls[1][4]).toMatchObject({ capability: 'vision', modelConfigId: 'vision-b', credentialId: 'assist-a', attachmentIds: ['result'] });
    expect(f.props.preferences.confirmGeneration).toBe(true); expect(container.querySelector('[role="dialog"]')).toBeNull(); expect(f.ledger[0].costCents).toBe(23);
  });
});
