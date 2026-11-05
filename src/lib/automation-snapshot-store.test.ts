import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AutomationSnapshot } from '../automation-types';
import { automationSnapshotStore } from './automation-snapshot-store';

const snapshot = (revision = 1, name = '示例规则'): AutomationSnapshot => ({ revision, available: true, rules: [{ id: name } as AutomationSnapshot['rules'][number]], events: [], jobs: [], decisions: [], memories: [] });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
function fixture() {
  let listener: (() => void) | undefined;
  const remove = vi.fn(() => { listener = undefined; });
  const bridge = { snapshot: vi.fn(async (_workspaceId: string) => snapshot()), onChanged: vi.fn((next: () => void) => { listener = next; return remove; }) };
  return { bridge, remove, changed: () => listener?.() };
}
afterEach(() => vi.useRealTimers());
describe('共享自动化快照订阅', () => {
  it('Header与管理页共享一次读取、一个监听和同一快照', async () => {
    const f = fixture(), header = automationSnapshotStore(f.bridge, 'one'), page = automationSnapshotStore(f.bridge, 'one');
    const releaseHeader = header.subscribe(vi.fn()), releasePage = page.subscribe(vi.fn());
    const first = header.refresh(), second = page.refresh();
    expect(first).toBe(second); await first;
    expect(f.bridge.snapshot).toHaveBeenCalledTimes(1); expect(f.bridge.onChanged).toHaveBeenCalledTimes(1); expect(header.getSnapshot()).toBe(page.getSnapshot());
    f.changed(); await header.refresh(); expect(f.bridge.snapshot).toHaveBeenCalledTimes(2);
    releaseHeader(); expect(f.remove).not.toHaveBeenCalled(); releasePage(); expect(f.remove).toHaveBeenCalledTimes(1);
  });
  it('相同桥不同工作区隔离结果但只安装一个物理事件监听', async () => {
    const f = fixture(); f.bridge.snapshot.mockImplementation(async id => snapshot(1, id));
    const a = automationSnapshotStore(f.bridge, 'a'), b = automationSnapshotStore(f.bridge, 'b');
    const releaseA = a.subscribe(vi.fn()), releaseB = b.subscribe(vi.fn());
    await Promise.all([a.refresh(), b.refresh()]); expect(a.getSnapshot().snapshot.rules[0].id).toBe('a'); expect(b.getSnapshot().snapshot.rules[0].id).toBe('b');
    expect(f.bridge.onChanged).toHaveBeenCalledTimes(1); releaseA(); releaseB();
  });
  it('读取期间变化合并成一次后续读取，不遗失较新结果', async () => {
    const f = fixture(), held = deferred<AutomationSnapshot>(); f.bridge.snapshot.mockImplementationOnce(() => held.promise).mockResolvedValue(snapshot(2));
    const store = automationSnapshotStore(f.bridge, 'one'), release = store.subscribe(vi.fn());
    const pending = store.refresh(); await Promise.resolve(); f.changed(); f.changed(); f.changed(); held.resolve(snapshot(1)); await pending; await store.refresh();
    expect(f.bridge.snapshot).toHaveBeenCalledTimes(2); expect(store.getSnapshot().snapshot.revision).toBe(2); release();
  });
  it('相同revision不替换数据对象，异常显示问题并保留已有规则', async () => {
    const f = fixture(), store = automationSnapshotStore(f.bridge, 'one'), release = store.subscribe(vi.fn()); await store.refresh(); const original = store.getSnapshot().snapshot;
    await store.refresh(); expect(store.getSnapshot().snapshot).toBe(original);
    f.bridge.snapshot.mockRejectedValueOnce(Error('读取失败')); await store.refresh(); expect(store.getSnapshot().snapshot.rules).toBe(original.rules); expect(store.getSnapshot().snapshot.issue).toBe('读取失败'); expect(store.getSnapshot().snapshot.available).toBe(false);
    await store.refresh(); expect(store.getSnapshot().snapshot.issue).toBeUndefined(); expect(store.getSnapshot().snapshot.available).toBe(true); release();
  });
  it('无消费者时停止监听，30秒后释放缓存，迟到回包不更新别的工作区', async () => {
    vi.useFakeTimers(); const f = fixture(), held = deferred<AutomationSnapshot>(); f.bridge.snapshot.mockImplementationOnce(() => held.promise);
    const a = automationSnapshotStore(f.bridge, 'a'), release = a.subscribe(vi.fn()); const read = a.refresh(); await Promise.resolve(); release();
    const b = automationSnapshotStore(f.bridge, 'b'), releaseB = b.subscribe(vi.fn()); await b.refresh(); held.resolve(snapshot(9, 'old-a')); await read;
    expect(b.getSnapshot().snapshot.rules[0].id).not.toBe('old-a'); releaseB();
    expect(automationSnapshotStore(f.bridge, 'a')).toBe(a); await vi.advanceTimersByTimeAsync(30_001); expect(automationSnapshotStore(f.bridge, 'a')).not.toBe(a);
  });
  it('旧版无事件桥只共享一个轮询，最后一个消费者离开即停止', async () => {
    vi.useFakeTimers(); const bridge = { snapshot: vi.fn(async () => snapshot()) }, store = automationSnapshotStore(bridge, 'one');
    const first = store.subscribe(vi.fn()), second = store.subscribe(vi.fn()); await store.refresh(); await vi.advanceTimersByTimeAsync(5000); expect(bridge.snapshot).toHaveBeenCalledTimes(2);
    first(); second(); await vi.advanceTimersByTimeAsync(20_000); expect(bridge.snapshot).toHaveBeenCalledTimes(2);
  });
});
