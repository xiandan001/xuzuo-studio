import { useEffect, useRef, useState } from 'react';
import type { ChatBridge, ChatConversation, ChatQueueManageRequest, ChatQueueRequest } from '../chat-types';

interface PendingQueue { id: string; workspaceId: string; conversationId: string; text: string; attachmentIds: string[]; }
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value);
function pendingQueue(key: string, workspaceId: string, conversationId: string): PendingQueue | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    if (value?.workspaceId === workspaceId && value.conversationId === conversationId && validId(value.id) && typeof value.text === 'string' && value.text.length <= 10000 && Array.isArray(value.attachmentIds) && value.attachmentIds.length <= 8 && value.attachmentIds.every(validId)) return value;
  } catch { /* A corrupt local receipt never starts another request. */ }
}
export function useChatQueue(workspaceId: string, conversationId: string, bridge: ChatBridge | undefined, accept: (value: ChatConversation) => void, onError: (message: string) => void) {
  const key = 'xuzuo-chat-queue-pending-v1:' + workspaceId + ':' + conversationId, scope = workspaceId + '/' + conversationId;
  const [unknown, setUnknown] = useState(() => pendingQueue(key, workspaceId, conversationId)), [busy, setBusy] = useState(false);
  const current = useRef(scope), mounted = useRef(true), flight = useRef(false), operation = useRef(0); current.current = scope;
  const pending = useRef(unknown); pending.current = unknown;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { const value = pendingQueue(key, workspaceId, conversationId); pending.current = value; setUnknown(value); operation.current++; flight.current = false; setBusy(false); }, [key, workspaceId, conversationId]);
  function clear(receipt: PendingQueue) {
    const saved = pendingQueue(key, receipt.workspaceId, receipt.conversationId);
    if (saved?.id === receipt.id) localStorage.removeItem(key);
    if (mounted.current && current.current === receipt.workspaceId + '/' + receipt.conversationId && pending.current?.id === receipt.id) { pending.current = undefined; setUnknown(undefined); }
  }
  async function enqueue(request: ChatQueueRequest) {
    if (!bridge?.enqueue || flight.current || pending.current) return false;
    const requested = scope, token = ++operation.current, receipt: PendingQueue = { id: request.id, workspaceId, conversationId, text: request.text, attachmentIds: request.attachmentIds || [] };
    try { localStorage.setItem(key, JSON.stringify(receipt)); }
    catch { onError('待发提交编号暂未保存，请保留草稿后重试；消息尚未发送。'); return false; }
    pending.current = receipt; setUnknown(receipt); flight.current = true; setBusy(true); onError('');
    try {
      const value = await bridge.enqueue(request); if (mounted.current && current.current === requested && token === operation.current && pending.current?.id === receipt.id) accept(value);
      clear(receipt); return true;
    } catch (cause) {
      try {
        const value = await bridge.read({ workspaceId, conversationId });
        if (mounted.current && current.current === requested && token === operation.current && pending.current?.id === receipt.id) accept(value);
        if (value.turns.some(turn => turn.id === receipt.id) || value.queue?.some(item => item.id === receipt.id)) { clear(receipt); return true; }
        clear(receipt);
      } catch { /* Keep the durable submission ID until a free read can confirm it. */ }
      if (mounted.current && current.current === requested && token === operation.current) onError(pending.current ? '排队结果尚未确认，请读取状态；不会自动重发。' : cause instanceof Error ? cause.message : '消息没有加入队列，原草稿仍在。');
      return false;
    } finally { if (mounted.current && current.current === requested && token === operation.current) { flight.current = false; setBusy(false); } }
  }
  async function readUnknown() {
    const receipt = pending.current;
    if (!receipt || !bridge || flight.current) return;
    const requested = scope, token = ++operation.current; flight.current = true; setBusy(true);
    try {
      const value = await bridge.read({ workspaceId, conversationId });
      if (mounted.current && current.current === requested && token === operation.current) accept(value);
      const confirmed = value.turns.some(turn => turn.id === receipt.id) || !!value.queue?.some(item => item.id === receipt.id);
      clear(receipt); if (mounted.current && current.current === requested && token === operation.current) onError(confirmed ? '' : '已确认没有这条待发或已发送消息，原草稿保留，可以重新发送。');
      return { receipt, confirmed };
    } catch (cause) { if (mounted.current && current.current === requested && token === operation.current) onError(cause instanceof Error ? cause.message : '仍无法确认提交，请保留草稿；不会自动重发。'); }
    finally { if (mounted.current && current.current === requested && token === operation.current) { flight.current = false; setBusy(false); } }
  }
  async function manage(request: Omit<ChatQueueManageRequest, 'workspaceId' | 'conversationId'>) {
    if (!bridge?.manageQueue || flight.current || pending.current) return false;
    const requested = scope, token = ++operation.current; flight.current = true; setBusy(true); onError('');
    try { const value = await bridge.manageQueue({ ...request, workspaceId, conversationId }); if (mounted.current && current.current === requested && token === operation.current) accept(value); return true; }
    catch (cause) { if (mounted.current && current.current === requested && token === operation.current) onError(cause instanceof Error ? cause.message : '待发消息未能更新，原要求仍保留。'); return false; }
    finally { if (mounted.current && current.current === requested && token === operation.current) { flight.current = false; setBusy(false); } }
  }
  return { enqueue, manage, readUnknown, unknown, busy, supported: !!bridge?.enqueue && !!bridge?.manageQueue };
}
