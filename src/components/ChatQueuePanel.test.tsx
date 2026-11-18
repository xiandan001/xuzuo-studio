// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ChatQueueEntry } from '../chat-types';
import { ChatQueuePanel } from './ChatQueuePanel';
let root: Root, host: HTMLDivElement;
const item = { id: 'pending', text: '原先的待发要求', modelName: '用户选择的模型', modelConfigId: 'model', credentialId: 'metadata-account', reasoningEffort: 'high', mode: 'chat', sceneName: '资料解读', attachments: [], status: 'queued', createdAt: '2026-11-17T00:00:00Z', updatedAt: '2026-11-17T00:00:00Z' } as ChatQueueEntry;
beforeEach(() => { localStorage.clear(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function click(label: string) { const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(value => value.getAttribute('aria-label') === label || value.textContent?.trim() === label); expect(button).toBeTruthy(); await act(async () => button!.click()); }
it('先确认暂停这条待发才开放编辑，保存只改变正文并保留场景/模型说明', async () => {
  let paused!: (value: boolean) => void; const manage = vi.fn().mockImplementationOnce(() => new Promise<boolean>(resolve => { paused = resolve; })).mockResolvedValue(true), restore = vi.fn(), focus = vi.fn();
  await act(async () => root.render(<ChatQueuePanel scope="workspace/conversation" entries={[item]} busy={false} onManage={manage} onRestore={restore} onReturnFocus={focus} />));
  await click('编辑待发消息 pending'); expect(manage).toHaveBeenCalledWith({ id: 'pending', action: 'pause' }); expect(host.querySelector('textarea')).toBeNull();
  await act(async () => paused(true)); const field = host.querySelector('textarea')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, '只修改这一条描述'); field.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(host.textContent).toContain('资料解读'); expect(host.textContent).toContain('用户选择的模型'); await click('保存修改');
  expect(manage).toHaveBeenLastCalledWith({ id: 'pending', action: 'edit', text: '只修改这一条描述' }); expect(restore).not.toHaveBeenCalled(); expect(focus).toHaveBeenCalledOnce(); expect(host.querySelector('form')).toBeNull();
});
it('未知提交禁止继续队列，只允许保留或移出待发，不暗示已经退款', async () => {
  const manage = vi.fn(async () => true);
  await act(async () => root.render(<ChatQueuePanel scope="workspace/conversation" entries={[{ ...item, status: 'unknown', error: '提交未确认' }]} busy={false} onManage={manage} onRestore={vi.fn()} onReturnFocus={vi.fn()} />));
  expect(host.textContent).not.toContain('继续队列'); expect(host.textContent).toContain('提交未确认'); expect(host.textContent).not.toContain('尚未产生调用费用');
  await click('撤回待发消息 pending'); expect(manage).toHaveBeenCalledWith({ id: 'pending', action: 'withdraw' });
});
it('备份草稿缺账户时提供带回输入框，列表展开选择跨重挂保持', async () => {
  const restore = vi.fn(), manage = vi.fn(async () => true), entries = [0, 1, 2].map(n => ({ ...item, id: 'copy-' + n, needsAccount: true, credentialId: undefined, status: 'paused' as const }));
  const view = () => <ChatQueuePanel scope="workspace/conversation" entries={entries} busy={false} onManage={manage} onRestore={restore} onReturnFocus={vi.fn()} />;
  await act(async () => root.render(view())); expect(host.querySelectorAll('[data-queue-id]')).toHaveLength(2); await click('查看全部待发要求'); expect(host.querySelectorAll('[data-queue-id]')).toHaveLength(3);
  await act(async () => root.render(<></>)); await act(async () => root.render(view())); expect(host.querySelectorAll('[data-queue-id]')).toHaveLength(3);
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(value => value.textContent === '带回输入框')!; await act(async () => button.click()); expect(restore).toHaveBeenCalledWith(entries[0]); expect(manage).not.toHaveBeenCalled();
});
