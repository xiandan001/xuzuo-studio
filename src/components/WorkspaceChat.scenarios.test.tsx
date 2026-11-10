// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatAttachment, ChatConversation, ChatStartRequest } from '../chat-types';
import type { ImageUseTemplate } from '../configuration-types';
import type { PageProps, Project } from '../types';
import { WorkspaceChat } from './WorkspaceChat';
import { readDisclosure } from '../lib/disclosure-state';

let root: Root | undefined, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Scenario selection must not make a real model request'); }));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 80, y: 100, left: 80, top: 100, right: 340, bottom: 144, width: 260, height: 44, toJSON: () => ({}) });
  host = document.createElement('div'); document.body.append(host);
});
afterEach(async () => {
  try { if (root) await act(async () => root!.unmount()); expect(fetch).not.toHaveBeenCalled(); }
  finally { root = undefined; host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});

const reference: ChatAttachment = { id: 'reference-image', name: '产品包装参考.png', kind: 'image', mimeType: 'image/png', bytes: 1000 };
const custom: ImageUseTemplate = { id: 'brand-purpose', workspaceId: 'workspace-one', name: '品牌商品横幅', prompt: '使用附件中的产品包装，制作清晰的品牌商品横幅。', size: '1536x1024', background: 'opaque', minReferences: 1, enabled: true };
const content = () => host.querySelector<HTMLTextAreaElement>('[aria-label="聊天内容"]')!;
async function input(text: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(content(), text); content().dispatchEvent(new Event('input', { bubbles: true })); }); }
async function click(label: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.getAttribute('aria-label') === label || item.textContent?.trim() === label);
  expect(button, label).toBeTruthy(); await act(async () => { button!.click(); });
}
async function openScenarios() { const picker = host.querySelector<HTMLButtonElement>('[aria-label="使用场景"]')!; expect(picker).toBeTruthy(); await act(async () => { picker.click(); }); }
async function findScenario(text: string) {
  const search = document.querySelector<HTMLInputElement>('[aria-label="搜索使用场景"]')!; expect(search).toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, text); search.dispatchEvent(new Event('input', { bubbles: true })); });
  return [...document.querySelectorAll<HTMLButtonElement>('[aria-label^="使用场景 "]')].find(item => item.querySelector('strong')?.textContent === text);
}
async function chooseScenario(text: string) { await openScenarios(); const option = await findScenario(text); expect(option, text).toBeTruthy(); await act(async () => { option!.click(); }); await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); }); }
async function fixture(templates: ImageUseTemplate[] = [custom]) {
  const records = new Map<string, ChatConversation>();
  const read = vi.fn(async ({ workspaceId, conversationId }: { workspaceId: string; conversationId: string }) => {
    const key = `${workspaceId}/${conversationId}`;
    if (!records.has(key)) { const time = new Date().toISOString(); records.set(key, { version: 1, id: conversationId, workspaceId, title: '新对话', createdAt: time, updatedAt: time, turnCount: 0, turns: [] }); }
    return structuredClone(records.get(key)!);
  });
  const start = vi.fn(async (request: ChatStartRequest) => read(request));
  const importAttachments = vi.fn(async () => [reference]);
  const bridge = { read, start, importAttachments, list: vi.fn(async () => []), ledger: vi.fn(async () => []), cancel: vi.fn(), flush: vi.fn(), onChanged: () => () => undefined };
  Object.defineProperty(window, 'desktop', { configurable: true, value: { chat: bridge, platform: 'darwin' } });
  const createProject = vi.fn(), usePrompt = vi.fn();
  const props = { workspaceId: 'workspace-one', workspace: { id: 'workspace-one', name: '独立工作区' }, projects: [], purgedProjects: [], activeProject: { id: '' }, configuration: { connections: [{ id: 'connection', name: '离线模型连接', providerId: 'openai', protocol: 'openai-responses', baseUrl: 'https://fixture.invalid/v1', enabled: true, status: 'configured' }], models: [{ id: 'model', connectionId: 'connection', name: '离线对话模型', modelId: 'fixture-chat-model', capabilities: ['text', 'vision'], enabled: true, pricing: { unit: 'million-tokens', currency: 'USD', input: '1', output: '2' } }], credentials: [{ id: 'key', connectionId: 'connection', name: '离线账户', lastFour: '1234', enabled: true }], workflows: [], categories: [], useTemplates: templates }, workflowRunner: { runs: [] }, ledger: [], preferences: {}, navigate: vi.fn(), notify: vi.fn(), onCreateProject: createProject, onUsePrompt: usePrompt } as unknown as PageProps;
  async function render(next = props) { await act(async () => { root ||= createRoot(host); root.render(<WorkspaceChat props={next} onLegacy={vi.fn()} />); }); }
  await render(); return { props, start, read, importAttachments, createProject, usePrompt, render };
}

