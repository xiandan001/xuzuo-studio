import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnimationDocument, AnimationFrame } from '../../animation-types';

type Source = Pick<AnimationFrame, 'atlasArtifactId' | 'cell' | 'grid' | 'crop'>;
interface Change { before: Source; after: Source; }
interface Scope { past: Change[]; future: Change[]; }
const source = (frame: AnimationFrame): Source => ({ atlasArtifactId: frame.atlasArtifactId, cell: [...frame.cell], grid: [...frame.grid], ...(frame.crop ? { crop: [...frame.crop] } : {}) });
const fingerprint = (value: Source) => JSON.stringify([value.atlasArtifactId, value.cell, value.grid, value.crop ?? null]);
const scopeKey = (entryId: string, frameId: string) => JSON.stringify([entryId, frameId]);
const findFrame = (document: AnimationDocument, entryId: string, frameId: string) => document.entries.find(entry => entry.id === entryId)?.frames.find(frame => frame.id === frameId);

export function useAnimationFrameHistory(projectId: string) {
  const state = useRef({ projectId, active: true, scopes: new Map<string, Scope>() });
  const [, render] = useState(0);
  if (state.current.projectId !== projectId) state.current = { projectId, active: true, scopes: new Map() };
  useEffect(() => { const current = state.current; current.active = true; return () => { current.active = false; current.scopes.clear(); }; }, [projectId]);
  const clear = useCallback(() => { if (state.current.projectId !== projectId || !state.current.active || !state.current.scopes.size) return; state.current.scopes.clear(); render(value => value + 1); }, [projectId]);
  const record = useCallback((before: AnimationDocument, after: AnimationDocument) => {
    const current = state.current;
    if (!current.active || current.projectId !== projectId || before.projectId !== projectId || after.projectId !== projectId || before.entries === after.entries) return;
    const previousEntries = new Map(before.entries.map(entry => [entry.id, entry])); let changed = false;
    for (const entry of after.entries) {
      const previousEntry = previousEntries.get(entry.id); if (previousEntry?.frames === entry.frames) continue;
      const frames = new Map(previousEntry?.frames.map(frame => [frame.id, frame]) || []);
      for (const frame of entry.frames) {
        const previous = frames.get(frame.id); if (!previous) continue;
        const oldSource = source(previous), newSource = source(frame), oldHash = fingerprint(oldSource), newHash = fingerprint(newSource);
        if (oldHash === newHash) continue;
        const key = scopeKey(entry.id, frame.id), scope = current.scopes.get(key) || { past: [], future: [] }, latest = scope.past.at(-1);
        if (latest && fingerprint(latest.before) === oldHash && fingerprint(latest.after) === newHash) continue;
        if (latest && fingerprint(latest.after) !== oldHash) scope.past = [];
        scope.past.push({ before: oldSource, after: newSource }); scope.past = scope.past.slice(-24); scope.future = [];
        current.scopes.delete(key); current.scopes.set(key, scope); if (current.scopes.size > 64) current.scopes.delete(current.scopes.keys().next().value!); changed = true;
      }
    }
    if (changed) render(value => value + 1);
  }, [projectId]);
  const canMove = useCallback((document: AnimationDocument, entryId: string, frameId: string, redo: boolean) => {
    const current = state.current;
    if (!current.active || current.projectId !== projectId || document.projectId !== projectId) return false;
    const frame = findFrame(document, entryId, frameId), scope = current.scopes.get(scopeKey(entryId, frameId)), change = (redo ? scope?.future : scope?.past)?.at(-1);
    return !!frame && !!change && fingerprint(frame) === fingerprint(redo ? change.before : change.after);
  }, [projectId]);
  const move = useCallback((document: AnimationDocument, entryId: string, frameId: string, redo: boolean): AnimationDocument | undefined => {
    if (!canMove(document, entryId, frameId, redo)) return;
    const key = scopeKey(entryId, frameId), current = state.current, scope = current.scopes.get(key)!, from = redo ? scope.future : scope.past, to = redo ? scope.past : scope.future, change = from.at(-1)!;
    const target = redo ? change.after : change.before;
    const result: AnimationDocument = { ...document, entries: document.entries.map(entry => entry.id !== entryId ? entry : { ...entry, status: 'stale', frames: entry.frames.map(frame => { if (frame.id !== frameId) return frame; const next = { ...frame, ...source({ ...frame, ...target }) }; if (!target.crop) delete next.crop; return next; }) }) };
    from.pop(); to.push(change); current.scopes.delete(key); current.scopes.set(key, scope); render(value => value + 1); return result;
  }, [canMove]);
  const undo = useCallback((document: AnimationDocument, entryId: string, frameId: string) => move(document, entryId, frameId, false), [move]);
  const redo = useCallback((document: AnimationDocument, entryId: string, frameId: string) => move(document, entryId, frameId, true), [move]);
  const canUndo = useCallback((document: AnimationDocument, entryId: string, frameId: string) => canMove(document, entryId, frameId, false), [canMove]);
  const canRedo = useCallback((document: AnimationDocument, entryId: string, frameId: string) => canMove(document, entryId, frameId, true), [canMove]);
  return { record, undo, redo, canUndo, canRedo, clear };
}
