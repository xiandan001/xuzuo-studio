// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageStudio } from './ImageStudio';
import { imageDraftKey } from '../lib/image-studio';
import { studioPreferenceKey } from '../lib/studio-layout-state';
import { writeDisclosure } from '../lib/disclosure-state';
import type { PageProps, Project } from '../types';
import type { ArtifactMetadata } from '../live-types';
import type { WorkflowRun } from '../configuration-types';
import type { WallpaperTarget } from '../wallpaper-types';

const project = { id: 'four-k', workspaceId: 'workspace', name: '4K壁纸', kind: 'image', status: 'draft', description: '', updatedAt: '2026-11-07T00:00:00Z', version: 1, costCents: 23, accent: 'blue' } as Project;
const target: WallpaperTarget = { width: 1170, height: 2532, fit: 'cover' };
const artifact = (id = 'original'): ArtifactMetadata => ({ id, projectId: project.id, runId: id, kind: 'image', name: `${id}.png`, mimeType: 'image/png', bytes: 100, path: `managed/${id}`, createdAt: '' });
function run(file = artifact(), savedTarget = target): WorkflowRun { return { id: file.id, workspaceId: project.workspaceId, projectId: project.id, workflowId: 'wallpaper', workflowName: '壁纸', mode: 'live', status: 'complete', stepIndex: 1, variables: {}, input: '', createdAt: '2026-11-07T00:00:00Z', updatedAt: '2026-11-07T00:00:00Z', snapshot: { id: 'wallpaper', name: '壁纸', description: '', workspaceId: project.workspaceId, outputKind: 'image', updatedAt: '', steps: [{ id: 'export', name: '壁纸导出', kind: 'export', inputSource: 'previous', enabled: true, prompt: '', wallpaperTarget: savedTarget }] }, attempts: [{ id: `attempt-${file.id}`, stepId: 'export', stepName: '壁纸导出', modelLabel: '本地', status: 'complete', costCents: 0, summary: '', input: '', prompt: '', action: '初次生成', artifacts: [file] }] }; }
let root: Root | undefined, container: HTMLDivElement, storage: [string, string][];
beforeEach(() => {
  storage = Array.from({ length: localStorage.length }, (_, i) => { const key = localStorage.key(i)!; return [key, localStorage.getItem(key)!]; }); localStorage.clear();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} }); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Local 4K tests must not access providers'); }));
  container = document.createElement('div'); document.body.append(container);
  for (const [key, value] of [['initialized', true], ['panel-open', true], ['focus', false], ['tool', 'ai']] as const) writeDisclosure(studioPreferenceKey('images', { workspaceId: project.workspaceId, projectId: project.id }, key), value);
  localStorage.setItem(imageDraftKey(project.id), JSON.stringify({ preset: '壁纸', wallpaperEnabled: true, wallpaperTarget: { width: 1920, height: 1080, fit: 'contain' }, mode: 'create', prompt: '月夜壁纸', quantity: 1, references: [] }));
});
afterEach(async () => { try { if (root) await act(async () => root!.unmount()); expect(fetch).not.toHaveBeenCalled(); } finally { root = undefined; container.remove(); vi.unstubAllGlobals(); localStorage.clear(); for (const [key, value] of storage) localStorage.setItem(key, value); } });
function fixture(savedTarget = target) {
  const output = artifact('four-k-output'), saveArtifact = vi.fn(async () => ({ saved: true })), exportWallpaper4K = vi.fn(async (): Promise<{ artifact: ArtifactMetadata; target: WallpaperTarget; locallyAdapted: true }> => ({ artifact: output, target: { width: 2160, height: 3840, fit: 'contain' }, locallyAdapted: true }));
  const runner = { runs: [run(artifact(), savedTarget)], trashedArtifacts: [], runtimeStatus: { available: true }, previewArtifact: vi.fn(async () => ({ mimeType: 'image/png' })), saveArtifact, exportWallpaper4K };
  const ledger = Object.freeze([Object.freeze({ id: 'fee', projectId: project.id, billingMode: 'live', costState: 'calculated', costCents: 23 })]);
  const props = { activeProject: project, projects: [project], workspaceId: project.workspaceId, workspace: { id: project.workspaceId, name: '隔离' }, preferences: {}, prompts: [], ledger, workflowRunner: runner, onGenerate: vi.fn(), onPromptApplied: vi.fn(), onUpdateProject: vi.fn(), notify: vi.fn(), configuration: { categories: [], workflows: [], studioActions: [], credentials: [{ id: 'key-alias', connectionId: 'connection', name: '账户别名', enabled: true }], connections: [{ id: 'connection', name: '隔离', enabled: true }], models: [{ id: 'model', modelId: 'gpt-image-2.6-sunburst', name: '图片模型', connectionId: 'connection', capabilities: ['image-generation', 'image-editing'], enabled: true }] } } as unknown as PageProps;
  return { props, runner, ledger, output, saveArtifact, exportWallpaper4K };
}
async function render(props: PageProps) { await act(async () => { root ||= createRoot(container); root.render(<ImageStudio {...props} />); }); }
const saveButton = () => [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '另存4K')!;

