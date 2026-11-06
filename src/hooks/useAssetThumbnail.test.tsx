import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetLibraryBridge, StudioAsset } from '../asset-types';
import type { ArtifactPreview } from '../live-types';
import { assetWithAvailability, useAssetAvailability } from './useAssetAvailability';
import { useAssetThumbnail } from './useAssetThumbnail';

const hooks = vi.hoisted(() => {
  type Effect = { deps?: readonly unknown[]; cleanup?: () => void };
  const slots: unknown[] = [], effects = new Map<number, Effect>();
  let cursor = 0, changed = false, version = 0;
  let pending: { index: number; action: () => void | (() => void); deps?: readonly unknown[] }[] = [];
  return {
    reset() { version++; for (const effect of effects.values()) effect.cleanup?.(); effects.clear(); slots.length = 0; pending = []; },
    begin() { cursor = 0; changed = false; pending = []; },
    changed: () => changed,
    useState(initial: unknown) {
      const index = cursor++, ownVersion = version;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (value: unknown) => {
        if (ownVersion !== version) return;
        const next = typeof value === 'function' ? value(slots[index]) : value;
        if (!Object.is(next, slots[index])) { slots[index] = next; changed = true; }
      }];
    },
    useRef(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(action: () => void | (() => void), deps?: readonly unknown[]) {
      const index = cursor++, previous = effects.get(index);
      if (!previous || !deps || deps.length !== previous.deps?.length || deps.some((value, position) => !Object.is(value, previous.deps?.[position]))) pending.push({ index, action, deps });
    },
    commit() {
      const queued = pending; pending = [];
      for (const effect of queued) {
        effects.get(effect.index)?.cleanup?.(); const cleanup = effect.action();
        effects.set(effect.index, { deps: effect.deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined });
      }
    },
  };
});
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useState: hooks.useState, useRef: hooks.useRef, useEffect: hooks.useEffect }));

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
const cleanups: (() => void)[] = [];
const preview = (tag: string): ArtifactPreview => ({ mimeType: 'image/png', dataUrl: `data:image/png;base64,${tag}`, width: 320, height: 180, originalWidth: 1600, originalHeight: 900, thumbnail: true });
const asset = (changes: Partial<StudioAsset> = {}): StudioAsset => ({ id: 'image', workspaceId: 'workspace', name: '独立图片.png', kind: 'image', mimeType: 'image/png', bytes: 6400, favorite: false, createdAt: '2026-11-06T00:00:00Z', ...changes });

