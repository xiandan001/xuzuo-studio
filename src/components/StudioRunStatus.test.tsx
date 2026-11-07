// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageProps, Project } from '../types';
import type { WorkflowRun } from '../configuration-types';
import { StudioRunStatus } from './StudioRunStatus';
import { STUDIO_TOOL_EVENT } from '../lib/studio-commands';

let root: Root | undefined, container: HTMLDivElement, previousStorage: [string, string][];
let previousScrollIntoView: PropertyDescriptor | undefined;
beforeEach(() => {
  previousStorage = Array.from({ length: localStorage.length }, (_, index) => { const key = localStorage.key(index)!; return [key, localStorage.getItem(key)!]; });
  localStorage.clear(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('No model or network calls in status fixture'); }));
  previousScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  container = document.createElement('div'); document.body.append(container);
});
afterEach(async () => {
  try { if (root) await act(async () => root!.unmount()); expect(fetch).not.toHaveBeenCalled(); }
  finally { root = undefined; container.remove(); if (previousScrollIntoView) Object.defineProperty(Element.prototype, 'scrollIntoView', previousScrollIntoView); else delete (Element.prototype as Partial<Element>).scrollIntoView; vi.unstubAllGlobals(); localStorage.clear(); for (const [key, value] of previousStorage) localStorage.setItem(key, value); }
});
function fixture(kind: Project['kind'] = 'image', status: WorkflowRun['status'] = 'waiting-review') {
  const project = { id: 'scroll-project', workspaceId: 'scroll-workspace', kind, name: '四份动画', status: 'draft', version: 0 } as Project;
  const artifacts = Array.from({ length: 4 }, (_, index) => ({ id: `gif-${index}`, projectId: project.id, runId: 'scroll-run', kind: 'image' as const, name: `动画-${index + 1}.gif`, mimeType: 'image/gif', bytes: 100, path: `managed/gif-${index}`, createdAt: '2026-11-07T00:00:00Z' }));
  const run: WorkflowRun = { id: 'scroll-run', workspaceId: project.workspaceId, projectId: project.id, workflowId: 'scroll-workflow', workflowName: '四份动画制作', mode: 'live', status, stepIndex: 1, variables: {}, input: '独立示例', createdAt: '2026-11-07T00:00:00Z', updatedAt: '2026-11-07T00:00:00Z',
    snapshot: { id: 'scroll-workflow', workspaceId: project.workspaceId, name: '四份动画制作', description: '', outputKind: kind, updatedAt: '', steps: [
      { id: 'images', name: '制作动画', kind: 'image-generation', prompt: '示例', inputSource: 'project', enabled: true },
      { id: 'review', name: '人工检查', kind: 'manual-review', prompt: '', inputSource: 'previous', enabled: true },
    ] }, attempts: [{ id: 'images-attempt', stepId: 'images', stepName: '制作动画', modelLabel: '示例模型', status: 'complete', costCents: 23, costState: 'calculated', summary: '四份已存在的动画', input: '', prompt: '', action: 'AI 精修', artifacts }] };
  const runner = { runs: [run], resume: vi.fn(), pause: vi.fn(), cancel: vi.fn(), startLive: vi.fn(), retry: vi.fn() };
  const ledger = [{ id: 'existing-fee', workflowRunId: run.id, workflowAttemptId: 'images-attempt', costCents: 23, costState: 'calculated', billingMode: 'live' }];
  const props = { activeProject: project, workspaceId: project.workspaceId, projects: [project], ledger, workflowRunner: runner, preferences: { confirmGeneration: false }, navigate: vi.fn(), notify: vi.fn() } as unknown as PageProps;
  return { props, runner, ledger, run };
}
async function render(props: PageProps) { await act(async () => { root ||= createRoot(container); root.render(<StudioRunStatus props={props} />); }); }
function button(label: string, parent: ParentNode = container) {
  const result = [...parent.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label);
  expect(result, `Missing button ${label}`).toBeDefined(); return result!;
}
async function click(label: string, parent?: ParentNode) { await act(async () => button(label, parent).click()); }
const heading = () => container.querySelector<HTMLElement>('.studio-run-status-heading')!;
const details = () => container.querySelector<HTMLElement>('[role="region"][aria-label="当前任务步骤与结果"]');

