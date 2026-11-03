import { useCallback, useRef, useState } from 'react';
import { applyScopedText, emptyScopedTextHistory, inspectScopedText, recordScopedText } from '../lib/scoped-text-history';
import type { ScopedTextDirection } from '../lib/scoped-text-history';

export function useScopedTextHistory() {
  const state = useRef(emptyScopedTextHistory());
  const [version, setVersion] = useState(0);
  const record = useCallback((fieldKey: string, before: string, after: string) => { const next = recordScopedText(state.current, fieldKey, before, after); if (next !== state.current) { state.current = next; setVersion(value => value + 1); } }, []);
  const inspect = useCallback((direction: ScopedTextDirection, fieldKey: string, current: string, start: number, end: number) => inspectScopedText(state.current, direction, fieldKey, current, start, end), []);
  const preview = useCallback((direction: ScopedTextDirection, fieldKey: string, current: string, start: number, end: number) => applyScopedText(state.current, direction, fieldKey, current, start, end).result, []);
  const apply = useCallback((direction: ScopedTextDirection, fieldKey: string, current: string, start: number, end: number) => { const applied = applyScopedText(state.current, direction, fieldKey, current, start, end); if (applied.history !== state.current) { state.current = applied.history; setVersion(value => value + 1); } return applied.result; }, []);
  const reset = useCallback(() => { state.current = emptyScopedTextHistory(); setVersion(value => value + 1); }, []);
  const undo = useCallback((fieldKey: string, current: string, start: number, end: number) => apply('undo', fieldKey, current, start, end), [apply]);
  const redo = useCallback((fieldKey: string, current: string, start: number, end: number) => apply('redo', fieldKey, current, start, end), [apply]);
  return { version, record, inspect, preview, reset, undo, redo };
}