function fixture(changes: Partial<StudioAsset> = {}) {
  hooks.reset();
  const probes: ReturnType<typeof deferred<{ id: string; unavailable: boolean }[]>>[] = [];
  const thumbnails: ReturnType<typeof deferred<ArtifactPreview>>[] = [];
  const probe = vi.fn((_input: { workspaceId: string; ids: string[] }) => { const task = deferred<{ id: string; unavailable: boolean }[]>(); probes.push(task); return task.promise; });
  const thumbnail = vi.fn((_input: { workspaceId: string; id: string }) => { const task = deferred<ArtifactPreview>(); thumbnails.push(task); return task.promise; });
  const bridge = { probe, thumbnail } as unknown as AssetLibraryBridge;
  vi.stubGlobal('window', { desktop: { assets: bridge } });
  const observers: Observer[] = [];
  class Observer {
    connected = false;
    constructor(private callback: IntersectionObserverCallback) { observers.push(this); }
    observe = vi.fn((_target: Element) => { this.connected = true; });
    disconnect = vi.fn(() => { this.connected = false; });
    queued(intersecting: boolean) {
      this.callback([{ isIntersecting: intersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    emit(intersecting: boolean) {
      if (this.connected) this.queued(intersecting);
    }
  }
  vi.stubGlobal('IntersectionObserver', Observer);
  const input = { asset: asset(changes), workspaceId: 'workspace', revision: 1 };
  const element = {} as HTMLElement;
  type Result = ReturnType<typeof useAssetThumbnail<HTMLElement>> & { unavailable?: boolean; probeError: string };
  let result!: Result;
  const observations: Pick<Result, 'preview' | 'loading' | 'error'>[] = [];
  const render = () => {
    for (let pass = 0; pass < 10; pass++) {
      hooks.begin();
      const availability = useAssetAvailability(bridge, input.workspaceId, input.asset.archivedAt ? [] : [input.asset.id], input.revision);
      const current = assetWithAvailability(input.asset, availability.values);
      result = { ...useAssetThumbnail<HTMLElement>(current, input.workspaceId), unavailable: current.unavailable, probeError: availability.error };
      result.element.current = element;
      // Record before effects too: a restored item must never briefly expose
      // the hook's retained image while its fresh request is still pending.
      observations.push({ preview: result.preview, loading: result.loading, error: result.error });
      hooks.commit(); if (!hooks.changed()) return result;
    }
    throw Error('Thumbnail hooks did not settle');
  };
  const intersect = (visible = true) => { for (const observer of [...observers]) observer.emit(visible); return render(); };
  const queuedIntersection = (index: number) => { observers[index].queued(true); return render(); };
  const settle = async () => { await flush(); return render(); };
  cleanups.push(() => { for (const task of probes) task.resolve([]); for (const task of thumbnails) task.resolve(preview('Y2xlYW51cA==')); });
  render();
  return { input, probe, thumbnail, probes, thumbnails, render, intersect, queuedIntersection, settle, current: () => result, observations };
}

afterEach(async () => { hooks.reset(); for (const cleanup of cleanups.splice(0)) cleanup(); await flush(); vi.unstubAllGlobals(); });

describe('visible checked thumbnails run alongside general availability probes', () => {
  it('displays the checked thumbnail before a held probe and keeps it when probe reports available', async () => {
    const f = fixture(), checked = preview('Zmlyc3Q=');
    expect(f.probe).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'workspace', ids: ['image'] });
    expect(f.current().unavailable).toBeUndefined(); expect(f.thumbnail).not.toHaveBeenCalled();
    f.intersect();
    expect(f.thumbnail).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'workspace', id: 'image' }); expect(f.current().loading).toBe(true);
    f.thumbnails[0].resolve(checked); await f.settle();
    expect(f.current().preview).toBe(checked); expect(f.current().unavailable).toBeUndefined();
    f.probes[0].resolve([{ id: 'image', unavailable: false }]); await f.settle();
    expect(f.current().unavailable).toBe(false); expect(f.current().preview).toBe(checked); expect(f.current().loading).toBe(false);
    expect(f.thumbnail).toHaveBeenCalledTimes(1);
  });

  it.each([
    { state: 'known missing', changes: { unavailable: true } },
    { state: 'archived', changes: { archivedAt: '2026-11-06T01:00:00Z' } },
  ])('does not request a $state image', async ({ changes }) => {
    const f = fixture(changes); f.intersect(); await f.settle();
    expect(f.thumbnail).not.toHaveBeenCalled(); expect(f.current().preview).toBeUndefined();
    expect(f.current().loading).toBe(false); expect(f.current().error).toBeUndefined();
  });

  it.each(['missing', 'archived'] as const)('clears an already displayed preview on %s and waits for a fresh image after restoration', async state => {
    const f = fixture(), old = preview('b2xk'), fresh = preview('ZnJlc2g=');
    f.intersect(); f.thumbnails[0].resolve(old); await f.settle(); expect(f.current().preview).toBe(old);
    if (state === 'missing') f.probes[0].resolve([{ id: 'image', unavailable: true }]);
    else f.input.asset = { ...f.input.asset, archivedAt: '2026-11-06T01:00:00Z' };
    await f.settle(); expect(f.current().preview).toBeUndefined(); expect(f.current().loading).toBe(false); expect(f.current().error).toBeUndefined();
    f.queuedIntersection(0); expect(f.thumbnail).toHaveBeenCalledTimes(1);
    f.observations.length = 0;
    f.input.asset = { ...f.input.asset, archivedAt: undefined, unavailable: undefined }; f.input.revision++;
    f.render();
    expect(f.thumbnail).toHaveBeenCalledTimes(1); expect(f.current().preview).toBeUndefined();
    expect(f.observations.every(value => value.preview !== old)).toBe(true);
    f.intersect();
    expect(f.thumbnail).toHaveBeenCalledTimes(2); expect(f.current().preview).toBeUndefined();
    expect(f.observations.every(value => value.preview !== old)).toBe(true);
    f.thumbnails[1].resolve(fresh); await f.settle(); expect(f.current().preview).toBe(fresh);
    f.probes.at(-1)!.resolve([{ id: 'image', unavailable: false }]); await f.settle(); expect(f.thumbnail).toHaveBeenCalledTimes(2);
  });

  it('discards a pending checked reply after the general probe discovers a missing file', async () => {
    const f = fixture(); f.intersect();
    f.probes[0].resolve([{ id: 'image', unavailable: true }]); await f.settle();
    expect(f.current().unavailable).toBe(true); expect(f.current().loading).toBe(false);
    f.thumbnails[0].resolve(preview('bGF0ZQ==')); await f.settle();
    expect(f.current().preview).toBeUndefined(); expect(f.current().error).toBeUndefined(); expect(f.thumbnail).toHaveBeenCalledTimes(1);
  });

  it('does not request an offscreen image even when the availability probe has completed', async () => {
    const f = fixture(); f.intersect(false);
    f.probes[0].resolve([{ id: 'image', unavailable: false }]); await f.settle(); f.intersect(false);
    expect(f.thumbnail).not.toHaveBeenCalled(); expect(f.current().preview).toBeUndefined();
    f.intersect(); expect(f.thumbnail).toHaveBeenCalledTimes(1);
  });

  it.each(['workspace', 'asset', 'bytes'] as const)('does not reuse a late reply after changing %s identity', async identity => {
    const f = fixture(), old = preview('b2xk'), fresh = preview('bmV3'); f.intersect();
    if (identity === 'workspace') { f.input.workspaceId = 'other-workspace'; f.input.asset = { ...f.input.asset, workspaceId: 'other-workspace' }; }
    else if (identity === 'asset') f.input.asset = { ...f.input.asset, id: 'other-image' };
    else f.input.asset = { ...f.input.asset, bytes: f.input.asset.bytes + 1 };
    f.render(); f.intersect(); expect(f.thumbnail).toHaveBeenCalledTimes(2);
    expect(f.thumbnail).toHaveBeenLastCalledWith({ workspaceId: f.input.workspaceId, id: f.input.asset.id });
    f.thumbnails[0].resolve(old); f.probes[0].resolve([{ id: 'image', unavailable: false }]); await f.settle();
    expect(f.current().preview).toBeUndefined(); expect(f.current().loading).toBe(true);
    f.thumbnails[1].resolve(fresh); await f.settle(); expect(f.current().preview).toBe(fresh); expect(f.thumbnail).toHaveBeenCalledTimes(2);
  });

  it('can retry a failed checked thumbnail while the general probe is still pending', async () => {
    const f = fixture(), fresh = preview('cmV0cnk='); f.intersect();
    f.thumbnails[0].reject(Error('controlled thumbnail failure')); await f.settle();
    expect(f.current().error).toBe('缩略图未能读取'); expect(f.current().unavailable).toBeUndefined();
    f.current().retry(); f.render(); expect(f.thumbnail).toHaveBeenCalledTimes(2); expect(f.current().loading).toBe(true);
    f.thumbnails[1].resolve(fresh); await f.settle(); expect(f.current().preview).toBe(fresh); expect(f.current().error).toBeUndefined();
    f.probes[0].resolve([{ id: 'image', unavailable: false }]); await f.settle(); expect(f.thumbnail).toHaveBeenCalledTimes(2);
  });
});
