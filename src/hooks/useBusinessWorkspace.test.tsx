// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useBusinessWorkspace } from './useBusinessWorkspace';
import { newBusinessState } from '../lib/business-data';
import { guardedEditorSessions } from '../lib/editor-session-guard';
import type { BusinessBrand, BusinessBridge, BusinessState } from '../business-types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
let api: ReturnType<typeof useBusinessWorkspace>;
const time = '2026-11-08T00:00:00Z';
const brand = (id: string): BusinessBrand => ({ id, name: id, contact: '', colors: [], font: '', voice: '', forbiddenClaims: [], approvedSampleIds: [], updatedAt: time });
function Probe({ workspaceId, bridge }: { workspaceId: string; bridge: BusinessBridge }) { api = useBusinessWorkspace(workspaceId, bridge); return <div>{api.state?.workspaceId}:{api.state?.brands.map(row => row.id).join(',')}<p>{api.error}</p></div>; }
async function mount(bridge: BusinessBridge, workspaceId = 'a') {
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<Probe workspaceId={workspaceId} bridge={bridge} />));
  return { container, render: (id: string) => act(async () => root.render(<Probe workspaceId={id} bridge={bridge} />)) };
}
function backend() {
  const states = new Map<string, BusinessState>();
  const current = (id: string) => states.get(id) || newBusinessState(id);
  const bridge = { snapshot: vi.fn(async (id: string) => structuredClone(current(id))), save: vi.fn(async (input: Parameters<BusinessBridge['save']>[0]) => { if (current(input.workspaceId).revision !== input.expectedRevision) throw Error('BUSINESS_CONFLICT'); const saved = { ...structuredClone(input.state), revision: input.expectedRevision + 1 }; states.set(input.workspaceId, saved); return saved; }), exportRecovery: vi.fn(async () => ({ saved: true })) } as unknown as BusinessBridge;
  return { bridge, states, current };
}
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); document.body.replaceChildren(); vi.restoreAllMocks(); });
describe('business workspace serialized UI commits', () => {
  it('serializes pure transformations against each freshly saved state', async () => {
    const b = backend(); await mount(b.bridge);
    await act(async () => { await Promise.all([api.commit(state => ({ ...state, brands: [...state.brands, brand('first')] })), api.commit(state => ({ ...state, brands: [...state.brands, brand('second')] }))]); });
    expect(b.current('a').brands.map(row => row.id)).toEqual(['first', 'second']); expect(api.current.current?.revision).toBe(2); expect(api.error).toBe('');
  });
  it('rereads and reapplies exactly once on a native CAS conflict, retaining another writer changes', async () => {
    const b = backend(), original = b.bridge.save;
    b.bridge.save = vi.fn().mockImplementationOnce(async () => { b.states.set('a', { ...newBusinessState('a'), revision: 1, brands: [brand('external')] }); throw Error('BUSINESS_CONFLICT'); }).mockImplementation(original);
    await mount(b.bridge);
    await act(async () => { await api.commit(state => ({ ...state, brands: [...state.brands, brand('own')] })); });
    expect(b.bridge.save).toHaveBeenCalledTimes(2); expect(b.current('a').brands.map(row => row.id)).toEqual(['external', 'own']); expect(api.error).toBe('');
  });
  it('never overwrites a new workspace with a late successful save from the old one', async () => {
    const b = backend(), reply = deferred<BusinessState>(); b.bridge.save = vi.fn(() => reply.promise);
    const ui = await mount(b.bridge); let pending!: Promise<BusinessState | undefined>;
    await act(async () => { pending = api.commit(state => ({ ...state, brands: [brand('old')] })); });
    await ui.render('b');
    await act(async () => reply.resolve({ ...newBusinessState('a'), revision: 1, brands: [brand('old')] }));
    expect(await pending).toBeUndefined(); expect(api.state?.workspaceId).toBe('b'); expect(api.current.current?.workspaceId).toBe('b'); expect(ui.container.textContent).not.toContain('old');
  });
  it('preserves the failed candidate for an explicit recovery file and blocks close until saved or exported', async () => {
    const b = backend(); b.bridge.save = vi.fn(async () => { throw Error('磁盘不可写'); }); await mount(b.bridge);
    await act(async () => { await api.commit(state => ({ ...state, brands: [brand('unsaved')] })); });
    expect(api.error).toContain('不可写'); expect(guardedEditorSessions({ includeDirty: true }).some(row => row.id === 'business-workspace')).toBe(true);
    await act(async () => { expect(await api.exportRecovery()).toBe(true); });
    expect(b.bridge.exportRecovery).toHaveBeenCalledWith(expect.objectContaining({ state: expect.objectContaining({ brands: [brand('unsaved')] }) }));
    expect(guardedEditorSessions({ includeDirty: true }).some(row => row.id === 'business-workspace')).toBe(false);
    expect(b.current('a').brands).toEqual([]);
  });
  it('does not spin on permanent conflicts or silently blank a corrupt native response', async () => {
    const b = backend(); b.bridge.save = vi.fn(async () => { throw Error('BUSINESS_CONFLICT'); }); await mount(b.bridge);
    await act(async () => { await api.commit(state => ({ ...state, brands: [brand('own')] })); });
    expect(b.bridge.save).toHaveBeenCalledTimes(2); expect(api.error).toContain('CONFLICT');
    b.bridge.snapshot = vi.fn(async () => ({ ...newBusinessState('a'), workspaceId: 'foreign' }));
    await act(async () => { await api.exportRecovery(); await api.refresh(); });
    expect(api.error).toContain('当前工作区'); expect(api.state?.workspaceId).toBe('a');
  });
  it('merges the next pure edit with an earlier failed in-memory candidate instead of dropping it', async () => {
    const b = backend(), original = b.bridge.save; b.bridge.save = vi.fn().mockImplementationOnce(async () => { throw Error('临时磁盘错误'); }).mockImplementation(original);
    await mount(b.bridge);
    await act(async () => { await api.commit(state => ({ ...state, brands: [...state.brands, brand('first')] })); });
    await act(async () => { await api.commit(state => ({ ...state, brands: [...state.brands, brand('second')] })); });
    expect(b.current('a').brands.map(row => row.id)).toEqual(['first', 'second']); expect(api.error).toBe('');
  });
  it('coalesces metadata events, sleeps while hidden and never polls an idle workspace', async () => {
    const b = backend(); let changed: Parameters<NonNullable<BusinessBridge['onChanged']>>[0] = () => {}, hidden = false;
    const ownHidden = Object.getOwnPropertyDescriptor(document, 'hidden'); Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    b.bridge.onChanged = listener => { changed = listener; return () => {}; }; vi.useFakeTimers();
    try {
      await mount(b.bridge); expect(b.bridge.snapshot).toHaveBeenCalledTimes(1);
      b.states.set('a', { ...newBusinessState('a'), revision: 2, brands: [brand('event')] });
      await act(async () => { changed({ workspaceId: 'other', revision: 10 }); changed({ workspaceId: 'a', revision: 1 }); changed({ workspaceId: 'a', revision: 2 }); await vi.advanceTimersByTimeAsync(249); });
      expect(b.bridge.snapshot).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); }); expect(b.bridge.snapshot).toHaveBeenCalledTimes(2); expect(api.state?.revision).toBe(2); expect(api.loading).toBe(false);
      hidden = true; b.states.set('a', { ...newBusinessState('a'), revision: 3 });
      await act(async () => { changed({ workspaceId: 'a', revision: 3 }); await vi.advanceTimersByTimeAsync(1000); }); expect(b.bridge.snapshot).toHaveBeenCalledTimes(2);
      hidden = false;
      await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(250); }); expect(b.bridge.snapshot).toHaveBeenCalledTimes(3); expect(api.state?.revision).toBe(3);
      await act(async () => { await vi.advanceTimersByTimeAsync(100000); }); expect(b.bridge.snapshot).toHaveBeenCalledTimes(3);
    } finally { vi.useRealTimers(); if (ownHidden) Object.defineProperty(document, 'hidden', ownHidden); else Reflect.deleteProperty(document, 'hidden'); }
  });
  it('does not let a same-workspace stale read replace an edit that completed after the read began', async () => {
    const b = backend(), old = deferred<BusinessState>(); await mount(b.bridge);
    b.bridge.snapshot = vi.fn(() => old.promise); let reading!: Promise<BusinessState | undefined>;
    await act(async () => { reading = api.refresh(); });
    await act(async () => { await api.commit(state => ({ ...state, brands: [brand('newer')] })); });
    await act(async () => old.resolve(newBusinessState('a'))); expect(await reading).toBeUndefined(); expect(api.state?.brands[0].id).toBe('newer');
  });
  it('preserves a newer failed draft when an old save returns after leaving and returning to the same workspace', async () => {
    const b = backend(), old = deferred<BusinessState>();
    b.bridge.save = vi.fn().mockImplementationOnce(() => old.promise).mockRejectedValue(Error('磁盘不可写'));
    const ui = await mount(b.bridge); let first!: Promise<BusinessState | undefined>;
    await act(async () => { first = api.commit(state => ({ ...state, brands: [brand('old')] })); });
    await ui.render('b'); await ui.render('a');
    await act(async () => { await api.commit(state => ({ ...state, brands: [brand('new-unsaved')] })); });
    await act(async () => old.resolve({ ...newBusinessState('a'), revision: 1, brands: [brand('old')] }));
    expect(await first).toBeUndefined();
    expect(guardedEditorSessions({ includeDirty: true }).some(row => row.id === 'business-workspace')).toBe(true);
    await act(async () => { await api.exportRecovery(); });
    expect(b.bridge.exportRecovery).toHaveBeenLastCalledWith(expect.objectContaining({ state: expect.objectContaining({ brands: [brand('new-unsaved')] }) }));
  });
});
