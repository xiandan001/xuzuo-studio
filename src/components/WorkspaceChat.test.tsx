// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatChangedEvent, ChatConversation, ChatStartRequest, ChatTurn } from '../chat-types';
import type { PageProps } from '../types';
import { WorkspaceChat } from './WorkspaceChat';

let root: Root | undefined, host: HTMLDivElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear(); host = document.createElement('div'); document.body.append(host); vi.stubGlobal('fetch', vi.fn(() => { throw Error('UI tests must not use the network'); })); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host.remove(); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
const now = () => new Date().toISOString();
async function input(value: string) {
  const field = host.querySelector<HTMLTextAreaElement>('[aria-label="聊天内容"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function click(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === label || button.textContent?.trim() === label);
  expect(button).toBeTruthy(); await act(async () => button!.click());
}
async function fixture(modelId = 'gpt-6.1-terra') {
  const workspaceId = crypto.randomUUID(), listeners = new Set<(event: ChatChangedEvent) => void>();
  let record: ChatConversation | undefined;
  const connection = { id: 'connection', name: 'OpenAI', providerId: 'openai', protocol: 'openai-responses', baseUrl: 'https://api.openai.com/v1', enabled: true, status: 'configured' };
  const model = { id: 'model', connectionId: 'connection', name: '测试对话模型', modelId, capabilities: ['text'], enabled: true, pricing: { unit: 'million-tokens', currency: 'USD', input: '1', output: '2' } };
  const createProject = vi.fn();
  const read = vi.fn(async ({ conversationId }: { conversationId: string }) => record ||= { version: 1, id: conversationId, workspaceId, title: '新对话', createdAt: now(), updatedAt: now(), turnCount: 0, turns: [] });
  const start = vi.fn(async (request: ChatStartRequest) => {
    const turn: ChatTurn = { id: request.id, userText: request.text, text: '', status: 'running', createdAt: now(), updatedAt: now(), modelName: request.model.name, modelId: request.model.modelId, modelConfigId: request.model.id, credentialId: request.credentialId, reasoningEffort: request.reasoningEffort, mode: request.mode, costCents: 0, costState: 'unknown' };
    record = { ...record!, turns: [...record!.turns, turn], turnCount: record!.turns.length + 1, title: request.text.slice(0, 24) }; return structuredClone(record);
  });
  const cancel = vi.fn(async () => { record!.turns.at(-1)!.status = 'cancelled'; return structuredClone(record!); });
  const bridge = { read, start, cancel, list: vi.fn(async () => []), ledger: vi.fn(async () => []), onChanged(listener: (event: ChatChangedEvent) => void) { listeners.add(listener); return () => listeners.delete(listener); } };
  vi.stubGlobal('desktop', { chat: bridge }); Object.defineProperty(window, 'desktop', { configurable: true, value: { chat: bridge } });
  const props = { workspaceId, workspace: { id: workspaceId, name: '无项目工作区' }, workspaces: [], projects: [], purgedProjects: [], activeProject: { id: '' }, configuration: { connections: [connection], models: [model], credentials: [{ id: 'key', connectionId: 'connection', name: '自己的账户', lastFour: '1234', enabled: true }], workflows: [], categories: [] }, workflowRunner: { runs: [] }, ledger: [], preferences: {}, navigate: vi.fn(), notify: vi.fn(), onCreateProject: createProject } as unknown as PageProps;
  await act(async () => { root = createRoot(host); root.render(<WorkspaceChat props={props} onLegacy={vi.fn()} />); });
  async function update(text: string, status: ChatTurn['status'] = 'running') {
    const turn = { ...record!.turns.at(-1)!, text, status, updatedAt: `${now()}-${text.length}` };
    record = { ...record!, turns: [...record!.turns.slice(0, -1), turn] };
    await act(async () => { for (const listener of listeners) listener({ workspaceId, conversationId: record!.id, turn, updatedAt: turn.updatedAt, title: record!.title, ledgerChanged: status !== 'running' }); });
  }
  return { start, read, cancel, createProject, update, props };
}
describe('普通聊天的真实组件交互', () => {
  it('发送确认较慢时，不会清掉用户已输入的下一条草稿', async () => {
    const f = await fixture(), original = f.start.getMockImplementation()!;
    let release!: () => void;
    f.start.mockImplementation(async request => { const value = await original(request); await new Promise<void>(resolve => { release = resolve; }); return value; });
    await input('已经提交的问题'); await click('发送聊天消息'); await input('下一条正在打的内容');
    await act(async () => { release(); });
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="聊天内容"]')!.value).toBe('下一条正在打的内容'); expect(f.start).toHaveBeenCalledOnce();
  });
  it('无项目可连续聊天，流式增量不重复读取整段历史，也不创建目录', async () => {
    const f = await fixture(); await input('你好，帮我想一句产品介绍'); await click('发送聊天消息');
    expect(f.start).toHaveBeenCalledOnce(); expect(f.start.mock.calls[0][0].mode).toBe('chat'); expect(f.createProject).not.toHaveBeenCalled();
    for (const text of ['清', '清新', '清新一天']) await f.update(text);
    expect(host.textContent).toContain('清新一天'); expect(f.read).toHaveBeenCalledOnce();
    await f.update('清新一天', 'complete'); await input('再简短一点'); await click('发送聊天消息');
    expect(f.start).toHaveBeenCalledTimes(2); expect(f.createProject).not.toHaveBeenCalled();
  });
  it('停止保留部分回答；再次回答使用新请求编号且明确是重试', async () => {
    const f = await fixture(); await input('写一段介绍'); await click('发送聊天消息'); await f.update('已经写出的内容'); await click('停止回复');
    expect(f.cancel).toHaveBeenCalledOnce(); expect(host.textContent).toContain('已经写出的内容'); await click('重新回答');
    const [first, second] = f.start.mock.calls.map(call => call[0]); expect(second.id).not.toBe(first.id); expect(second.sourceTurnId).toBe(first.id); expect(f.createProject).not.toHaveBeenCalled();
  });
  it('聊天回复转制作先填入资料和制作模式，不因切换而创建项目或调用模型', async () => {
    const f = await fixture(); await input('先讨论产品海报'); await click('发送聊天消息'); await f.update('使用白底与蓝色标题', 'complete'); await click('转为制作方案');
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="聊天内容"]')!.value).toContain('使用白底与蓝色标题'); expect(host.textContent).toContain('先看方案，再决定制作');
    expect(f.start).toHaveBeenCalledOnce(); expect(f.createProject).not.toHaveBeenCalled(); await click('发送聊天消息');
    expect(f.start.mock.calls[1][0].mode).toBe('plan'); expect(f.start.mock.calls[1][0].text).toContain('先讨论产品海报'); expect(f.createProject).not.toHaveBeenCalled();
  });
  it('未知模型只提供自动，账户摘要代替单Key下拉', async () => {
    const f = await fixture('unknown-model'); const reasoning = host.querySelector<HTMLButtonElement>('[aria-label="推理强度"]')!;
    expect(reasoning.disabled).toBe(true); expect(reasoning.textContent).toContain('自动'); expect(host.querySelector('[aria-label="对话Key"]')).toBeNull(); expect(host.textContent).toContain('自己的账户');
    await input('普通问题'); await click('发送聊天消息'); expect(f.start.mock.calls[0][0].reasoningEffort).toBe('auto');
  });
  it('中文输入法确认不误发，Enter发送，Shift+Enter保留换行', async () => {
    const f = await fixture(); await input('中文内容'); const field = host.querySelector<HTMLTextAreaElement>('[aria-label="聊天内容"]')!;
    await act(async () => { field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })); field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })); });
    expect(f.start).not.toHaveBeenCalled(); await act(async () => { field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }); expect(f.start).toHaveBeenCalledOnce();
  });
});
