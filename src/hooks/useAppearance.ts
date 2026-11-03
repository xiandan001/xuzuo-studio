import { useSyncExternalStore } from 'react';
import { appearanceSnapshot, serverAppearanceSnapshot, setAppearanceMode, setAppearancePalette, setInterfaceLayout, subscribeAppearance } from '../lib/appearance';
export function useAppearance() { return { ...useSyncExternalStore(subscribeAppearance, appearanceSnapshot, serverAppearanceSnapshot), setMode: setAppearanceMode, setPalette: setAppearancePalette, setLayout: setInterfaceLayout }; }
