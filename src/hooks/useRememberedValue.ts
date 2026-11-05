import { useCallback, useSyncExternalStore } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { readDisclosure, subscribeDisclosure, writeDisclosure } from '../lib/disclosure-state';

export function useRememberedValue<T extends boolean | string>(key: string, fallback: T): [T, Dispatch<SetStateAction<T>>] {
  const subscribe = useCallback((listener: () => void) => subscribeDisclosure(key, listener), [key]);
  const snapshot = useCallback(() => readDisclosure(key, fallback), [key, fallback]);
  const serverSnapshot = useCallback(() => fallback, [fallback]);
  const value = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const setValue: Dispatch<SetStateAction<T>> = useCallback(next => {
    const value = typeof next === 'function' ? next(readDisclosure(key, fallback)) : next;
    writeDisclosure(key, value);
  }, [key, fallback]);
  return [value, setValue];
}
