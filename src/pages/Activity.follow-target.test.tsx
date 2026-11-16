// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageProps, Project } from '../types';
import type { WorkflowDefinition, WorkflowRun } from '../configuration-types';
import { INITIAL_PREFERENCES } from '../data';
import { Activity } from './Activity';

vi.mock('../components/WorkflowRunCard', () => ({ WorkflowRunCard: ({ run }: { run: WorkflowRun }) => <div data-opened-run={run.id}>任务详情 {run.id}</div> }));
const project: Project = { id: 'project', workspaceId: 'workspace', name: '状态跟随项目', kind: 'word', status: 'processing', description: '', updatedAt: '', costCents: 17, version: 1, accent: 'blue' };
const workflow: WorkflowDefinition = { id: 'workflow', workspaceId: project.workspaceId, name: '状态流程', description: '', outputKind: 'word', steps: [], updatedAt: '' };
function run(id: string, status: WorkflowRun['status'], minute = 0): WorkflowRun { return { id, workspaceId: project.workspaceId, projectId: project.id, workflowId: workflow.id, workflowName: `流程 ${id}`, snapshot: workflow, status, stepIndex: 0, attempts: [], variables: {}, input: '', createdAt: '2026-11-16T00:00:00Z', updatedAt: new Date(2026, 10, 16, 0, minute).toISOString(), mode: 'live' }; }
function fixture(siblings: WorkflowRun[] = []) {
  return { workspaceId: project.workspaceId, workspace: { id: project.workspaceId, name: '隔离工作区' }, activeProject: project, projects: [project], preferences: INITIAL_PREFERENCES, configuration: { categories: [], workflows: [], connections: [], models: [], credentials: [] }, ledger: [{ id: 'charge', projectId: project.id, projectName: project.name, action: '初次生成', model: '现有模型', billingMode: 'live', costCents: 17, status: 'complete', time: '' }], taskIntent: { token: 'intent', workspaceId: project.workspaceId, projectId: project.id, runId: 'target' }, onTaskIntentConsumed: vi.fn(), navigate: vi.fn(), notify: vi.fn(), onCreateProject: vi.fn(), workflowRunner: { runs: [...siblings, run('target', 'running')], runtimeStatus: { available: false }, resume: vi.fn(), retry: vi.fn() } } as unknown as PageProps;
}
let root: Root | undefined, host: HTMLDivElement;
beforeEach(() => { localStorage.clear(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', vi.fn(() => { throw Error('Task following must stay local'); })); host = document.createElement('div'); document.body.append(host); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host.remove(); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
async function render(f: PageProps) { const runsBefore = JSON.stringify(f.workflowRunner.runs), ledgerBefore = JSON.stringify(f.ledger); await act(async () => { root ||= createRoot(host); root.render(<Activity {...f} />); }); expect(JSON.stringify(f.workflowRunner.runs)).toBe(runsBefore); expect(JSON.stringify(f.ledger)).toBe(ledgerBefore); expect(f.workflowRunner.resume).not.toHaveBeenCalled(); expect(f.workflowRunner.retry).not.toHaveBeenCalled(); }
async function update(f: PageProps, target: WorkflowRun) { f.taskIntent = undefined; f.workflowRunner = { ...f.workflowRunner, runs: [...f.workflowRunner.runs.filter(item => item.id !== 'target'), target] }; await render(f); }
function group() { return host.querySelector('.activity-status-grid .active')?.querySelector('span')?.textContent; }
function page() { return host.querySelector('[aria-label="任务列表分页"]')?.textContent; }
async function clickGroup(label: string) { const button = [...host.querySelectorAll<HTMLButtonElement>('.activity-status-grid button')].find(item => item.querySelector('span')?.textContent === label)!; expect(button).toBeTruthy(); await act(async () => button.click()); }
async function click(label: string) { const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.getAttribute('aria-label') === label || item.textContent?.trim() === label)!; expect(button).toBeTruthy(); await act(async () => button.click()); }

describe('任务定位跟随实际状态，用户操作后停止', () => {
  it.each(['complete', 'failed'] as const)('已消费意图后 running → waiting-review → %s 始终定位同一展开任务', async finalStatus => {
    const siblings = (['running', 'waiting-review', finalStatus] as const).flatMap((status, section) => Array.from({ length: 27 }, (_, index) => run(`${section}-${index}`, status, index + 1)));
    const f = fixture(siblings); await render(f); expect(f.onTaskIntentConsumed).toHaveBeenCalledWith('intent');
    expect(group()).toBe('执行中'); expect(page()).toContain('2 / 2');
    for (const status of ['waiting-review', finalStatus] as const) {
      await update(f, run('target', status)); expect(group()).toBe(status === 'complete' ? '已结束' : '需要处理');
      expect(host.querySelectorAll('[data-task-id="target"]')).toHaveLength(1); expect(host.querySelector('[data-opened-run="target"]')).toBeTruthy();
    }
  });
  it('排序跨页时仍跟随目标，用户翻页后不再重定位或切换状态组', async () => {
    const f = fixture(Array.from({ length: 27 }, (_, index) => run(`sibling-${index}`, 'running', index + 1))); await render(f); expect(page()).toContain('2 / 2');
    await update(f, run('target', 'running', 50)); expect(page()).toContain('1 / 2'); expect(host.querySelector('[data-opened-run="target"]')).toBeTruthy();
    await click('下一页'); expect(page()).toContain('2 / 2'); expect(host.querySelector('[data-task-id="target"]')).toBeNull();
    await update(f, run('target', 'waiting-review', 55)); expect(group()).toBe('执行中'); expect(page()).toContain('2 / 2'); expect(host.querySelector('[data-task-id="target"]')).toBeNull();
  });
  it('手动切换状态组后保留用户筛选，不被后续任务状态覆盖', async () => {
    const f = fixture(); await render(f); await clickGroup('全部任务'); await update(f, run('target', 'waiting-review'));
    expect(group()).toBe('全部任务'); expect(host.querySelector('[data-task-id="target"]')).toBeTruthy();
  });
  it('手动搜索后保留关键词与当前状态组，不强行显示目标', async () => {
    const f = fixture([run('other', 'running', 1)]); await render(f);
    const field = host.querySelector<HTMLInputElement>('input[aria-label="搜索任务"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'other'); field.dispatchEvent(new Event('input', { bubbles: true })); });
    await update(f, run('target', 'failed')); expect(field.value).toBe('other'); expect(group()).toBe('执行中'); expect(host.querySelector('[data-task-id="target"]')).toBeNull(); expect(host.querySelector('[data-task-id="other"]')).toBeTruthy();
  });
  it('手动切换任务范围后保持该范围，不被目标完成状态覆盖', async () => {
    const f = fixture(); await render(f);
    const hidden = host.querySelectorAll<HTMLButtonElement>('.task-scope-filter button')[1]; await act(async () => hidden.click());
    await update(f, run('target', 'complete')); expect(host.querySelector('.task-scope-filter .active')?.textContent).toContain('已隐藏'); expect(group()).toBe('执行中'); expect(host.querySelector('[data-task-id="target"]')).toBeNull();
  });
  it('手动收起详情后不因状态切换重新展开', async () => {
    const f = fixture(); await render(f); await click('收起任务详情 target'); await update(f, run('target', 'waiting-review'));
    expect(group()).toBe('执行中'); expect(host.querySelector('[data-opened-run="target"]')).toBeNull();
  });
});
