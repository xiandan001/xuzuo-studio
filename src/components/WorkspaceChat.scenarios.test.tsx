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

const reference: ChatAttachment = { id: 'reference-image', name: '产品包装参考.png', kind: 'image', mimeType: 'image/png', bytes: 1000, sha256: 'a'.repeat(64), createdAt: new Date().toISOString() };
const custom: ImageUseTemplate = { id: 'brand-purpose', workspaceId: 'workspace-one', name: '品牌商品横幅', prompt: '使用附件中的产品包装，制作清晰的品牌商品横幅。', size: '1536x1024', background: 'opaque', minReferences: 1, enabled: true };
const content = () => host.querySelector<HTMLTextAreaElement>('[aria-label="聊天内容"]')!;
async function input(text: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(content(), text); content().dispatchEvent(new Event('input', { bubbles: true })); }); }
async function click(label: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.getAttribute('aria-label') === label || item.textContent?.trim() === label);
  expect(button, label).toBeTruthy(); await act(async () => { button!.click(); });
}
async function openScenarios() { const picker = host.querySelector<HTMLButtonElement>('[aria-label="选择使用场景"]')!; expect(picker).toBeTruthy(); await act(async () => { picker.click(); }); }
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
  const attachToProject = vi.fn(async () => [{ ...reference, id: 'project-reference' }]);
  const bridge = { read, start, importAttachments, attachToProject, list: vi.fn(async () => []), ledger: vi.fn(async () => []), cancel: vi.fn(), flush: vi.fn(), onChanged: () => () => undefined };
  Object.defineProperty(window, 'desktop', { configurable: true, value: { chat: bridge, platform: 'darwin' } });
  const createProject = vi.fn(), usePrompt = vi.fn();
  const props = { workspaceId: 'workspace-one', workspace: { id: 'workspace-one', name: '独立工作区' }, projects: [], purgedProjects: [], activeProject: { id: '' }, configuration: { connections: [{ id: 'connection', name: '离线模型连接', providerId: 'openai', protocol: 'openai-responses', baseUrl: 'https://fixture.invalid/v1', enabled: true, status: 'configured' }], models: [{ id: 'model', connectionId: 'connection', name: '离线对话模型', modelId: 'fixture-chat-model', capabilities: ['text', 'vision'], enabled: true, pricing: { unit: 'million-tokens', currency: 'USD', input: '1', output: '2' } }], credentials: [{ id: 'key', connectionId: 'connection', name: '离线账户', lastFour: '1234', enabled: true }], workflows: [], categories: [], useTemplates: templates }, workflowRunner: { runs: [] }, ledger: [], preferences: {}, navigate: vi.fn(), notify: vi.fn(), onCreateProject: createProject, onUsePrompt: usePrompt, onUpdateProject: vi.fn() } as unknown as PageProps;
  async function render(next = props) { await act(async () => { root ||= createRoot(host); root.render(<WorkspaceChat props={next} onLegacy={vi.fn()} />); }); }
  await render(); return { props, start, read, importAttachments, createProject, usePrompt, render };
}

async function addAttachment() { await click('添加聊天附件'); await click('本机文件'); }

