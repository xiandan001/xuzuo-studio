// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import type { PageProps } from './types';
import { INITIAL_PREFERENCES } from './data';
import { emptyWorkspaceState, WORKSPACE_STORAGE_KEY } from './lib/workspace-persistence';

const completed = vi.fn(), cancelled = vi.fn();
vi.mock('./pages/Overview', () => ({ Overview: (props: PageProps) =>
  <><button onClick={() => props.onAutomateWorkflow?.('flow-a')}>配置自动触发验收</button><button onClick={() => props.onCreateProject('word', { quick: true, initial: { name: '春季提案', description: '原要求' }, onCreated: completed, onCancelled: cancelled })}>保存已有提案</button></>
}));
vi.mock('./pages/DocumentStudio', () => ({ DocumentStudio: ({ activeProject }: PageProps) => <output aria-label="目标编辑器">{activeProject.name}</output> }));
vi.mock('./pages/AutomationCenter', () => ({ AutomationCenter: (props: PageProps) => <output aria-label="配置的流程目标">{JSON.stringify(props.automationIntent)}</output> }));
let root: Root, host: HTMLDivElement;
const folder = 'C:/owned-test/new-workspace';
let bound = true;
const create = vi.fn(async (input: { workspaceId: string; projectId: string; name: string }) => ({ ...input, directory: folder + '/' + input.name }));
const chooseRoot = vi.fn(async () => { bound = true; return { workspaceId: 'one', directory: folder, name: '工作室' }; });
const selected = { selectionId: 'receipt', projectId: 'selected', workspaceId: 'one', directory: folder + '/alternate', name: 'alternate' };
const pick = vi.fn(async () => selected), claim = vi.fn(async (input: { name: string }) => ({ ...selected, name: input.name }));
const files = { list: async () => ({ projects: [], workspaces: bound ? [{ workspaceId: 'one', name: '工作室', directory: folder }] : [] }),
  choose: chooseRoot, chooseProjectFolder: pick, createProject: claim, createDefaultProject: create };
const saved = () => JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY)!);
async function paint() { await act(async () => { await new Promise(r => setTimeout(r, 20)); }); }
async function click(text: string) {
  await vi.waitFor(() => expect([...document.querySelectorAll('button')].some(b => b.textContent?.trim() === text || b.getAttribute('aria-label') === text)).toBe(true));
  const button = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === text || b.getAttribute('aria-label') === text)!;
  await act(async () => button.click()); await paint();
}
async function rename(value: string) {
  await act(async () => {
    const node = document.querySelector<HTMLInputElement>('input[aria-label="项目名称"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function open(hasDirectory = true) {
  bound = hasDirectory;
  const state = emptyWorkspaceState();
  state.activeWorkspaceId = 'one'; state.workspaces = [{ id: 'one', name: '工作室', description: '', ...(bound ? { directory: folder } : {}), createdAt: new Date().toISOString() }];
  state.preferencesByWorkspace = { one: INITIAL_PREFERENCES }; localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(state));
  await act(async () => root.render(<App />)); await paint();
}
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  Object.defineProperty(Element.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('desktop', { workspaceFiles: files }); vi.stubGlobal('fetch', vi.fn(() => { throw Error('Unexpected network'); }));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
it('普通新建先显示名称，取消零写入；再次新建直接使用当前工作区并打开作品', async () => {
  await open(); await click('新建作品'); expect(pick).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  await click('取消'); expect(saved().projects).toHaveLength(0);
  await click('新建作品'); await click('Word 文档'); await rename('客户手册'); await click('创建作品');
  expect(create).toHaveBeenCalledOnce(); expect(chooseRoot).not.toHaveBeenCalled(); expect(pick).not.toHaveBeenCalled();
  expect(saved().projects[0]).toMatchObject({ name: '客户手册', kind: 'word', directory: folder + '/客户手册' });
  expect(document.querySelector('[aria-label="目标编辑器"]')?.textContent).toBe('客户手册');
});
it('第一次建立工作区只选一次位置，已有名称和格式直接接续回调', async () => {
  await open(false); await click('保存已有提案');
  expect(chooseRoot).toHaveBeenCalledOnce(); expect(pick).not.toHaveBeenCalled(); expect(create).toHaveBeenCalledOnce();
  expect(completed).toHaveBeenCalledWith(expect.objectContaining({ name: '春季提案', kind: 'word', description: '原要求' }));
  expect(document.querySelector('.new-project-modal')).toBeNull(); expect(cancelled).not.toHaveBeenCalled();
  expect(saved().ledger).toEqual([]);
});
it('自选目录保留手填名称，仅使用原生选择票据提交', async () => {
  await open(); await click('新建作品'); await rename('保留的标题');
  await act(async () => document.querySelector<HTMLElement>('.new-project-location summary')!.click());
  await click('更换项目文件夹'); expect(document.querySelector<HTMLInputElement>('[aria-label="项目名称"]')!.value).toBe('保留的标题');
  await click('创建作品'); expect(create).not.toHaveBeenCalled(); expect(claim).toHaveBeenCalledWith({ selectionId: selected.selectionId, name: '保留的标题' });
});
it('快捷创建失败后保留表单和请求身份，明确重试才接续一次', async () => {
  await open(); create.mockRejectedValueOnce(Error('暂时无法确认创建结果')); await click('保存已有提案');
  expect(cancelled).not.toHaveBeenCalled(); expect(completed).not.toHaveBeenCalled(); expect(document.querySelector('[role=alert]')?.textContent).toContain('暂时无法确认');
  await click('创建并继续配置'); expect(create.mock.calls[0]).toEqual(create.mock.calls[1]); expect(completed).toHaveBeenCalledTimes(1);
  expect(saved().projects).toHaveLength(1); expect(saved().ledger).toHaveLength(0);
});

it('没有同类型作品时可在原流程中命名创建并直接配置该目标', async () => {
  localStorage.setItem('xuzuo-configuration-v1', JSON.stringify({ connections: [], models: [], categories: [], useTemplates: [], studioActions: [], workflows: [{ id: 'flow-a', name: '客户文案', description: '', workspaceId: 'one', outputKind: 'word', updatedAt: '2026-11-01T00:00:00Z', steps: [{ id: 'step-a', name: '创作', kind: 'text', prompt: '整理资料', inputSource: 'project', enabled: true }] }] }));
  await open(); await click('配置自动触发验收'); expect(create).not.toHaveBeenCalled(); expect(document.querySelector<HTMLInputElement>('[aria-label="项目名称"]')?.value).toBe('客户文案');
  await click('创建并继续配置');
  await vi.waitFor(() => expect(document.querySelector('[aria-label="配置的流程目标"]')).toBeTruthy());
  expect(JSON.parse(document.querySelector('[aria-label="配置的流程目标"]')!.textContent!)).toMatchObject({ workflowId: 'flow-a', workspaceId: 'one', projectId: saved().projects[0].id });
  expect(create).toHaveBeenCalledOnce(); expect(saved().ledger).toHaveLength(0);
});