describe('壁纸4K本地另存', () => {
  it('快捷尺寸是自定义4K且清除机型绑定，保留适配方式，不调用模型', async () => {
    const f = fixture(); await render(f.props); await act(async () => container.querySelector<HTMLButtonElement>('.wallpaper-4k-quick button:last-child')!.click());
    const draft = JSON.parse(localStorage.getItem(imageDraftKey(project.id))!); expect(draft.wallpaperTarget).toMatchObject({ width: 3840, height: 2160, fit: 'contain' }); expect(draft.wallpaperTarget.deviceId).toBeUndefined(); expect(f.props.onGenerate).not.toHaveBeenCalled(); expect(f.exportWallpaper4K).not.toHaveBeenCalled();
  });
  it('方向取当前保存目标，不拿新草稿的横屏冒充旧竖图；0API且不换账户模型', async () => {
    const f = fixture(), config = JSON.stringify(f.props.configuration), fee = JSON.stringify(f.ledger); await render(f.props); await act(async () => saveButton().click());
    expect(f.exportWallpaper4K).toHaveBeenCalledExactlyOnceWith({ projectId: project.id, sourceArtifactId: 'original', orientation: 'portrait', fit: 'contain' }); expect(f.saveArtifact).toHaveBeenCalledExactlyOnceWith(f.output.id); expect(f.props.onGenerate).not.toHaveBeenCalled(); expect(JSON.stringify(f.props.configuration)).toBe(config); expect(JSON.stringify(f.ledger)).toBe(fee);
  });
  it('已是标准4K直接另存，不再次重采样', async () => {
    const f = fixture({ width: 3840, height: 2160, fit: 'cover' }); await render(f.props); await act(async () => saveButton().click()); expect(f.exportWallpaper4K).not.toHaveBeenCalled(); expect(f.saveArtifact).toHaveBeenCalledExactlyOnceWith('original');
  });
  it('原生导出自己的4K新结果自动选中后仍能打开正确另存，不重复点击', async () => {
    const f = fixture(); let finish!: (value: Awaited<ReturnType<typeof f.exportWallpaper4K>>) => void; f.exportWallpaper4K.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await render(f.props);
    await act(async () => saveButton().click()); expect(saveButton().disabled).toBe(true); await act(async () => saveButton().click());
    f.runner.runs = [run(f.output, { width: 2160, height: 3840, fit: 'contain' }), ...f.runner.runs]; await render(f.props); await act(async () => finish({ artifact: f.output, target: { width: 2160, height: 3840, fit: 'contain' }, locallyAdapted: true })); expect(f.exportWallpaper4K).toHaveBeenCalledTimes(1); expect(f.saveArtifact).toHaveBeenCalledExactlyOnceWith(f.output.id);
  });
  it('用户在等待中改选其他图片，迟到的4K结果不会打开旧图片保存窗口', async () => {
    const f = fixture(), other = artifact('other'); f.runner.runs.push(run(other)); let finish!: (value: Awaited<ReturnType<typeof f.exportWallpaper4K>>) => void; f.exportWallpaper4K.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await render(f.props); await act(async () => saveButton().click());
    const select = [...container.querySelectorAll<HTMLButtonElement>('[aria-label^="选择图片"]')].find(button => button.getAttribute('aria-label')?.includes(other.name))!; await act(async () => select.click());
    await act(async () => finish({ artifact: f.output, target: { width: 2160, height: 3840, fit: 'contain' }, locallyAdapted: true })); expect(f.saveArtifact).not.toHaveBeenCalled(); expect(f.props.onGenerate).not.toHaveBeenCalled();
  });
});
