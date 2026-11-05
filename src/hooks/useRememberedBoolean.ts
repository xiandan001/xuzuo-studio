import { useRememberedValue } from './useRememberedValue';
export const useRememberedBoolean = (key: string, fallback: boolean) => useRememberedValue(key, fallback);
