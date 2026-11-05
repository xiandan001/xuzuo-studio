import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { AutomationContext } from '../automation-types';
import { automationSnapshotStore, unavailableAutomationState } from '../lib/automation-snapshot-store';
const unavailable = () => unavailableAutomationState;
const noSubscription = () => () => undefined;
export function useAutomationCenter(workspaceId: string) {
  const bridge = typeof window === 'undefined' ? undefined : window.desktop?.automation;
  const store = useMemo(() => bridge ? automationSnapshotStore(bridge, workspaceId) : undefined, [bridge, workspaceId]);
  const state = useSyncExternalStore(store?.subscribe || noSubscription, store?.getSnapshot || unavailable, unavailable);
  const refresh = useCallback(async () => { await store?.refresh(); }, [store]);
  useEffect(() => { void refresh(); }, [refresh]);
  return { bridge, loading: state.loading, snapshot: state.snapshot, refresh };
}
export function useAutomationContext(context: AutomationContext) {
  const bridge = typeof window === 'undefined' ? undefined : window.desktop?.automation;
  const source = useRef(context); source.current = context;
  useEffect(() => {
    if (!bridge) return;
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const sync = async () => { try { await bridge.syncContext(source.current); } catch { if (!stopped) timer = setTimeout(() => { void sync(); }, 5000); } };
    void sync(); return () => { stopped = true; clearTimeout(timer); };
  }, [bridge, context.workspaceId, context.workspaces, context.projects, context.workflows, context.models, context.connections]);
}
