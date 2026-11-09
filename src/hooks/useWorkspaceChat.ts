import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatConversation, ChatConversationSummary, ChatStartRequest, ChatTurn } from '../chat-types';

export function stableChatTurns(previous: ChatTurn[], next: ChatTurn[]): ChatTurn[] {
  const known = new Map(previous.map(turn => [turn.id, turn]));
  return next.map(turn => {
    const old = known.get(turn.id);
    if (!old) return turn;
    if (old.status !== 'running' && turn.status === 'running' || Date.parse(old.updatedAt) > Date.parse(turn.updatedAt) || old.status === 'running' && turn.status === 'running' && old.text.length > turn.text.length) return old;
    return old.updatedAt === turn.updatedAt && old.status === turn.status && old.text === turn.text && old.saveIssue === turn.saveIssue && old.error === turn.error && old.costState === turn.costState && old.costCents === turn.costCents && JSON.stringify(old.calculation) === JSON.stringify(turn.calculation) ? old : turn;
  });
}
export function useWorkspaceChat(workspaceId: string, conversationId: string) {
  const [conversation, setConversation] = useState<ChatConversation>();
  const [history, setHistory] = useState<ChatConversationSummary[]>([]);
  const [error, setError] = useState(''), [pending, setPending] = useState(false);
  const bridge = window.desktop?.chat, scope = `${workspaceId}/${conversationId}`;
  const current = useRef(scope), flight = useRef(false), mounted = useRef(true); current.current = scope;
  const reload = useRef<() => void>(() => undefined);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const accept = useCallback((value: ChatConversation) => {
    if (!mounted.current || current.current !== `${value.workspaceId}/${value.id}`) return;
    setConversation(previous => { const turns = stableChatTurns(previous?.id === value.id ? previous.turns : [], value.turns); return { ...value, turns, activeTurnId: turns.find(turn => turn.status === 'running')?.id }; });
  }, []);
  useEffect(() => {
    if (!bridge) return;
    let disposed = false, reading = false, again = false;
    const read = async () => {
      if (reading) { again = true; return; }
      reading = true;
      try { const value = await bridge.read({ workspaceId, conversationId }); if (!disposed) { accept(value); setError(''); } }
      catch (cause) { if (!disposed) setError(cause instanceof Error ? cause.message : '对话暂时无法读取，请保留当前窗口后重试。'); }
      finally { reading = false; if (again && !disposed) { again = false; void read(); } }
    };
    const list = () => { void bridge.list(workspaceId).then(items => { if (!disposed) setHistory(items); }).catch(() => undefined); };
    reload.current = () => { void read(); list(); };
    void read(); list();
    const remove = bridge.onChanged(event => {
      if (event.workspaceId !== workspaceId) return;
      if (event.conversationId === conversationId) {
        if (event.turn) {
          const changed = event.turn;
          setConversation(previous => {
            if (!previous || previous.workspaceId !== workspaceId || previous.id !== conversationId) return previous;
            const turns = previous.turns.some(turn => turn.id === changed.id) ? previous.turns.map(turn => turn.id === changed.id ? changed : turn) : [...previous.turns, changed];
            return { ...previous, turns, turnCount: turns.length, title: event.title || previous.title, updatedAt: event.updatedAt || changed.updatedAt, activeTurnId: turns.find(turn => turn.status === 'running')?.id };
          });
        } else void read();
      }
      if (event.ledgerChanged) list();
    });
    return () => { disposed = true; remove(); reload.current = () => undefined; };
  }, [bridge, workspaceId, conversationId, accept]);
  async function send(request: ChatStartRequest) {
    if (!bridge || flight.current) return false;
    const requested = scope; flight.current = true; setPending(true); setError('');
    try { const value = await bridge.start(request); if (current.current === requested) accept(value); return true; }
    catch (cause) { if (current.current === requested) setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '发送结果尚未确认，请先重新读取，不会自动重发。'); return false; }
    finally { flight.current = false; if (mounted.current) setPending(false); }
  }
  async function stop() {
    const turn = conversation?.turns.find(turn => turn.status === 'running');
    if (!bridge || !turn || flight.current) return;
    const requested = scope; flight.current = true; setPending(true);
    try { const value = await bridge.cancel({ workspaceId, conversationId, turnId: turn.id }); if (current.current === requested) accept(value); }
    catch (cause) { if (current.current === requested) setError(cause instanceof Error ? cause.message : '停止尚未确认，已有文字和费用保留。'); }
    finally { flight.current = false; if (mounted.current) setPending(false); }
  }
  async function flush() {
    if (!bridge || flight.current) return;
    const requested = scope; flight.current = true; setPending(true);
    try { const value = await bridge.flush({ workspaceId, conversationId }); if (current.current === requested) { accept(value); setError(''); } }
    catch (cause) { if (current.current === requested) setError(cause instanceof Error ? cause.message : '仍未保存，请复制保留回答后检查磁盘。'); }
    finally { flight.current = false; if (mounted.current) setPending(false); }
  }
  const visible = conversation?.workspaceId === workspaceId && conversation.id === conversationId ? conversation : undefined;
  return { conversation: visible, history, error, setError, pending, send, stop, flush, reload: () => reload.current(), available: !!bridge, loading: !!bridge && !visible && !error, running: visible?.turns.some(turn => turn.status === 'running') || false };
}
