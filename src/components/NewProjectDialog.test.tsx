// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewProjectDialog } from './NewProjectDialog';
import type { NewProjectDraft } from './NewProjectDialog';
type Props = ComponentProps<typeof NewProjectDialog>;
let root: Root | undefined, host: HTMLDivElement;
const folderCalls = { choose: vi.fn(), create: vi.fn() };
const baseDraft = (): NewProjectDraft => ({ selection: { mode: 'workspace', workspaceId: crypto.randomUUID(), projectId: 'stable-project-id', directory: 'D:\\客户资料\\工作区', name: '原建议名' }, kind: 'image', name: '已经填写的作品标题', description: '', budget: '' });
beforeEach(() => { localStorage.clear(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); folderCalls.choose.mockReset(); folderCalls.create.mockReset(); Object.defineProperty(window, 'desktop', { configurable: true, value: { workspaceFiles: { chooseProjectFolder: folderCalls.choose, createProject: folderCalls.create } } }); host = document.createElement('div'); host.id = 'root'; document.body.append(host); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host.remove(); expect(folderCalls.choose).not.toHaveBeenCalled(); expect(folderCalls.create).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(window, 'desktop'); });
async function click(label: string) { const button = [...document.querySelectorAll<HTMLElement>('button,summary')].find(item => item.getAttribute('aria-label') === label || item.textContent?.trim() === label); expect(button).toBeTruthy(); await act(async () => button!.click()); }
async function input(label: string, value: string) { const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>('[aria-label="' + label + '"]')!; await act(async () => { Object.getOwnPropertyDescriptor(field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function fixture(initial = baseDraft(), options: Partial<Props> = {}) {
  const change = vi.fn(), choose = vi.fn(), reset = vi.fn(), create = vi.fn(), close = vi.fn(); let latest = initial;
  function Harness() { const [draft, setDraft] = useState<NewProjectDraft>(initial); latest = draft; return <NewProjectDialog workspaceName="本地创作空间" draft={draft} busy={false} picking={false} error="" onChange={patch => { change(patch); setDraft(current => ({ ...current, ...patch })); }} onChooseFolder={choose} onResetFolder={reset} onCreate={create} onClose={close} {...options} />; }
  await act(async () => { root = createRoot(host); root.render(<Harness />); }); return { change, choose, reset, create, close, draft: () => latest, async render(patch: Partial<Props>) { options = { ...options, ...patch }; await act(async () => root!.render(<Harness />)); } };
}
describe('新建作品：类型与名称优先、保存位置明确', () => {
  it('首次显示已有类型标题与默认位置，不先调用目录或创建；说明预算默认折叠', async () => {
    const f = await fixture(); expect(document.querySelector('[aria-label="项目名称"]')).toHaveProperty('value', '已经填写的作品标题'); expect(document.querySelector('[aria-label="作品类型"] button[aria-pressed="true"]')?.textContent).toContain('图像创作');
    expect(document.querySelector('.new-project-location')).toHaveProperty('open', false); expect(document.querySelector('.new-project-options')).toHaveProperty('open', false); expect(document.querySelector('.new-project-location summary')?.textContent).toContain('工作区默认位置'); expect(document.querySelector('.new-project-steps')).toBeNull(); expect(f.choose).not.toHaveBeenCalled(); expect(f.create).not.toHaveBeenCalled(); expect(f.change).not.toHaveBeenCalled();
  });
  it('显式类型锁定只显示当前类型摘要，不重复列出可改类型', async () => {
    const f = await fixture({ ...baseDraft(), kind: 'word', name: '入口传来的文档标题' }, { typeLocked: true }); expect(document.querySelector('[aria-label="已选作品类型"]')?.textContent).toContain('Word 文档'); expect(document.querySelector('[aria-label="作品类型"]')).toBeNull(); expect(document.querySelector('[aria-label="项目名称"]')).toHaveProperty('value', '入口传来的文档标题'); expect(f.change).not.toHaveBeenCalled();
  });
  it('修改类型名称不覆盖自选路径，只有用户明确操作才请求更换或恢复默认', async () => {
    const selected = { selectionId: 'actual-folder-receipt', workspaceId: crypto.randomUUID(), projectId: 'stable-project-id', directory: 'E:\\自选位置\\很长的客户文件夹', name: '目录原名' };
    const f = await fixture({ ...baseDraft(), selection: selected }); await input('项目名称', '手工修改的名字'); await click('Word 文档'); expect(f.draft().selection).toEqual(selected); expect(f.draft().name).toBe('手工修改的名字'); expect(f.change.mock.calls.every(([patch]) => !Object.hasOwn(patch, 'selection'))).toBe(true); expect(f.choose).not.toHaveBeenCalled(); expect(f.reset).not.toHaveBeenCalled();
    await click(document.querySelector('.new-project-location summary')!.textContent!.trim()); expect(document.querySelector('[aria-label="当前保存位置"]')?.textContent).toBe(selected.directory); await click('更换项目文件夹'); expect(f.choose).toHaveBeenCalledOnce(); expect(f.draft().selection).toEqual(selected); expect(f.draft().name).toBe('手工修改的名字'); await click('使用工作区默认位置'); expect(f.reset).toHaveBeenCalledOnce(); expect(f.create).not.toHaveBeenCalled();
  });
  it('路径和更多选项折叠在同一工作区保留记忆，初始已有说明预算不被清理', async () => {
    const draft = { ...baseDraft(), description: '保留入口中的说明', budget: '20.50' }; const f = await fixture(draft); await click(document.querySelector('.new-project-location summary')!.textContent!.trim()); await click(document.querySelector('.new-project-options summary')!.textContent!.trim()); expect(document.querySelector('.new-project-options')).toHaveProperty('open', true);
    await act(async () => root!.unmount()); root = undefined; await fixture(draft); expect(document.querySelector('.new-project-location')).toHaveProperty('open', true); expect(document.querySelector('.new-project-options')).toHaveProperty('open', true); expect(document.querySelector('[aria-label="创作说明"]')).toHaveProperty('value', '保留入口中的说明'); expect(document.querySelector('[aria-label="金额上限"]')).toHaveProperty('value', '20.50'); expect(f.create).not.toHaveBeenCalled();
  });
  it('中文组字Enter不提交，普通提交只调用创建回调并保留所有受控字段', async () => {
    const f = await fixture(); const field = document.querySelector<HTMLInputElement>('[aria-label="项目名称"]')!, form = document.querySelector('form')!; let enter!: KeyboardEvent;
    await act(async () => { field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); enter = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }); field.dispatchEvent(enter); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); expect(enter.defaultPrevented).toBe(true); expect(f.create).not.toHaveBeenCalled();
    await act(async () => { field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })); }); await input('项目名称', '中文作品名称'); await click('创建作品'); expect(f.create).toHaveBeenCalledOnce(); expect(f.draft().name).toBe('中文作品名称'); expect(f.draft().selection.projectId).toBe('stable-project-id');
  });
  it('必填名称和负数预算使用应用内提示，不打开目录也不提交无效数据', async () => {
    const f = await fixture(); await input('项目名称', '   '); await click('创建作品'); expect(document.querySelector('[role="alert"]')?.textContent).toContain('填写名称'); expect(f.create).not.toHaveBeenCalled();
    await input('项目名称', '有效名称'); await click(document.querySelector('.new-project-options summary')!.textContent!.trim()); await input('金额上限', '-1'); await click('创建作品'); expect(document.querySelector('.new-project-options')).toHaveProperty('open', true); expect(document.querySelector('[role="alert"]')).toBeTruthy(); expect(f.create).not.toHaveBeenCalled(); expect(f.draft().budget).toBe('-1');
  });
  it('取消、忙碌、首次未绑定与不支持桌面入口均不创建数据', async () => {
    const draft = baseDraft(), f = await fixture(draft, { busy: true }); await click('关闭新建项目'); await act(async () => { document.querySelector<HTMLButtonElement>('button[type="submit"]')!.click(); }); expect(f.close).not.toHaveBeenCalled(); expect(f.create).not.toHaveBeenCalled(); await f.render({ busy: false }); await click('取消'); expect(f.close).toHaveBeenCalledOnce(); expect(f.draft()).toEqual(draft);
    await f.render({ draft: { ...draft, selection: { ...draft.selection, mode: 'workspace', selectionId: undefined, directory: '' } } }); expect(document.querySelector('.new-project-location summary')?.textContent).toContain('创建时选择保存位置'); expect(document.querySelector('button[type="submit"]')?.textContent).toContain('选择位置并创建');
    await f.render({ draft: null, unavailable: true, returnToSelection: true }); expect(document.querySelector('form')).toBeNull(); await click('返回自动化配置'); expect(f.close).toHaveBeenCalledTimes(2); expect(f.create).not.toHaveBeenCalled();
  });
});
