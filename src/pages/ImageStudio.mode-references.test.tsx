// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageProps, Project } from '../types';
import type { ArtifactMetadata } from '../live-types';
import type { WorkflowRun } from '../configuration-types';
import { ImageStudio } from './ImageStudio';
import { imageDraftKey } from '../lib/image-studio';
import { studioPreferenceKey } from '../lib/studio-layout-state';
import { writeDisclosure } from '../lib/disclosure-state';

const project: Project = Object.freeze({ id: 'mode-project', workspaceId: 'mode-workspace', name: '模式附件隔离', kind: 'image', status: 'draft', description: '生成描述', updatedAt: '2026-11-07T00:00:00Z', costCents: 23, version: 0, accent: 'blue' });
const image = (id: string): ArtifactMetadata => ({ id, projectId: project.id, kind: 'image', name: `${id}.png`, mimeType: 'image/png', bytes: 68, path: `files/${id}.png`, createdAt: project.updatedAt });
const a = image('create-a'), b = image('result-b'), c = image('refine-c');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';
let root: Root | undefined, container: HTMLDivElement, previousStorage: [string, string][], desktopDescriptor: PropertyDescriptor | undefined;

function resultRun(): WorkflowRun {
  return { id: 'generated-run', mode: 'live', workspaceId: project.workspaceId, projectId: project.id, workflowId: 'generated-image', workflowName: '生成图片', status: 'complete', stepIndex: 1, input: '', variables: {}, createdAt: project.updatedAt, updatedAt: project.updatedAt,
    snapshot: { id: 'generated-image', name: '生成图片', workspaceId: project.workspaceId, outputKind: 'image', description: '', updatedAt: project.updatedAt, steps: [{ id: 'image', name: '图片', kind: 'image-editing', modelConfigId: 'editing-model', prompt: '', inputSource: 'project', enabled: true }] },
    attempts: [{ id: 'generated-attempt', stepId: 'image', stepName: '图片', modelLabel: '测试编辑模型', status: 'complete', costCents: 23, summary: '', input: '', prompt: '', action: '初次生成', artifacts: [b] }] };
}
function fixture() {
  const onGenerate = vi.fn(), removed = vi.fn(() => { throw Error('Mode changes must not remove artifacts'); });
  const ledger = Object.freeze([Object.freeze({ id: 'existing-fee', projectId: project.id, projectName: project.name, time: project.updatedAt, action: '初次生成', model: '测试编辑模型', status: 'complete', billingMode: 'live', costState: 'calculated', costCents: 23 })]);
  const runner = { runs: [] as WorkflowRun[], runtimeStatus: { available: true }, trashedArtifacts: [], importFiles: vi.fn(async () => [c]), previewArtifact: vi.fn(async (id: string) => ({ id, mimeType: 'image/png', supported: true, dataUrl: png })), inspectImageArtifact: vi.fn(async (id: string) => ({ id, mimeType: 'image/png', bytes: 68 })), trashArtifact: removed, deleteArtifact: removed };
  const props = { activeProject: project, projects: [project], workspaceId: project.workspaceId, workspace: { id: project.workspaceId, name: '隔离工作区' }, preferences: {}, ledger, prompts: [], workflowRunner: runner, onGenerate, onPromptApplied: vi.fn(), onUpdateProject: vi.fn(), notify: vi.fn(),
    configuration: { categories: [], workflows: [], studioActions: [], credentials: [{ id: 'fixture-key', name: '元数据账户', connectionId: 'connection', enabled: true }], connections: [{ id: 'connection', name: '隔离服务', enabled: true }], models: [{ id: 'generation-model', name: '生成模型', modelId: 'fixture-generation', connectionId: 'connection', capabilities: ['image-generation'], enabled: true }, { id: 'editing-model', name: '编辑模型', modelId: 'fixture-editing', connectionId: 'connection', capabilities: ['image-editing'], enabled: true }] } } as unknown as PageProps;
  return { props, runner, onGenerate, removed, ledger };
}
beforeEach(() => {
  previousStorage = Array.from({ length: localStorage.length }, (_, index): [string, string] => { const key = localStorage.key(index)!; return [key, localStorage.getItem(key)!]; });
  localStorage.clear(); desktopDescriptor = Object.getOwnPropertyDescriptor(window, 'desktop'); Object.defineProperty(window, 'desktop', { configurable: true, value: undefined });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', vi.fn(() => { throw Error('No provider or network calls in mode fixture'); }));
  container = document.createElement('div'); document.body.append(container);
  for (const [name, value] of [['initialized', true], ['panel-open', true], ['focus', false], ['tool', 'ai']] as const) writeDisclosure(studioPreferenceKey('images', { workspaceId: project.workspaceId, projectId: project.id }, name), value);
  localStorage.setItem(imageDraftKey(project.id), JSON.stringify({ prompt: '生成描述', refinePrompt: '精修要求', mode: 'create', generationModelId: 'generation-model', editingModelId: 'editing-model', references: [{ id: a.id, name: a.name }] }));
});
afterEach(async () => {
  try { if (root) await act(async () => root!.unmount()); expect(fetch).not.toHaveBeenCalled(); }
  finally { root = undefined; container.remove(); if (desktopDescriptor) Object.defineProperty(window, 'desktop', desktopDescriptor); else delete window.desktop; vi.unstubAllGlobals(); localStorage.clear(); for (const [key, value] of previousStorage) localStorage.setItem(key, value); }
});
async function render(props: PageProps) { await act(async () => { root ||= createRoot(container); root.render(<ImageStudio {...props} />); }); }
async function click(selector: string) { const button = container.querySelector<HTMLButtonElement>(selector); expect(button).not.toBeNull(); expect(button!.disabled).toBe(false); await act(async () => button!.click()); }
const mode = (value: 'create' | 'refine') => click(`.ig-mode-tabs button:nth-child(${value === 'create' ? 1 : 2})`);
const generate = () => click('.ig-primary-action > button');

