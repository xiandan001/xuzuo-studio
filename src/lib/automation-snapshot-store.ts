import type { AutomationBridge, AutomationSnapshot } from '../automation-types';

type Bridge = Pick<AutomationBridge, 'snapshot' | 'onChanged'>;
export interface AutomationSnapshotState { snapshot: AutomationSnapshot; loading: boolean; }
export const emptyAutomationSnapshot = (): AutomationSnapshot => ({ revision: -1, rules: [], events: [], jobs: [], decisions: [], memories: [], available: false });
export const unavailableAutomationState: AutomationSnapshotState = { snapshot: emptyAutomationSnapshot(), loading: false };
const CACHE_TTL_MS = 30_000;
const hubs = new WeakMap<Bridge, SnapshotHub>();

class SnapshotStore {
  private state: AutomationSnapshotState = { snapshot: emptyAutomationSnapshot(), loading: false };
  private listeners = new Set<() => void>();
  private pending?: Promise<void>;
  private changedDuringRead = false;
  private expiry?: ReturnType<typeof setTimeout>;
  constructor(private hub: SnapshotHub, readonly workspaceId: string) {}
  getSnapshot = () => this.state;
  get subscribed() { return this.listeners.size > 0; }
  subscribe = (listener: () => void) => {
    clearTimeout(this.expiry); this.listeners.add(listener); this.hub.subscribe();
    return () => {
      this.listeners.delete(listener); this.hub.unsubscribe();
      if (!this.subscribed) {
        this.expiry = setTimeout(() => this.hub.expire(this), CACHE_TTL_MS);
        (this.expiry as typeof this.expiry & { unref?: () => void }).unref?.();
      }
    };
  };
  private publish(next: AutomationSnapshotState) {
    if (next.snapshot === this.state.snapshot && next.loading === this.state.loading) return;
    this.state = next; this.listeners.forEach(listener => listener());
  }
  changed() {
    if (this.pending) { this.changedDuringRead = true; return; }
    void this.refresh(true);
  }
  refresh = (background = false): Promise<void> => {
    if (this.pending) return this.pending;
    if (!background) this.publish({ ...this.state, loading: true });
    this.pending = Promise.resolve().then(() => this.hub.bridge.snapshot(this.workspaceId)).then(snapshot => {
      const previous = this.state.snapshot;
      this.publish({ snapshot: previous.revision === snapshot.revision && previous.issue === snapshot.issue && previous.available === snapshot.available ? previous : snapshot, loading: false });
    }).catch(cause => {
      const message = cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '自动化记录暂时无法读取。';
      this.publish({ snapshot: { ...this.state.snapshot, available: false, issue: message }, loading: false });
    }).finally(() => {
      this.pending = undefined;
      if (this.changedDuringRead) { this.changedDuringRead = false; if (this.subscribed) void this.refresh(true); }
    });
    return this.pending;
  };
}

class SnapshotHub {
  readonly stores = new Map<string, SnapshotStore>();
  private subscribers = 0;
  private removeChanged?: () => void;
  private timer?: ReturnType<typeof setInterval>;
  constructor(readonly bridge: Bridge) {}
  subscribe() {
    if (this.subscribers++ > 0) return;
    const changed = () => this.stores.forEach(store => { if (store.subscribed) store.changed(); });
    this.removeChanged = this.bridge.onChanged?.(changed);
    if (!this.removeChanged) this.timer = setInterval(changed, 5000);
  }
  unsubscribe() {
    if (--this.subscribers > 0) return;
    this.removeChanged?.(); this.removeChanged = undefined; clearInterval(this.timer); this.timer = undefined;
  }
  expire(store: SnapshotStore) { if (!store.subscribed && this.stores.get(store.workspaceId) === store) this.stores.delete(store.workspaceId); }
}

export function automationSnapshotStore(bridge: Bridge, workspaceId: string) {
  let hub = hubs.get(bridge);
  if (!hub) { hub = new SnapshotHub(bridge); hubs.set(bridge, hub); }
  let store = hub.stores.get(workspaceId);
  if (!store) { store = new SnapshotStore(hub, workspaceId); hub.stores.set(workspaceId, store); }
  return store;
}
