// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PageProps, Project } from './types';
import { INITIAL_PREFERENCES } from './data';
import { emptyWorkspaceState, WORKSPACE_STORAGE_KEY } from './lib/workspace-persistence';
import App from './App';

const gate = vi.hoisted(() => ({ confirm: vi.fn() }));
vi.mock('./hooks/useEditorTransitions', () => ({ useEditorTransitions: () => ({ confirmTransition: gate.confirm, transitionDialog: null }) }));
vi.mock('./pages/Overview', () => ({ Overview: (props: PageProps) => <section aria-label="面包屑入口"><button onClick={() => props.navigate('project', 'word-one')}>进入项目详情</button><button onClick={() => props.navigate('documents', 'word-one')}>进入文档</button><button onClick={() => props.navigate('images', 'image-one')}>进入图片</button><button onClick={() => props.navigate('images')}>空白图片工作台</button></section> }));
vi.mock('./pages/ProjectHub', () => ({ ProjectHub: ({ activeProject }: PageProps) => <output aria-label="面包屑项目内页">{activeProject.name}</output> }));
vi.mock('./pages/DocumentStudio', () => ({ DocumentStudio: ({ activeProject }: PageProps) => <output aria-label="面包屑项目内页">{activeProject.name}</output> }));
vi.mock('./pages/ImageStudio', () => ({ ImageStudio: ({ activeProject }: PageProps) => <output aria-label="面包屑项目内页">{activeProject.name}</output> }));
vi.mock('./pages/Projects', () => ({ Projects: ({ workspaceId, projects }: PageProps) => <section aria-label="面包屑当前区项目列表" data-workspace={workspaceId}>{projects.map(project => <p key={project.id}>{project.name}</p>)}</section> }));
let root: Root, host: HTMLDivElement;
const makeProject = (id: string, workspaceId: string, kind: Project['kind']) => ({ id, workspaceId, name: `作品-${id}`, kind, description: '', status: 'draft', updatedAt: '', costCents: 0, version: 0, accent: 'blue' } as Project);
beforeEach(() => {
  localStorage.clear(); gate.confirm.mockReset().mockResolvedValue(true); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('desktop', undefined); vi.stubGlobal('fetch', vi.fn(() => { throw Error('Breadcrumb navigation must not call a model or network'); }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); Object.defineProperty(Element.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function paint() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
async function open(withProjects: boolean | 'word-only' = true) {
  const stored = emptyWorkspaceState(); stored.activeWorkspaceId = 'one'; stored.workspaces = [{ id: 'one', name: '工作区甲', description: '', createdAt: '', directory: 'C:/one', lastProjectId: withProjects ? 'word-one' : undefined }, { id: 'other', name: '工作区乙', description: '', createdAt: '', directory: 'C:/other' }];
  stored.preferencesByWorkspace = { one: INITIAL_PREFERENCES, other: { ...INITIAL_PREFERENCES } }; stored.projects = withProjects ? [makeProject('word-one', 'one', 'word'), ...(withProjects === 'word-only' ? [] : [makeProject('image-one', 'one', 'image'), makeProject('foreign', 'other', 'word')])] : [];
  localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(stored)); await act(async () => root.render(<App />)); await vi.waitFor(() => expect(host.querySelector('[aria-label="面包屑入口"]')).toBeTruthy());
}
async function click(label: string) { const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label || node.getAttribute('aria-label') === label); expect(button, label).toBeTruthy(); await act(async () => button!.click()); await paint(); }
const breadcrumb = () => host.querySelector<HTMLElement>('nav[aria-label="面包屑"]')!;
it.each([['进入项目详情', 'word-one'], ['进入文档', 'word-one'], ['进入图片', 'image-one']])('%s显示中间项目入口，取消或等待确认不离开，确认后返回当前区列表且不重复入口', async (entry, id) => {
  await open(); await click(entry); await vi.waitFor(() => expect(host.querySelector('[aria-label="面包屑项目内页"]')?.textContent).toBe(`作品-${id}`));
  expect(breadcrumb().querySelectorAll('button')).toHaveLength(2); expect(breadcrumb().querySelector('[aria-label="返回项目列表"]')?.textContent).toBe('项目'); expect(breadcrumb().querySelector('strong[aria-current="page"]')?.textContent).toBe(`作品-${id}`);
  gate.confirm.mockClear(); gate.confirm.mockResolvedValueOnce(false); await click('返回项目列表'); expect(gate.confirm).toHaveBeenCalledOnce(); expect(host.querySelector('[aria-label="面包屑当前区项目列表"]')).toBeNull();
  gate.confirm.mockClear(); let release!: (allow: boolean) => void; gate.confirm.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })); await click('返回项目列表'); expect(gate.confirm).toHaveBeenCalledOnce(); expect(host.querySelector('[aria-label="面包屑当前区项目列表"]')).toBeNull();
  await act(async () => release(true)); await paint(); await vi.waitFor(() => expect(host.querySelector('[aria-label="面包屑当前区项目列表"]')).toBeTruthy());
  const list = host.querySelector<HTMLElement>('[aria-label="面包屑当前区项目列表"]')!; expect(list.dataset.workspace).toBe('one'); expect(list.textContent).toContain('作品-word-one'); expect(list.textContent).not.toContain('作品-foreign');
  expect(breadcrumb().querySelector('[aria-label="返回项目列表"]')).toBeNull(); expect(breadcrumb().querySelectorAll('button')).toHaveLength(1); expect(breadcrumb().querySelector('button')?.textContent).toBe('工作区甲');
  const stored = JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY)!); expect(stored.activeWorkspaceId).toBe('one'); expect(stored.ledger).toEqual([]);
});
it.each([false, 'word-only'] as const)('无有效图片项目的工作台不显示中间项目入口（%s）', async projects => { await open(projects); await click('空白图片工作台'); expect(breadcrumb().querySelector('[aria-label="返回项目列表"]')).toBeNull(); expect(breadcrumb().querySelectorAll('button')).toHaveLength(1); });
