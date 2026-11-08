import { useCallback, useEffect, useRef, useState } from 'react';
import { registerEditorSession } from '../lib/editor-session-guard';
import { downloadFile } from '../lib/files';

interface Draft<T> { current: T; initial: T; signature: string; changed: boolean; version: number; error: string; pending?: Promise<boolean>; saveValue: (value: T) => Promise<boolean>; }
export function useBusinessDraft<T>(key: string, projectId: string, initial: T, saveValue: (value: T) => Promise<boolean>) {
  const [, render] = useState(0), alive = useRef(true), cells = useRef(new Map<string, Draft<T>>());
  let cell = cells.current.get(key);
  if (!cell) { cell = { current: initial, initial, signature: JSON.stringify(initial), changed: false, version: 0, error: '', saveValue }; cells.current.set(key, cell); }
  cell.saveValue = saveValue; cell.initial = initial;
  const active = cell, signature = JSON.stringify(initial);
  const notify = useCallback(() => { if (alive.current) render(value => value + 1); }, []);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!active.changed && !active.pending && active.signature !== signature) { active.current = active.initial; active.signature = signature; active.version++; active.error = ''; notify(); }
  }, [active, signature, active.changed, active.pending, notify]);
  const update = useCallback((next: T | ((previous: T) => T)) => {
    active.current = typeof next === 'function' ? (next as (old: T) => T)(active.current) : next;
    active.version++; active.changed = true; active.error = ''; notify();
  }, [active, notify]);
  const saveCell = useCallback((target: Draft<T>): Promise<boolean> => {
    if (target.pending) return target.pending;
    if (!target.changed) return Promise.resolve(true);
    const task = Promise.resolve().then(async () => {
      try {
        while (target.changed) {
          const version = target.version, snapshot = structuredClone(target.current), write = target.saveValue;
          if (!await write(snapshot)) throw Error('资料尚未保存，请检查标出的字段或本地目录。');
          if (version === target.version) target.changed = false;
        }
        target.error = ''; return true;
      } catch (cause) { target.error = cause instanceof Error ? cause.message : '资料尚未保存，当前输入仍保留。'; return false; }
      finally { target.pending = undefined; notify(); }
    });
    target.pending = task; notify(); return task;
  }, [notify]);
  const save = useCallback(() => saveCell(active), [active, saveCell]);
  const reset = useCallback(() => {
    if (active.pending) return false;
    active.current = structuredClone(active.initial); active.signature = JSON.stringify(active.initial); active.version++; active.changed = false; active.error = ''; notify(); return true;
  }, [active, notify]);
  useEffect(() => { if (!active.changed || active.pending || active.error) return; const timer = setTimeout(() => { void save(); }, 700); return () => clearTimeout(timer); }, [active, active.current, active.changed, active.pending, active.error, save]);
  useEffect(() => registerEditorSession({
    id: `business-form:${key}`, projectId, label: '业务资料',
    getState: () => ({ dirty: [...cells.current.values()].some(item => item.changed), pending: [...cells.current.values()].some(item => !!item.pending), persistenceError: [...cells.current.values()].find(item => item.changed && item.error)?.error }),
    save: async () => { for (const item of cells.current.values()) if (!await saveCell(item)) return false; return true; },
    exportRecovery: () => downloadFile('业务输入恢复.json', JSON.stringify({ version: 1, drafts: [...cells.current].filter(([, item]) => item.changed).map(([id, item]) => ({ key: id, value: item.current })) }, null, 2)),
  }), [key, projectId, saveCell]);
  return { value: active.current, current: active, update, dirty: active.changed, saving: !!active.pending, error: active.error, save, reset };
}
