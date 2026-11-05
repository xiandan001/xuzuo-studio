import { useRememberedValue } from './useRememberedValue';
export const useRememberedString = (key: string, fallback: string) => useRememberedValue(key, fallback);
