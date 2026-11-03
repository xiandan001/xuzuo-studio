import type { Preferences } from '../types';
import { INITIAL_PREFERENCES } from '../data';

export function migratePreferences(value?: Partial<Preferences> | null): Preferences {
  return {
    ...INITIAL_PREFERENCES,
    ...value,
    confirmGeneration: value?.confirmGenerationVersion === 1 && value.confirmGeneration === true,
    confirmGenerationVersion: 1,
  };
}
