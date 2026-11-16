// @vitest-environment jsdom
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageProps, Project, LedgerEntry } from '../types';
import type { WorkflowRun } from '../configuration-types';
import type { StudioAsset } from '../asset-types';
import { INITIAL_PREFERENCES } from '../data';
import { Finance } from './Finance';
import { Assets } from './Assets';
import { Activity } from './Activity';

vi.mock('../components/AssetThumbnail', () => ({ AssetThumbnail: () => null }));
vi.mock('../components/WorkflowRunCard', () => ({ WorkflowRunCard: ({ run }: { run: WorkflowRun }) => <div data-opened-run={run.id}>任务详情 {run.id}</div> }));
let root: Root | undefined, host: HTMLDivElement;
const project: Project = { id: 'project', workspaceId: 'workspace', name: '当前项目', kind: 'word', status: 'draft', description: '', updatedAt: '', costCents: 0, version: 0, accent: 'blue' };
function props(changes: Partial<PageProps> = {}) { return { workspaceId: project.workspaceId, workspace: { id: project.workspaceId, name: '当前工作区', directory: 'C:/fixture' }, activeProject: project, projects: [project], ledger: [], preferences: INITIAL_PREFERENCES, configuration: { categories: [], workflows: [], models: [], connections: [], credentials: [] }, navigate: vi.fn(), notify: vi.fn(), onCreateProject: vi.fn(), workflowRunner: { runs: [], runtimeStatus: { available: false }, resume: vi.fn(), retry: vi.fn() }, ...changes } as unknown as PageProps; }
beforeEach(() => { localStorage.clear(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', vi.fn(() => { throw Error('UI test must remain local'); })); host = document.createElement('div'); document.body.append(host); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host.remove(); delete window.desktop; expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
async function mount(element: ReactNode) { await act(async () => { root ||= createRoot(host); root.render(element); }); }
async function click(label: string) { const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.getAttribute('aria-label') === label || item.textContent?.trim() === label); expect(button).toBeTruthy(); await act(async () => button!.click()); }
async function input(label: string, value: string) { const field = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!; expect(field).toBeTruthy(); await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); }); }

describe('项目入口、任务定位和素材筛选恢复', () => {
  it('费用行和展开明细都直达对应项目概览，不变更费用', async () => {
    const ledger = [{ id: 'receipt', projectId: project.id, projectName: project.name, action: '初次生成', model: '测试模型', costCents: 5, billingMode: 'live', status: 'complete', time: '' }] as LedgerEntry[];
    const f = props({ ledger }), before = JSON.stringify(ledger); await mount(<Finance {...f} />);
    await click('查看项目 receipt'); expect(f.navigate).toHaveBeenLastCalledWith('project', project.id);
    await click('查看费用明细 receipt'); await click('打开项目'); expect(f.navigate).toHaveBeenLastCalledWith('project', project.id); expect(JSON.stringify(ledger)).toBe(before);
  });
  it('素材无结果可以一次清除搜索和筛选，不改动素材文件', async () => {
    const asset = { id: 'asset', workspaceId: project.workspaceId, name: '品牌资料.pdf', kind: 'other', mimeType: 'application/pdf', bytes: 1024, createdAt: '2026-11-16T00:00:00Z', favorite: false } as StudioAsset;
    const list = vi.fn().mockResolvedValue([asset]), importFiles = vi.fn(); Object.defineProperty(window, 'desktop', { configurable: true, value: { assets: { list, import: importFiles } } });
    await mount(<Assets {...props()} />); await click('我的素材'); await click('图片'); await input('搜索素材', '不存在的内容');
    expect(host.textContent).toContain('没有匹配的素材'); await click('清除素材筛选');
    expect(host.querySelector<HTMLInputElement>('input[aria-label="搜索素材"]')?.value).toBe(''); expect(host.textContent).toContain(asset.name); expect(importFiles).not.toHaveBeenCalled(); expect(list).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('我的素材分类');
  });
  it('真实空素材库的首份导入动作使用现有工作区导入API', async () => {
    const list = vi.fn().mockResolvedValue([]), importFiles = vi.fn().mockResolvedValue([]); Object.defineProperty(window, 'desktop', { configurable: true, value: { assets: { list, import: importFiles } } });
    await mount(<Assets {...props()} />); await click('我的素材'); expect(importFiles).not.toHaveBeenCalled(); await click('添加第一份素材'); expect(importFiles).toHaveBeenCalledWith({ workspaceId: project.workspaceId });
  });
  it('目标任务在后页时打开对应状态分页和详情，不执行任务', async () => {
    const runs = Array.from({ length: 28 }, (_, index) => ({ id: `run-${index}`, workspaceId: project.workspaceId, projectId: project.id, workflowId: `workflow-${index}`, workflowName: `流程-${index}`, status: 'failed', stepIndex: 0, variables: {}, input: '', snapshot: { id: `workflow-${index}`, workspaceId: project.workspaceId, name: `流程-${index}`, description: '', outputKind: project.kind, steps: [], updatedAt: '' }, attempts: [], updatedAt: new Date(2026, 10, 16, 0, index).toISOString(), createdAt: '' } as WorkflowRun));
    const f = props(), onTaskIntentConsumed = vi.fn(), before = JSON.stringify(runs);
    f.workflowRunner.runs = runs; f.taskIntent = { token: 'intent', workspaceId: project.workspaceId, projectId: project.id, runId: 'run-0' }; f.onTaskIntentConsumed = onTaskIntentConsumed;
    await mount(<Activity {...f} />); expect(host.querySelector('[data-opened-run="run-0"]')).toBeTruthy(); expect(host.textContent).toContain('2 / 2'); expect(host.querySelector('.activity-status-grid .active')?.textContent).toContain('需要处理'); expect(onTaskIntentConsumed).toHaveBeenCalledWith('intent');
    expect(f.workflowRunner.resume).not.toHaveBeenCalled(); expect(f.workflowRunner.retry).not.toHaveBeenCalled(); expect(JSON.stringify(runs)).toBe(before);
  });
  it('跨工作区任务意图不会展开或执行当前任务', async () => {
    const f = props(), onTaskIntentConsumed = vi.fn(); f.workflowRunner.runs = [{ id: 'run', workspaceId: project.workspaceId, projectId: project.id, workflowName: '当前流程', status: 'paused', snapshot: { steps: [] }, attempts: [], updatedAt: '' } as unknown as WorkflowRun];
    f.taskIntent = { token: 'foreign', workspaceId: 'other', projectId: project.id, runId: 'run' }; f.onTaskIntentConsumed = onTaskIntentConsumed;
    await mount(<Activity {...f} />); expect(host.querySelector('[data-opened-run]')).toBeNull(); expect(onTaskIntentConsumed).toHaveBeenCalledWith('foreign'); expect(f.workflowRunner.resume).not.toHaveBeenCalled();
  });
});
