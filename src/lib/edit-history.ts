import { serializeImmutableSnapshot } from './snapshot-serialization';

export interface EditHistoryEntry<T> { value: T; weight: number; }
export interface EditHistory<T> { past: EditHistoryEntry<T>[]; future: EditHistoryEntry<T>[]; group?: string; at: number; }
export const EDIT_HISTORY_LIMIT = 60;
export const EDIT_HISTORY_MAX_CHARACTERS = 24 * 1024 * 1024;
export function emptyEditHistory<T>(): EditHistory<T> { return { past: [], future: [], at: 0 }; }
const entry = <T,>(value: T): EditHistoryEntry<T> => ({ value, weight: serializeImmutableSnapshot(value).length });
function bounded<T>(history: EditHistory<T>): EditHistory<T> {
  const past = [...history.past], future = [...history.future];
  let weight = [...past, ...future].reduce((total, item) => total + item.weight, 0);
  while (past.length + future.length > EDIT_HISTORY_LIMIT || weight > EDIT_HISTORY_MAX_CHARACTERS) {
    const removed = past.length > 1 ? past.shift() : future.length > 1 ? future.shift() : past.shift() || future.shift();
    if (!removed) break; weight -= removed.weight;
  }
  return { ...history, past, future };
}
export function recordEdit<T>(history: EditHistory<T>, previous: T, next: T, group?: string, at = Date.now()): EditHistory<T> {
  if (Object.is(previous, next) || serializeImmutableSnapshot(previous) === serializeImmutableSnapshot(next)) return history;
  const coalesce = !!group && history.group === group && at - history.at < 800 && history.past.length > 0 && history.future.length === 0;
  return bounded({ past: coalesce ? history.past : [...history.past, entry(previous)], future: [], group, at });
}
export function undoEdit<T>(history: EditHistory<T>, current: T): { history: EditHistory<T>; value?: T } {
  const previous = history.past.at(-1);
  return previous ? { value: previous.value, history: bounded({ past: history.past.slice(0, -1), future: [...history.future, entry(current)], at: 0 }) } : { history };
}
export function redoEdit<T>(history: EditHistory<T>, current: T): { history: EditHistory<T>; value?: T } {
  const next = history.future.at(-1);
  return next ? { value: next.value, history: bounded({ past: [...history.past, entry(current)], future: history.future.slice(0, -1), at: 0 }) } : { history };
}
export function isTextEditingTarget(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('input,textarea,[contenteditable="true"],[role="textbox"]');
}

