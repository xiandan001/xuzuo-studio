// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PageProps } from './types';
import type { WorkflowRun } from './configuration-types';
import type { SearchTarget } from './lib/global-search';
import { INITIAL_PREFERENCES } from './data';
import { emptyWorkspaceState, WORKSPACE_STORAGE_KEY } from './lib/workspace-persistence';
import App from './App';

const controls = vi.hoisted(() => ({ confirm: vi.fn(), read: vi.fn(), inspect: vi.fn(), start: vi.fn(), runs: [] as WorkflowRun[], target: {} as SearchTarget }));
vi.mock('./hooks/useEditorTransitions', () => ({ useEditorTransitions: () => ({ confirmTransition: controls.confirm, transitionDialog: null }) }));
vi.mock('./hooks/useWorkflowRunner', async original => {
  const actual = await original<typeof import('./hooks/useWorkflowRunner')>();
  return { ...actual, useWorkflowRunner: (...args: Parameters<typeof actual.useWorkflowRunner>) => ({ ...actual.useWorkflowRunner(...args), runs: controls.runs, start: controls.start }) };
});
vi.mock('./pages/Overview', () => ({ Overview: (props: PageProps) => <section aria-label="创作定位验收"><button onClick={() => props.onOpenDocumentUnit?.({ workspaceId: 'workspace-a', projectId: 'project-a', artifactId: 'file-a', kind: 'word', unitId: 'block._:1', sourceRevision: 2 })}>定位文档块</button><button onClick={() => props.onOpenDocumentUnit?.({ workspaceId: 'foreign', projectId: 'project-a', artifactId: 'file-a', kind: 'word', unitId: 'block._:1', sourceRevision: 2 })}>拒绝跨区文档</button><output>{JSON.stringify(props.searchTarget)}</output></section> }));
vi.mock('./pages/DocumentStudio', () => ({ DocumentStudio: (props: PageProps) => <section aria-label="文档定位验收"><output>{JSON.stringify(props.searchTarget)}</output><span>{props.activeProject.id}</span></section> }));
vi.mock('./pages/Activity', () => ({ Activity: (props: PageProps) => <section aria-label="通知任务定位验收"><output>{JSON.stringify(props.taskIntent)}</output></section> }));
vi.mock('./components/GlobalSearch', () => ({ GlobalSearch: ({ onNavigate }: { onNavigate: (view: 'overview', projectId: undefined, target: SearchTarget) => void }) => <button onClick={() => onNavigate('overview', undefined, controls.target)}>打开聊天正文命中</button> }));
let root: Root, host: HTMLDivElement;
const inspection = () => ({ target: { projectId: 'project-a', artifactId: 'file-a', sha256: 'a'.repeat(64), kind: 'word' }, inspection: { artifact: { id: 'file-a', projectId: 'project-a', name: '实际文件.docx' }, sha256: 'a'.repeat(64), sourceRevision: 2, documentSource: JSON.stringify({ kind: 'word', blocks: [{ id: 'block._:1', text: '实际文稿块' }] }) } });
beforeEach(() => {
  localStorage.clear(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Navigation must not use network'); }));
  Object.defineProperty(Element.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
  controls.confirm.mockReset().mockResolvedValue(true); controls.inspect.mockReset().mockResolvedValue(inspection()); controls.start.mockReset();
  controls.read.mockReset().mockResolvedValue({ id: 'conversation-a', workspaceId: 'workspace-a', turns: [{ id: 'turn-a' }] });
  controls.target = { token: 'search-target', kind: 'chat', id: 'conversation-a', conversationId: 'conversation-a', turnId: 'turn-a', workspaceId: 'workspace-a', name: '已保存沟通' };
  controls.runs = [{ id: 'run-a', workspaceId: 'workspace-a', projectId: 'project-a', workflowName: '完整任务', status: 'failed', mode: 'live', attempts: [], snapshot: { steps: [] } }] as unknown as WorkflowRun[];
  Object.defineProperty(window, 'desktop', { configurable: true, value: { chat: { selectTarget: controls.inspect, read: controls.read, ledger: vi.fn(async () => []), onChanged: () => () => undefined } } });
  const stored = emptyWorkspaceState(); stored.activeWorkspaceId = 'workspace-a'; stored.workspaces = [{ id: 'workspace-a', name: '工作区甲', description: '', createdAt: '', lastProjectId: 'project-a' }];
  stored.preferencesByWorkspace = { 'workspace-a': { ...INITIAL_PREFERENCES, studioName: '工作区甲' } };
  stored.projects = [{ id: 'project-a', workspaceId: 'workspace-a', name: '任务项目', kind: 'word', description: '', status: 'draft', costCents: 0, version: 0, updatedAt: '', accent: 'blue' }];
  localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(stored)); host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function paint() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); }); }
