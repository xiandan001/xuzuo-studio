// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PageProps } from './types';
import type { WorkflowRun } from './configuration-types';
import { INITIAL_PREFERENCES } from './data';
import { emptyWorkspaceState, WORKSPACE_STORAGE_KEY } from './lib/workspace-persistence';
import App from './App';

const state = vi.hoisted(() => ({ runs: [] as WorkflowRun[], confirm: vi.fn<() => Promise<boolean>>(), start: vi.fn() }));
vi.mock('./hooks/useEditorTransitions', () => ({ useEditorTransitions: () => ({ confirmTransition: state.confirm, transitionDialog: null }) }));
vi.mock('./hooks/useWorkflowRunner', async original => {
  const actual = await original<typeof import('./hooks/useWorkflowRunner')>();
  return { ...actual, useWorkflowRunner: (...args: Parameters<typeof actual.useWorkflowRunner>) => ({ ...actual.useWorkflowRunner(...args), runs: state.runs, start: state.start }) };
});
vi.mock('./pages/Overview', () => ({ Overview: (props: PageProps) => <><button onClick={() => props.onOpenTask?.('run-a', 'project-a')}>定位失败任务</button><button onClick={() => props.onOpenTask?.('run-foreign', 'project-foreign')}>定位其他工作区</button></> }));
vi.mock('./pages/Activity', () => ({ Activity: (props: PageProps) => <section aria-label="任务定位验收"><output>{JSON.stringify(props.taskIntent)}</output><button onClick={() => props.onTaskIntentConsumed?.(props.taskIntent!.token)}>消费定位</button></section> }));

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Navigation acceptance must not use network'); }));
  Object.defineProperty(Element.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
  state.confirm.mockReset().mockResolvedValue(true); state.start.mockReset();
  state.runs = [{ id: 'run-a', workspaceId: 'workspace-a', projectId: 'project-a', workflowName: '制作', status: 'failed', billingMode: 'live', attempts: [], snapshot: { steps: [] } }] as unknown as WorkflowRun[];
  const stored = emptyWorkspaceState(); stored.activeWorkspaceId = 'workspace-a';
  stored.workspaces = [{ id: 'workspace-a', name: '工作区甲', description: '', createdAt: '', lastProjectId: 'project-a' }];
  stored.preferencesByWorkspace = { 'workspace-a': { ...INITIAL_PREFERENCES, studioName: '工作区甲' } };
  stored.projects = [{ id: 'project-a', workspaceId: 'workspace-a', name: '任务项目', kind: 'word', description: '', status: 'draft', costCents: 0, version: 0, updatedAt: '', accent: 'blue' }];
  localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(stored));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function paint() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); }); }
async function open() { await act(async () => root.render(<App />)); for (let i = 0; i < 30 && !host.textContent?.includes('定位失败任务'); i++) await paint(); }
async function click(label: string) { const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label); expect(button).toBeTruthy(); await act(async () => button!.click()); await paint(); }
it('实际App导航携带工作区/项目/任务定位，只读进入且消费后清除', async () => {
  await open(); await click('定位失败任务'); for (let i = 0; i < 30 && !host.querySelector('[aria-label="任务定位验收"]'); i++) await paint();
  const target = JSON.parse(host.querySelector('output')!.textContent!); expect(target).toMatchObject({ workspaceId: 'workspace-a', projectId: 'project-a', runId: 'run-a', token: expect.any(String) });
  expect(state.confirm).toHaveBeenCalledTimes(1); expect(state.start).not.toHaveBeenCalled(); expect(state.runs[0].status).toBe('failed');
  await click('消费定位'); expect(host.querySelector('output')!.textContent).toBe(''); expect(JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY)!).ledger).toEqual([]);
});
it('保存保护拒绝导航时不进入任务页；外工作区目标不绕过校验', async () => {
  await open(); state.confirm.mockResolvedValue(false); await click('定位失败任务'); expect(host.querySelector('[aria-label="任务定位验收"]')).toBeNull();
  state.confirm.mockClear(); await click('定位其他工作区'); expect(state.confirm).not.toHaveBeenCalled(); expect(state.start).not.toHaveBeenCalled(); expect(host.querySelector('[aria-label="任务定位验收"]')).toBeNull();
});
it('等待保存期间任务被移走时，不用旧目标进入或重试任务', async () => {
  await open(); let allow!: (value: boolean) => void; state.confirm.mockImplementation(() => new Promise(resolve => { allow = resolve; }));
  await click('定位失败任务'); state.runs.splice(0);
  await act(async () => allow(true)); await paint(); expect(host.querySelector('[aria-label="任务定位验收"]')).toBeNull(); expect(state.start).not.toHaveBeenCalled();
});
