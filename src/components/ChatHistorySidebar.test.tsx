// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatChangedEvent, ChatConversationSummary, ChatHistoryRequest, ChatManageRequest } from '../chat-types';
import { ChatHistorySidebar } from './ChatHistorySidebar';

let root: Root | undefined, host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  host = document.createElement('div'); document.body.append(host);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 10, y: 10, left: 10, top: 10, right: 310, bottom: 50, width: 300, height: 40, toJSON() {} });
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function tick(ms = 0) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function click(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === label || button.textContent?.trim() === label);
  expect(button).toBeTruthy(); await act(async () => button!.click());
}
async function input(label: string, value: string) {
  const field = host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function fixture(running = false) {
  const listeners = new Set<(event: ChatChangedEvent) => void>(), onNew = vi.fn(), onSelect = vi.fn();
  const item: ChatConversationSummary = { id: 'conversation', workspaceId: 'workspace', title: '客户海报', createdAt: '2026-11-12T00:00:00Z', updatedAt: '2026-11-12T00:00:00Z', turnCount: 2, ...(running ? { activeTurnId: 'running' } : {}) };
  const search = vi.fn(async (request: ChatHistoryRequest) => ({ items: request.scope === 'trash' && !item.trashedAt || request.scope === 'archived' ? [] : request.query ? [{ ...item, matchSnippet: '这是一段匹配正文' }] : item.trashedAt ? [] : [{ ...item }], total: 1, scanned: 1 }));
  const manage = vi.fn(async (request: ChatManageRequest) => {
    if (request.action === 'rename') item.title = request.title!;
    if (request.action === 'pin') item.pinned = true;
    if (request.action === 'trash') item.trashedAt = new Date().toISOString();
    for (const listener of listeners) listener({ workspaceId: 'workspace', conversationId: item.id, ledgerChanged: false, historyChanged: true });
    return { ...item, version: 1, turns: [] };
  });
  Object.defineProperty(window, 'desktop', { configurable: true, value: { chat: { search, manage, onChanged: (listener: (event: ChatChangedEvent) => void) => { listeners.add(listener); return () => listeners.delete(listener); } } } });
  await act(async () => { root = createRoot(host); root.render(<ChatHistorySidebar workspaceId="workspace" activeId="conversation" onNew={onNew} onSelect={onSelect} />); }); await tick();
  return { search, manage, onNew, onSelect };
}
describe('聊天记录管理侧栏', () => {
  it('搜索正文有防抖，切换范围仍为明确分页请求', async () => {
    const f = await fixture(); expect(host.textContent).toContain('客户海报'); await input('搜索聊天标题和内容', '采购报价'); await tick(100); expect(f.search).toHaveBeenCalledTimes(1); await tick(120);
    expect(f.search).toHaveBeenLastCalledWith({ workspaceId: 'workspace', query: '采购报价', scope: 'active', limit: 30 }); expect(host.textContent).toContain('匹配正文'); await click('归档'); await tick(220); expect(f.search.mock.calls.at(-1)![0].scope).toBe('archived');
  });
  it('可重命名与置顶，整理通知先到也不会吞掉移入回收站的成功反馈', async () => {
    const f = await fixture(); await click('整理聊天 客户海报'); await click('重命名'); await input('聊天新名称', '客户甲海报');
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); await tick(); expect(f.manage).toHaveBeenCalledWith(expect.objectContaining({ action: 'rename', title: '客户甲海报' }));
    await click('整理聊天 客户甲海报'); await click('置顶'); await tick(); expect(f.manage).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'pin' }));
    await click('整理聊天 客户甲海报'); await click('移入回收站'); await tick(); expect(f.manage).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'trash' })); expect(f.onNew).toHaveBeenCalledOnce(); expect(host.textContent).toContain('不撤回已发生费用');
  });
  it('正在回答时整理入口禁用，仍能查看并保留明确运行状态', async () => {
    const f = await fixture(true); expect(host.querySelector<HTMLButtonElement>('[aria-label="整理聊天 客户海报"]')!.disabled).toBe(true); expect(host.textContent).toContain('正在回复'); await act(async () => host.querySelector<HTMLButtonElement>('.chat-history-open')!.click()); expect(f.onSelect).toHaveBeenCalledWith('conversation'); expect(f.manage).not.toHaveBeenCalled();
  });
});