async function open() { await act(async () => root.render(<App />)); for (let i = 0; i < 30 && !host.querySelector('[aria-label="创作定位验收"]'); i++) await paint(); }
async function click(text: string) { const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(value => value.textContent?.trim() === text || value.getAttribute('aria-label') === text); expect(button).toBeTruthy(); await act(async () => button!.click()); await paint(); }
it('点击真实文档单元先保护草稿，再核对实际来源和修订，携带one-shot位置而不换稿或启动模型', async () => {
  await open(); await click('定位文档块'); for (let i = 0; i < 30 && !host.querySelector('[aria-label="文档定位验收"]'); i++) await paint();
  expect(controls.inspect).toHaveBeenCalledWith({ workspaceId: 'workspace-a', projectId: 'project-a', artifactId: 'file-a', kind: 'word' });
  const target = JSON.parse(host.querySelector('output')!.textContent!); expect(target).toMatchObject({ kind: 'document', editDocument: true, workspaceId: 'workspace-a', projectId: 'project-a', artifactId: 'file-a', documentUnitId: 'block._:1', sourceRevision: 2 });
  expect(controls.start).not.toHaveBeenCalled(); expect(JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY)!).ledger).toEqual([]);
});
it('拒绝保存或外工作区文档不读取来源，过期来源版本不进入另一份文稿', async () => {
  await open(); controls.confirm.mockResolvedValue(false); await click('定位文档块'); expect(controls.inspect).not.toHaveBeenCalled();
  controls.confirm.mockClear(); await click('拒绝跨区文档'); expect(controls.confirm).not.toHaveBeenCalled();
  controls.confirm.mockResolvedValue(true); controls.inspect.mockResolvedValue({ ...inspection(), inspection: { ...inspection().inspection, sourceRevision: 3 } }); await click('定位文档块');
  expect(host.querySelector('[aria-label="文档定位验收"]')).toBeNull(); expect(controls.start).not.toHaveBeenCalled();
});
it('统一聊天搜索先核对消息仍在当前会话中，再携稳定轮次到首页，过期命中保留当前页', async () => {
  await open(); await click('搜索作品与工具'); for (let i = 0; i < 30 && !host.textContent?.includes('打开聊天正文命中'); i++) await paint();
  await click('打开聊天正文命中'); const target = JSON.parse(host.querySelector('[aria-label="创作定位验收"] output')!.textContent!); expect(target).toMatchObject({ kind: 'chat', conversationId: 'conversation-a', turnId: 'turn-a', workspaceId: 'workspace-a' }); expect(controls.start).not.toHaveBeenCalled();
  await click('搜索作品与工具'); for (let i = 0; i < 30 && !host.textContent?.includes('打开聊天正文命中'); i++) await paint(); controls.read.mockResolvedValue({ id: 'conversation-a', workspaceId: 'workspace-a', turns: [] }); await click('打开聊天正文命中');
  expect(host.querySelector('[aria-label="文档定位验收"]')).toBeNull(); expect(controls.start).not.toHaveBeenCalled();
});
it('通知聚合同一任务并准确定位run，不跳到无筛选的所有任务列表', async () => {
  const stored = JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY)!); stored.ledger = [1, 2].map(n => ({ id: 'fee-' + n, workspaceId: 'workspace-a', projectId: 'project-a', projectName: '任务项目', workflowRunId: 'run-a', action: '初次生成', model: '模型', costCents: 5, time: '2026-11-17T00:00:0' + n + '.000Z', status: 'complete', billingMode: 'live' })); localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(stored));
  await open(); await click('通知与最近动态'); const rows = [...host.querySelectorAll<HTMLButtonElement>('.notification-popover>button')]; expect(rows).toHaveLength(1); await act(async () => rows[0].click()); await paint();
  for (let i = 0; i < 30 && !host.querySelector('[aria-label="通知任务定位验收"]'); i++) await paint();
  expect(JSON.parse(host.querySelector('output')!.textContent!)).toMatchObject({ workspaceId: 'workspace-a', projectId: 'project-a', runId: 'run-a' }); expect(controls.start).not.toHaveBeenCalled(); expect(JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY)!).ledger.reduce((sum: number, entry: { costCents: number }) => sum + entry.costCents, 0)).toBe(10);
});
