import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { readProjectBrowserState, saveProjectBrowserState } from '../lib/project-browser-state';
import type { ProjectBrowserState } from '../lib/project-browser-state';

export function useProjectBrowserState(workspaceId: string, fallbackCollection: ProjectBrowserState['collection']) {
  const initial = useMemo(() => readProjectBrowserState(localStorage, workspaceId, fallbackCollection), [workspaceId]);
  const [stored, setStored] = useState(initial), state = stored.workspaceId === workspaceId ? stored : initial;
  const current = useRef(state);
  current.current = { ...state, scrollTop: current.current.workspaceId === state.workspaceId ? current.current.scrollTop : state.scrollTop };
  const snapshots = useRef(new Map<string, ProjectBrowserState>()); snapshots.current.set(workspaceId, current.current);
  const root = useRef<HTMLDivElement>(null);
  const save = (value: ProjectBrowserState) => { try { saveProjectBrowserState(localStorage, value); } catch { /* View preferences must not interrupt editing. */ } };
  useLayoutEffect(() => {
    setStored(initial);
    const host = root.current?.closest<HTMLElement>('.app-content'); if (!host) return;
    let frame = 0, secondFrame = 0, timer: ReturnType<typeof setTimeout> | undefined, restoring = true;
    frame = requestAnimationFrame(() => { secondFrame = requestAnimationFrame(() => { host.scrollTo({ top: initial.scrollTop, behavior: 'instant' }); restoring = false; }); });
    const capture = () => { if (restoring || current.current.workspaceId !== workspaceId) return; current.current = { ...current.current, scrollTop: host.scrollTop }; snapshots.current.set(workspaceId, current.current); if (timer) clearTimeout(timer); timer = setTimeout(() => save(current.current), 180); };
    host.addEventListener('scroll', capture, { passive: true });
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(secondFrame); if (timer) clearTimeout(timer); host.removeEventListener('scroll', capture); const snapshot = snapshots.current.get(workspaceId); if (snapshot) save(snapshot); };
  }, [workspaceId, initial]);
  useLayoutEffect(() => { const timer = setTimeout(() => save(current.current), 180); return () => { clearTimeout(timer); save(current.current); }; }, [state]);
  function setField<K extends keyof ProjectBrowserState>(field: K, value: ProjectBrowserState[K]) {
    const base = current.current.workspaceId === workspaceId ? current.current : initial;
    if (base[field] === value) return;
    const filters = ['query', 'collection', 'kind', 'status', 'businessCategory'].includes(field);
    const next = { ...base, [field]: value, ...(filters ? { page: 0, scrollTop: 0 } : field === 'page' ? { scrollTop: 0 } : {}) };
    current.current = next; snapshots.current.set(workspaceId, next); setStored(next);
    if (filters || field === 'page') root.current?.closest<HTMLElement>('.app-content')?.scrollTo({ top: 0, behavior: 'instant' });
  }
  return { state, setField, root };
}
