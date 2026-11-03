import { useCallback, useRef, useState } from 'react';
import { emptyEditHistory, recordEdit, redoEdit, undoEdit } from '../lib/edit-history';

export function useEditHistory<T>() {
  const history = useRef(emptyEditHistory<T>());
  const [, render] = useState(0);
  const reset = useCallback(() => { history.current = emptyEditHistory<T>(); render(value => value + 1); }, []);
  const record = useCallback((previous: T, next: T, group?: string) => { const updated = recordEdit(history.current, previous, next, group); if (updated !== history.current) { history.current = updated; render(value => value + 1); } }, []);
  const undo = useCallback((current: T) => { const result = undoEdit(history.current, current); history.current = result.history; render(value => value + 1); return result.value; }, []);
  const redo = useCallback((current: T) => { const result = redoEdit(history.current, current); history.current = result.history; render(value => value + 1); return result.value; }, []);
  return { reset, record, undo, redo, canUndo: history.current.past.length > 0, canRedo: history.current.future.length > 0 };
}