describe('首页聊天使用场景的集成', () => {
  it('自定义场景保留用户草稿和附件，只在显式发送时组合场景要求', async () => {
    const f = await fixture(); const original = '必须保留现有商品名和原包装。'; await input(original); await addAttachment();
    await chooseScenario(custom.name);
    expect(content().value).toBe(original);
    expect(host.querySelector('[aria-label="本轮附件"]')?.textContent).toContain(reference.name);
    expect(host.querySelector('[aria-label="选择使用场景"]')?.textContent).toContain(custom.name);
    expect(f.start).not.toHaveBeenCalled(); expect(f.createProject).not.toHaveBeenCalled();
    await click('发送聊天消息'); expect(f.start).toHaveBeenCalledOnce();
    expect(f.start.mock.calls[0][0]).toMatchObject({ mode: 'plan', outputKind: 'image', attachmentIds: [reference.id], text: original, requestText: expect.stringContaining(custom.prompt) });
    expect(f.createProject).not.toHaveBeenCalled();
  });
  it('文档场景选中Word，既有文字保持，发送才采用文档制作要求', async () => {
    const f = await fixture(); const original = '合同中保留双方确认的付款条件。'; await input(original); await chooseScenario('Word 文档');
    expect(content().value).toBe(original); expect(host.querySelector('[aria-label="选择使用场景"]')?.textContent).toContain('Word 文档');
    expect(f.start).not.toHaveBeenCalled(); await click('发送聊天消息');
    expect(f.start.mock.calls[0][0]).toMatchObject({ mode: 'plan', outputKind: 'word', text: original, requestText: expect.stringContaining('可编辑的 Word 文档') });
  });
  it('满10000字的草稿切换场景不被覆盖或追加内容，附件仍保留', async () => {
    const f = await fixture(); const original = '原'.repeat(10000); await input(original); await addAttachment(); await chooseScenario(custom.name);
    expect(content().value).toBe(original); expect(f.start).not.toHaveBeenCalled();
    expect(content().value).toBe(original); expect(host.querySelector('[aria-label="本轮附件"]')?.textContent).toContain(reference.name);
    expect(f.createProject).not.toHaveBeenCalled();
  });
  it('切换工作区不会显示或提交其他工作区的自定义场景、草稿或附件', async () => {
    const otherTemplate = { ...custom, id: 'other-purpose', workspaceId: 'workspace-two', name: '另一个工作区的场景' };
    const f = await fixture([custom, otherTemplate]); await input('第一个工作区的私有草稿'); await addAttachment();
    await f.render({ ...f.props, workspaceId: 'workspace-two', workspace: { ...f.props.workspace, id: 'workspace-two' } });
    expect(content().value).toBe(''); expect(host.querySelector('[aria-label="本轮附件"]')).toBeNull();
    await openScenarios(); expect(await findScenario(custom.name)).toBeUndefined(); expect(await findScenario(otherTemplate.name)).toBeTruthy();
    expect(f.start).not.toHaveBeenCalled(); expect(f.createProject).not.toHaveBeenCalled();
  });
  it('拼豆场景需要原图，用户显式进入后才建项目并复制原图', async () => {
    const f = await fixture(); await chooseScenario('拼豆'); await click('进入拼豆');
    expect(f.createProject).not.toHaveBeenCalled(); expect(f.start).not.toHaveBeenCalled(); await addAttachment(); await input('保留原图主体'); await click('进入拼豆');
    expect(f.createProject).toHaveBeenCalledOnce(); const options = f.createProject.mock.calls[0][1];
    await act(async () => { options.onCreated({ id: 'bead-project', workspaceId: 'workspace-one', kind: 'image' } as Project); });
    expect(f.usePrompt).toHaveBeenCalledWith(expect.objectContaining({ imagePreset: '拼豆' }), expect.stringContaining('保留原图主体'), 'bead-project', expect.objectContaining({ referenceFiles: [expect.objectContaining({ id: 'project-reference' })] })); expect(f.start).not.toHaveBeenCalled();
  });
  it('自由聊天和制作格式切换保留原稿附件，场景标签一致且不自动发送', async () => {
    const f = await fixture(); await input('保留客户已经确认的要求。'); await addAttachment(); await chooseScenario(custom.name);
    expect(readDisclosure('workspace:workspace-one:chat-scenario', '')).toBe(`purpose-${custom.id}`);
    await chooseScenario('自由聊天'); expect(content().value).toBe('保留客户已经确认的要求。'); expect(host.querySelector('[aria-label="本轮附件"]')?.textContent).toContain(reference.name);
    await chooseScenario('宣传图'); expect(host.querySelector('[aria-label="选择使用场景"]')?.textContent).toContain('宣传图');
    await chooseScenario('Word 文档'); expect(host.querySelector('[aria-label="选择使用场景"]')?.textContent).toContain('Word 文档');
    await chooseScenario('自由聊天'); expect(host.querySelector('[aria-label="选择使用场景"]')?.textContent).toContain('自由聊天');
    expect(f.start).not.toHaveBeenCalled(); expect(f.createProject).not.toHaveBeenCalled();
  });
});
