import { useEffect, useRef, useState } from 'react';
import type { LedgerEntry } from '../types';

export function useChatLedger(workspaceId: string) {
  const [state, setState] = useState<{ workspaceId: string; entries: LedgerEntry[]; error?: string }>({ workspaceId, entries: [] });
  const refreshCurrent = useRef<() => void>(() => undefined);
  useEffect(() => {
    const bridge = window.desktop?.chat;
    if (!bridge) return;
    let disposed = false, reading = false, again = false;
    async function refresh() {
      if (reading) { again = true; return; }
      reading = true;
      try {
        const entries = await bridge!.ledger(workspaceId);
        if (!disposed) setState({ workspaceId, entries });
      } catch {
        if (!disposed) setState(previous => ({ workspaceId, entries: previous.workspaceId === workspaceId ? previous.entries : [], error: '聊天费用暂未同步，已保存的后台账本仍保留。' }));
      } finally {
        reading = false;
        if (again && !disposed) { again = false; void refresh(); }
      }
    }
    void refresh();
    refreshCurrent.current = () => { void refresh(); };
    const remove = bridge.onChanged(event => { if (event.workspaceId === workspaceId && event.ledgerChanged) void refresh(); });
    return () => { disposed = true; remove(); refreshCurrent.current = () => undefined; };
  }, [workspaceId]);
  const visible: typeof state = state.workspaceId === workspaceId ? state : { workspaceId, entries: [] };
  return { ...visible, refresh: () => refreshCurrent.current() };
}
