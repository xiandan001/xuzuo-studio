import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { EditorDocument } from '../editor-types';
import type { ArtifactPreview } from '../live-types';
import { createDocumentImagePreviewCache, documentPreviewIds } from '../lib/document-image-previews';

interface Options { scope: string; document: EditorDocument; selectedId: string; selectedImageId?: string; allowedIds: string[]; enabled: boolean; root: RefObject<HTMLElement | null>; read: (id: string) => Promise<ArtifactPreview>; }
/** Canvas image reads follow the viewport and share two slots, including obsolete reads. */
export function useDocumentImagePreviews(options: Options) {
  const [cache] = useState(createDocumentImagePreviewCache), [visible, setVisible] = useState<{ scope: string; ids: string[] }>({ scope: options.scope, ids: [] });
  const [snapshot, setSnapshot] = useState<{ scope: string; values: Record<string, string>; errors: Record<string, string> }>({ scope: options.scope, values: {}, errors: {} });
  const state = useRef({ scope: options.scope, generation: 0, sequence: 0, mounted: true, enabled: options.enabled, desired: [] as string[], attempted: new Set<string>(), pending: new Map<number, { id: string; generation: number }>(), errors: {} as Record<string, string> });
  const reader = useRef(options.read); reader.current = options.read;
  if (state.current.scope !== options.scope) { state.current = { ...state.current, scope: options.scope, generation: state.current.generation + 1, desired: [], attempted: new Set(), errors: {} }; cache.clear(); }
  const allowed = new Set(options.allowedIds);
  const desired = documentPreviewIds(options.document, options.selectedId, visible.scope === options.scope ? visible.ids : [], options.selectedImageId).filter(id => allowed.has(id));
  state.current.enabled = options.enabled; state.current.desired = options.enabled ? desired : [];
  const desiredKey = desired.join('|'), wordImages = options.document.kind === 'word' ? options.document.blocks.filter(block => block.imageId).map(block => `${block.id}:${block.imageId}`).join('|') : '';
  const pumpRef = useRef<() => void>(() => undefined);
  const publish = useCallback(() => {
    const active = state.current; if (!active.mounted) return;
    const values = cache.snapshot(active.desired), pendingIds = new Set([...active.pending.values()].filter(item => item.generation === active.generation).map(item => item.id));
    const errors = Object.fromEntries(active.desired.flatMap(id => active.errors[id] ? [[id, active.errors[id]]] : !cache.has(id) && active.attempted.has(id) && !pendingIds.has(id) ? [[id, '插图预览超出缓存容量，请重新读取或替换为较小图片。']] : []));
    setSnapshot(previous => previous.scope === active.scope && Object.keys(previous.values).join('|') === Object.keys(values).join('|') && Object.entries(values).every(([id, value]) => previous.values[id] === value) && JSON.stringify(previous.errors) === JSON.stringify(errors) ? previous : { scope: active.scope, values, errors });
  }, [cache]);
  const pump = useCallback(() => {
    const active = state.current; if (!active.mounted || !active.enabled) return;
    for (const id of active.desired) {
      if (active.pending.size >= 2) break;
      if (cache.has(id) || active.attempted.has(id)) continue;
      const generation = active.generation, scope = active.scope, request = ++active.sequence; active.pending.set(request, { id, generation }); active.attempted.add(id);
      void Promise.resolve().then(() => reader.current(id)).then(result => {
        const current = state.current;
        if (!current.mounted || current.scope !== scope || current.generation !== generation || !current.desired.includes(id)) return;
        if (!result.dataUrl?.startsWith('data:image/')) throw Error('图片预览不是可读取的图像。');
        if (!cache.put(id, result.dataUrl, current.desired)) throw Error('插图预览超出缓存容量，请重新读取或替换为较小图片。');
        delete current.errors[id];
      }).catch(cause => { const current = state.current; if (current.mounted && current.scope === scope && current.generation === generation && current.desired.includes(id)) current.errors[id] = cause instanceof Error ? cause.message : '插图预览暂时无法读取。'; }).finally(() => {
        const current = state.current;
        current.pending.delete(request); publish(); pumpRef.current();
      });
    }
  }, [cache, publish]);
  pumpRef.current = pump;
  useEffect(() => { const active = state.current; active.attempted = new Set([...active.pending.values()].filter(item => item.generation === active.generation).map(item => item.id)); publish(); pump(); }, [desiredKey, options.enabled, options.scope, publish, pump]);
  useEffect(() => {
    state.current.mounted = true;
    return () => { state.current.mounted = false; state.current.generation++; cache.clear(); };
  }, [cache]);
  useEffect(() => {
    if (options.document.kind !== 'word' || !options.enabled) return;
    const scope = options.scope, container = options.root.current?.querySelector<HTMLElement>('.sw-canvas-scroll');
    const nodes = Array.from(options.root.current?.querySelectorAll<HTMLElement>('[data-artifact-id]') || []), near = new Set<HTMLElement>(); let frame: number | undefined;
    const update = () => {
      frame = undefined; const box = container?.getBoundingClientRect(), center = box ? (box.top + box.bottom) / 2 : window.innerHeight / 2;
      const ids = [...new Set([...near].map(node => ({ id: node.dataset.artifactId!, distance: Math.abs((node.getBoundingClientRect().top + node.getBoundingClientRect().bottom) / 2 - center) })).sort((a, b) => a.distance - b.distance).map(item => item.id))].slice(0, 4);
      setVisible(previous => previous.scope === scope && previous.ids.join('|') === ids.join('|') ? previous : { scope, ids });
    };
    const schedule = () => { if (frame === undefined) frame = requestAnimationFrame(update); };
    if (typeof IntersectionObserver === 'undefined') { setVisible({ scope, ids: nodes.slice(0, 2).map(node => node.dataset.artifactId!) }); return; }
    const observer = new IntersectionObserver(entries => { for (const entry of entries) if (entry.isIntersecting) near.add(entry.target as HTMLElement); else near.delete(entry.target as HTMLElement); schedule(); }, { root: container, rootMargin: '300px 0px' });
    for (const node of nodes) observer.observe(node); container?.addEventListener('scroll', schedule, { passive: true });
    return () => { observer.disconnect(); container?.removeEventListener('scroll', schedule); if (frame !== undefined) cancelAnimationFrame(frame); };
  }, [options.scope, options.enabled, options.document.kind, wordImages, options.root]);
  const rememberPreview = useCallback((id: string, dataUrl: string) => { cache.put(id, dataUrl, [id, ...state.current.desired]); publish(); }, [cache, publish]);
  const retryPreviews = useCallback(() => { const active = state.current; active.attempted = new Set([...active.pending.values()].filter(item => item.generation === active.generation).map(item => item.id)); active.errors = {}; pump(); publish(); }, [pump, publish]);
  return { previews: snapshot.scope === options.scope ? snapshot.values : {}, previewErrors: snapshot.scope === options.scope ? snapshot.errors : {}, rememberPreview, retryPreviews };
}