describe('工作台长任务详情与摘要操作', () => {
  it('同项目切到任务B时隔离任务A迟到的刷新，不留下禁用或反馈且保留项目展开记忆', async () => {
    const f = fixture('image', 'failed'); f.run.referenceIssue = { sourceStepId: 'images', reason: 'missing' };
    let finish!: () => void, refreshes = 0;
    const list = vi.fn((_id: string, options?: { refresh?: boolean }) => options?.refresh && ++refreshes === 1 ? new Promise<never[]>(resolve => { finish = () => resolve([]); }) : Promise.resolve([]));
    f.props.workflowRunner = { ...f.props.workflowRunner, listProjectArtifacts: list };
    await render(f.props); await click('查看来源文件', heading()); await click('刷新文件清单', details()!);
    expect(button('正在刷新', details()!).disabled).toBe(true);
    const next: WorkflowRun = { ...f.run, id: 'next-run', workflowName: '同项目的新任务', updatedAt: '2026-11-07T01:00:00Z' };
    f.props.workflowRunner = { ...f.props.workflowRunner, runs: [next] }; await render(f.props);
    expect(details()).not.toBeNull(); expect(button('收起步骤', heading()).getAttribute('aria-expanded')).toBe('true');
    expect(button('刷新文件清单', details()!).disabled).toBe(false); expect(details()!.textContent).not.toContain('文件清单已刷新');
    await act(async () => finish());
    expect(button('刷新文件清单', details()!).disabled).toBe(false); expect(details()!.textContent).not.toContain('文件清单已刷新');
    await click('刷新文件清单', details()!); expect(details()!.textContent).toContain('文件清单已刷新');
    expect(f.runner.resume).not.toHaveBeenCalled(); expect(f.runner.retry).not.toHaveBeenCalled(); expect(f.runner.startLive).not.toHaveBeenCalled();
  });
  it('摘要引用恢复入口展开同一张卡片并定位来源，重复定位和返回工作台都不执行任务', async () => {
    const f = fixture('image', 'failed'), before = JSON.stringify(f.ledger);
    f.run.referenceIssue = { sourceStepId: 'images', artifactId: 'gif-0', reason: 'trashed' }; f.run.error = '引用图片已移入回收站。';
    await render(f.props); expect(details()).toBeNull(); await click('查看来源文件', heading());
    const source = document.getElementById(`workflow-source-${f.run.id}-images`);
    expect(source).not.toBeNull(); expect(document.activeElement).toBe(source);
    expect(source!.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' });
    expect(container.querySelectorAll('.wf-reference-recovery')).toHaveLength(1); expect(details()!.querySelectorAll('.ar-file')).toHaveLength(4);
    button('查看来源文件', heading()).focus(); await click('查看来源文件', heading()); expect(document.activeElement).toBe(source);
    await click('返回工作台', details()!); expect(f.props.navigate).toHaveBeenCalledExactlyOnceWith('images', f.run.projectId);
    expect(f.runner.resume).not.toHaveBeenCalled(); expect(f.runner.retry).not.toHaveBeenCalled(); expect(f.runner.startLive).not.toHaveBeenCalled(); expect(JSON.stringify(f.ledger)).toBe(before);
  });
  it('摘要恢复等待原卡片详情读取后才定位来源，重复点击不会重复读取或自动继续', async () => {
    const f = fixture('image', 'failed'); f.run.referenceIssue = { sourceStepId: 'images', reason: 'missing' }; f.run.contentTruncated = true;
    let finish!: (run: WorkflowRun) => void;
    const load = vi.fn(() => new Promise<WorkflowRun>(resolve => { finish = resolve; })); f.props.workflowRunner = { ...f.props.workflowRunner, loadRunDetail: load };
    await render(f.props); await click('查看来源文件', heading()); expect(load).toHaveBeenCalledExactlyOnceWith(f.run.id);
    expect(document.getElementById(`workflow-source-${f.run.id}-images`)).toBeNull(); await click('查看来源文件', heading()); expect(load).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ...f.run, contentTruncated: false }));
    expect(document.activeElement).toBe(document.getElementById(`workflow-source-${f.run.id}-images`));
    expect(details()!.querySelectorAll('.ar-file')).toHaveLength(4); expect(container.querySelectorAll('.wf-reference-recovery')).toHaveLength(1);
    expect(f.runner.resume).not.toHaveBeenCalled(); expect(f.runner.retry).not.toHaveBeenCalled(); expect(f.runner.startLive).not.toHaveBeenCalled();
  });
  it('展开真实四份GIF产物卡到可聚焦区域，摘要检查继续仍可直接调用且不新增费用', async () => {
    const f = fixture(), before = JSON.stringify(f.ledger); await render(f.props);
    expect(details()).toBeNull(); await click('查看步骤');
    const region = details(); expect(region).not.toBeNull(); expect(region!.tabIndex).toBe(0);
    expect(region!.querySelectorAll('.ar-file')).toHaveLength(4); expect(region!.querySelector('.wf-run-card')).not.toBeNull();
    expect(button('收起步骤', heading()).getAttribute('aria-controls')).toBe(region!.id);
    region!.focus(); expect(document.activeElement).toBe(region);
    expect(region!.contains(heading())).toBe(false); await click('已检查，继续', heading());
    expect(f.runner.resume).toHaveBeenCalledExactlyOnceWith(f.run.id); expect(f.runner.startLive).not.toHaveBeenCalled(); expect(f.runner.retry).not.toHaveBeenCalled(); expect(JSON.stringify(f.ledger)).toBe(before);
    await click('收起步骤', heading()); expect(details()).toBeNull(); expect(button('查看步骤').getAttribute('aria-expanded')).toBe('false');
  });
  it('展开与收起在重挂载后仍沿用原项目折叠记忆', async () => {
    const f = fixture(); await render(f.props); await click('查看步骤');
    await act(async () => root!.unmount()); root = undefined; await render(f.props);
    expect(details()).not.toBeNull(); await click('收起步骤', heading());
    await act(async () => root!.unmount()); root = undefined; await render(f.props);
    expect(details()).toBeNull(); expect(f.runner.resume).not.toHaveBeenCalled(); expect(f.runner.startLive).not.toHaveBeenCalled();
  });
  it('展开运行详情时摘要暂停/取消仍可用，并保留暂停处理中禁用语义', async () => {
    const f = fixture('image', 'running'); await render(f.props); await click('查看步骤');
    await click('暂停', heading()); await click('取消', heading());
    expect(f.runner.pause).toHaveBeenCalledExactlyOnceWith(f.run.id); expect(f.runner.cancel).toHaveBeenCalledExactlyOnceWith(f.run.id);
    f.run.pauseRequested = true; await render(f.props); expect(button('暂停', heading()).disabled).toBe(true);
    expect(f.runner.startLive).not.toHaveBeenCalled(); expect(f.runner.retry).not.toHaveBeenCalled();
  });
  it('文档等待检查时展开摘要仍可打开编辑交付，不会自动继续执行', async () => {
    const f = fixture('word'), received = vi.fn(); window.addEventListener(STUDIO_TOOL_EVENT, received);
    try {
      await render(f.props); await click('查看步骤'); await click('编辑并交付', heading());
      expect(received).toHaveBeenCalledTimes(1); expect((received.mock.calls[0][0] as CustomEvent).detail).toEqual({ workspaceId: f.props.workspaceId, projectId: f.run.projectId, tool: 'delivery' });
      expect(f.runner.resume).not.toHaveBeenCalled(); expect(f.runner.startLive).not.toHaveBeenCalled();
    } finally { window.removeEventListener(STUDIO_TOOL_EVENT, received); }
  });
});