describe('图片工作台模式与实际提交附件', () => {
  it('生成A→产物B→精修仅B→导入C为B+C→回生成A，重挂载仍隔离且不删文件或费用', async () => {
    const f = fixture(), originalLedger = JSON.stringify(f.ledger);
    await render(f.props); await generate();
    f.runner.runs = [resultRun()]; await render(f.props);
    await mode('refine'); await generate();
    expect(container.querySelector('[aria-label="移除参考图 create-a.png"]')).toBeNull();
    await click('[aria-label="导入图片"]'); await generate();
    await mode('create'); await generate();
    expect(f.onGenerate.mock.calls.map(call => call[4].attachmentIds)).toEqual([[a.id], [b.id], [b.id, c.id], [a.id]]);
    await act(async () => root!.unmount()); root = undefined;
    await render(f.props); await mode('refine'); await generate();
    expect(f.onGenerate.mock.calls.at(-1)![4]).toMatchObject({ capability: 'image-editing', attachmentIds: [b.id, c.id], credentialId: 'fixture-key', prompt: '精修要求' });
    expect(f.runner.importFiles).toHaveBeenCalledWith(project.id); expect(f.removed).not.toHaveBeenCalled(); expect(f.props.onUpdateProject).not.toHaveBeenCalled(); expect(JSON.stringify(f.ledger)).toBe(originalLedger); expect(project.costCents).toBe(23);
  });
  it('导入期间切回生成后迟到的精修参考不污染任一模式，文件删除和费用操作均不发生', async () => {
    const f = fixture(); f.runner.runs = [resultRun()];
    let release!: (files: ArtifactMetadata[]) => void;
    f.runner.importFiles.mockImplementationOnce(() => new Promise<ArtifactMetadata[]>(resolve => { release = resolve; }));
    await render(f.props); await mode('refine'); await click('[aria-label="导入图片"]');
    await mode('create'); await act(async () => release([c])); await generate();
    await mode('refine'); await generate();
    expect(f.onGenerate.mock.calls.map(call => call[4].attachmentIds)).toEqual([[a.id], [b.id]]);
    expect(f.removed).not.toHaveBeenCalled(); expect(f.props.onUpdateProject).not.toHaveBeenCalled(); expect(f.ledger[0].costCents).toBe(23);
  });
});
