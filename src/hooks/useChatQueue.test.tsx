// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ChatBridge, ChatConversation, ChatQueueRequest } from '../chat-types';
import { useChatQueue } from './useChatQueue';

let root: Root, host: HTMLDivElement, queue: ReturnType<typeof useChatQueue>;
const accepted = vi.fn(), error = vi.fn();
const request = { id: 'queued', workspaceId: 'workspace', conversationId: 'conversation', text: '明确排队要求', credentialId: 'metadata-account', connection: { id: 'connection' }, model: { id: 'model' }, reasoningEffort: 'high', sceneName: '资料解读', attachmentIds: ['material'] } as ChatQueueRequest;
const record = (workspaceId = 'workspace', id = 'conversation', queueId = 'queued') => ({ workspaceId, id, turns: [], queue: [{ id: queueId, text: '明确排队要求' }] }) as unknown as ChatConversation;
function Probe({ bridge, workspaceId = 'workspace', conversationId = 'conversation' }: { bridge: ChatBridge; workspaceId?: string; conversationId?: string }) {
  queue = useChatQueue(workspaceId, conversationId, bridge, accepted, error);
  return <output>{JSON.stringify({ busy: queue.busy, id: queue.unknown?.id })}</output>;
}
beforeEach(() => { localStorage.clear(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); accepted.mockReset(); error.mockReset(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function show(bridge: ChatBridge, workspaceId?: string, conversationId?: string) { await act(async () => root.render(<Probe bridge={bridge} workspaceId={workspaceId} conversationId={conversationId} />)); }
it('双击只派一条排队请求，保留最小提交凭据，确认后清理，不走普通付费start', async () => {
  let release!: (value: ChatConversation) => void;
  const bridge = { enqueue: vi.fn(() => new Promise<ChatConversation>(resolve => { release = resolve; })), start: vi.fn(), read: vi.fn(), manageQueue: vi.fn() } as unknown as ChatBridge;
  await show(bridge); let pending!: Promise<boolean>;
  await act(async () => { pending = queue.enqueue(request); });
  expect(queue.busy).toBe(true); expect(bridge.enqueue).toHaveBeenCalledOnce(); expect(await queue.enqueue({ ...request, id: 'double' })).toBe(false);
  const saved = localStorage.getItem('xuzuo-chat-queue-pending-v1:workspace:conversation')!; expect(JSON.parse(saved)).toMatchObject({ id: 'queued', attachmentIds: ['material'] }); expect(saved).not.toContain('connection'); expect(saved).not.toContain('metadata-account');
  await act(async () => release(record())); expect(await pending).toBe(true); expect(queue.busy).toBe(false); expect(queue.unknown).toBeUndefined(); expect(bridge.start).not.toHaveBeenCalled(); expect(accepted).toHaveBeenCalledOnce();
});
it('丢失回包和读取失败会跨重挂保留未知ID，只免费核对，不自动再次enqueue或start', async () => {
  const bridge = { enqueue: vi.fn(async () => { throw Error('ack lost'); }), read: vi.fn(async () => { throw Error('read failed'); }), start: vi.fn(), manageQueue: vi.fn() } as unknown as ChatBridge;
  await show(bridge); await act(async () => { expect(await queue.enqueue(request)).toBe(false); }); expect(queue.unknown?.id).toBe('queued'); expect(bridge.enqueue).toHaveBeenCalledOnce();
  await act(async () => root.render(<></>)); await show(bridge); expect(queue.unknown?.id).toBe('queued'); expect(await queue.enqueue({ ...request, id: 'new' })).toBe(false);
  vi.mocked(bridge.read).mockResolvedValue(record()); await act(async () => { expect((await queue.readUnknown())?.confirmed).toBe(true); });
  expect(queue.unknown).toBeUndefined(); expect(bridge.enqueue).toHaveBeenCalledOnce(); expect(bridge.start).not.toHaveBeenCalled();
});
it('未知结果被可靠读取为不存在时只解除阻塞，保留文本供用户明确重新发送', async () => {
  const bridge = { enqueue: vi.fn(async () => { throw Error('not accepted'); }), read: vi.fn(async () => ({ ...record(), queue: [] })), start: vi.fn(), manageQueue: vi.fn() } as unknown as ChatBridge;
  await show(bridge); await act(async () => { expect(await queue.enqueue(request)).toBe(false); });
  expect(queue.unknown).toBeUndefined(); expect(bridge.enqueue).toHaveBeenCalledOnce(); expect(bridge.start).not.toHaveBeenCalled(); expect(error).toHaveBeenLastCalledWith('not accepted');
});
it('旧工作区回包不污染新会话或清理它的未知提交凭据', async () => {
  let first!: (value: ChatConversation) => void, second!: (value: ChatConversation) => void;
  const bridge = { enqueue: vi.fn((input: ChatQueueRequest) => new Promise<ChatConversation>(resolve => { if (input.workspaceId === 'workspace') first = resolve; else second = resolve; })), read: vi.fn(), manageQueue: vi.fn(), start: vi.fn() } as unknown as ChatBridge;
  await show(bridge); let old!: Promise<boolean>, fresh!: Promise<boolean>; await act(async () => { old = queue.enqueue(request); });
  await show(bridge, 'other', 'other-conversation'); expect(queue.busy).toBe(false);
  await act(async () => { fresh = queue.enqueue({ ...request, id: 'fresh', workspaceId: 'other', conversationId: 'other-conversation' }); });
  await act(async () => first(record())); await old;
  expect(queue.busy).toBe(true); expect(queue.unknown?.id).toBe('fresh'); expect(accepted).not.toHaveBeenCalled();
  await act(async () => second(record('other', 'other-conversation', 'fresh'))); expect(await fresh).toBe(true); expect(queue.busy).toBe(false); expect(accepted.mock.calls[0][0].workspaceId).toBe('other');
});