describe('首页聊天使用场景的集成', () => {
  it('选择自定义场景保留草稿和附件，切到图片制作；显式发送才传递场景和附件', async () => {
    const f = await fixture(); await input('必须保留现有商品名和原包装。'); await click('添加附件');
    await chooseScenario(custom.name);
    expect(content().value).toMatch(/^必须保留现有商品名和原包装。\n\n使用场景：品牌商品横幅/);
    expect(content().value).toContain(custom.prompt); expect(content().value).toContain('1536 × 1024');
    expect(host.querySelector('[aria-label="待发送的附件"]')?.textContent).toContain(reference.name);
    expect(host.querySelector('[aria-label="对话用途"] [aria-pressed="true"]')?.textContent).toContain('制作');
    expect(host.querySelector('[aria-label="制作格式"] [aria-pressed="true"]')?.textContent).toBe('图片');
    expect(f.start).not.toHaveBeenCalled(); expect(f.createProject).not.toHaveBeenCalled(); expect(document.activeElement).toBe(content());
    await click('发送聊天消息'); expect(f.start).toHaveBeenCalledOnce();
    expect(f.start.mock.calls[0][0]).toMatchObject({ mode: 'plan', outputKind: 'image', attachmentIds: [reference.id], text: expect.stringContaining(custom.prompt) });
    expect(f.createProject).not.toHaveBeenCalled();
  });

  it('文档场景选择正确的Word格式，既有文字保留且不会立即调用模型', async () => {
    const f = await fixture(); await input('合同中保留双方确认的付款条件。'); await chooseScenario('把资料整理成正式文档');
    expect(content().value).toContain('合同中保留双方确认的付款条件。'); expect(content().value).toContain('合作说明书');
    expect(host.querySelector('[aria-label="制作格式"] [aria-pressed="true"]')?.textContent).toBe('Word');
    expect(f.start).not.toHaveBeenCalled(); expect(f.createProject).not.toHaveBeenCalled();
    await click('发送聊天消息'); expect(f.start.mock.calls[0][0]).toMatchObject({ mode: 'plan', outputKind: 'word' });
  });

  it('场景加已有输入超过10000字时保留原文与附件，也不切换聊天用途或发送', async () => {
    const f = await fixture(); const original = '原'.repeat(9990); await input(original); await click('添加附件');
    await chooseScenario(custom.name);
    expect(content().value).toBe(original); expect(host.querySelector('[role="alert"]')?.textContent).toContain('超过 10000 字');
    expect(host.querySelector('[aria-label="待发送的附件"]')?.textContent).toContain(reference.name);
    expect(host.querySelector('[aria-label="对话用途"] [aria-pressed="true"]')?.textContent).toContain('聊天');
    expect(f.start).not.toHaveBeenCalled(); expect(f.createProject).not.toHaveBeenCalled();
  });

  it('切换工作区不会显示或提交其他工作区的自定义场景、草稿或附件', async () => {
    const otherTemplate = { ...custom, id: 'other-purpose', workspaceId: 'workspace-two', name: '另一个工作区的场景' };
    const f = await fixture([custom, otherTemplate]); await input('第一个工作区的私有草稿'); await click('添加附件');
    const otherProps = { ...f.props, workspaceId: 'workspace-two', workspace: { ...f.props.workspace, id: 'workspace-two' } };
    await f.render(otherProps); expect(content().value).toBe(''); expect(host.querySelector('[aria-label="待发送的附件"]')).toBeNull();
    await openScenarios(); expect(await findScenario(custom.name)).toBeUndefined();
    expect(await findScenario(otherTemplate.name)).toBeTruthy();
    expect(f.start).not.toHaveBeenCalled(); expect(f.createProject).not.toHaveBeenCalled();
  });

  it('选择拼豆场景走真实网格工作台入口，不发送普通图片方案；用户打开时才选择项目', async () => {
    const f = await fixture(); await chooseScenario('拼豆');
    expect(host.querySelector('[aria-label="拼豆制图入口"]')).toBeTruthy();
    const draft = content().value; await click('发送聊天消息');
    expect(content().value).toBe(draft); expect(f.start).not.toHaveBeenCalled(); expect(f.createProject).not.toHaveBeenCalled();
    await click('打开拼豆工作台'); expect(f.createProject).toHaveBeenCalledOnce();
    expect(f.createProject.mock.calls[0][0]).toBe('image');
    const options = f.createProject.mock.calls[0][1]; expect(options.initial.name).toBe('拼豆图纸');
    await act(async () => { options.onCreated({ id: 'bead-project', workspaceId: 'workspace-one', kind: 'image' } as Project); });
    expect(f.usePrompt).toHaveBeenCalledWith(expect.objectContaining({ imagePreset: '拼豆' }), draft, 'bead-project');
    expect(f.start).not.toHaveBeenCalled();
  });
  it('顶部场景显示选中名称，自由聊天不清除原稿或附件且不自动发送', async () => {
    const f = await fixture(); await input('保留客户已经确认的要求。'); await click('添加附件'); await chooseScenario(custom.name);
    expect(host.querySelector('[aria-label="使用场景"]')?.textContent).toContain(custom.name);
    expect(readDisclosure('workspace:workspace-one:chat-scenario', '')).toBe(`image:${custom.id}`);
    const draft = content().value;
    await chooseScenario('自由聊天');
    expect(content().value).toBe(draft); expect(host.querySelector('[aria-label="待发送的附件"]')?.textContent).toContain(reference.name);
    expect(host.querySelector('[aria-label="使用场景"]')?.textContent).toContain('自由聊天');
    expect(host.querySelector('[aria-label="制作格式"]')).toBeNull(); expect(f.start).not.toHaveBeenCalled(); expect(f.createProject).not.toHaveBeenCalled();
  });
  it('聊天和制作格式切换保持场景标签一致并保留输入，不发生模型调用', async () => {
    const f = await fixture(); await input('这是我自己的需求。');
    expect(host.querySelector('[aria-label="使用场景"]')?.textContent).toContain('自由聊天');
    await click('制作'); expect(host.querySelector('[aria-label="使用场景"]')?.textContent).toContain('宣传图');
    await click('Word'); expect(host.querySelector('[aria-label="使用场景"]')?.textContent).toContain('正式文档');
    await click('聊天'); expect(host.querySelector('[aria-label="使用场景"]')?.textContent).toContain('自由聊天');
    expect(content().value).toBe('这是我自己的需求。'); expect(f.start).not.toHaveBeenCalled();
  });

});
