export type AppearanceMode = 'light' | 'dark' | 'system';
export type AppearancePalette = 'violet' | 'blue' | 'warm';
export type InterfaceLayout = 'simple' | 'professional';
export interface AppearanceState { mode: AppearanceMode; resolved: 'light' | 'dark'; palette: AppearancePalette; layout: InterfaceLayout; }
export const APPEARANCE_KEY = 'xuzuo-appearance-v1';
const serverState: AppearanceState = { mode: 'system', resolved: 'light', palette: 'violet', layout: 'simple' };
let state: AppearanceState = serverState;
let initialized = false;
const listeners = new Set<() => void>();
export function readAppearanceMode(raw: string | null): AppearanceMode {
  try { const value = JSON.parse(raw || 'null'); return value?.version === 1 && ['light', 'dark', 'system'].includes(value.mode) ? value.mode : 'system'; }
  catch { return 'system'; }
}
export const resolveAppearance = (mode: AppearanceMode, systemDark: boolean): 'light' | 'dark' => mode === 'system' ? systemDark ? 'dark' : 'light' : mode;
export function readAppearancePalette(raw: string | null): AppearancePalette {
  try { const value = JSON.parse(raw || 'null'); return value?.version === 1 && ['violet', 'blue', 'warm'].includes(value.palette) ? value.palette : 'violet'; }
  catch { return 'violet'; }
}
export function readInterfaceLayout(raw: string | null): InterfaceLayout {
  try { const value = JSON.parse(raw || 'null'); return value?.version === 1 && value.layout === 'professional' ? 'professional' : 'simple'; }
  catch { return 'simple'; }
}
function apply(mode: AppearanceMode, palette = state.palette, layout = state.layout) {
  const resolved = resolveAppearance(mode, window.matchMedia?.('(prefers-color-scheme: dark)').matches || false);
  const changed = state.mode !== mode || state.resolved !== resolved || state.palette !== palette || state.layout !== layout;
  state = { mode, resolved, palette, layout };
  document.documentElement.dataset.appTheme = resolved;
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.dataset.appPalette = palette;
  document.documentElement.dataset.appLayout = layout;
  document.documentElement.style.colorScheme = resolved;
  if (changed) for (const listener of listeners) listener();
  return state;
}
export function initializeAppearance(): AppearanceState {
  if (typeof window === 'undefined') return serverState;
  if (!initialized) { let raw: string | null = null; try { raw = localStorage.getItem(APPEARANCE_KEY); } catch { /* The system theme remains usable when persistence is unavailable. */ } initialized = true; apply(readAppearanceMode(raw), readAppearancePalette(raw), readInterfaceLayout(raw)); }
  return state;
}
export const appearanceSnapshot = () => initializeAppearance();
export const serverAppearanceSnapshot = () => serverState;
export function setAppearanceMode(mode: AppearanceMode): boolean {
  if (!['light', 'dark', 'system'].includes(mode)) return false;
  initialized = true; apply(mode);
  try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ version: 1, mode, palette: state.palette, layout: state.layout })); return true; } catch { return false; }
}
export function setAppearancePalette(palette: AppearancePalette): boolean {
  if (!['violet', 'blue', 'warm'].includes(palette)) return false;
  initializeAppearance(); apply(state.mode, palette);
  try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ version: 1, mode: state.mode, palette, layout: state.layout })); return true; } catch { return false; }
}
export function setInterfaceLayout(layout: InterfaceLayout): boolean {
  if (!['simple', 'professional'].includes(layout)) return false;
  initializeAppearance(); apply(state.mode, state.palette, layout);
  try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ version: 1, mode: state.mode, palette: state.palette, layout })); return true; } catch { return false; }
}
export function subscribeAppearance(listener: () => void): () => void {
  initializeAppearance(); listeners.add(listener);
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  const systemChange = () => { if (state.mode === 'system') apply('system'); };
  const storageChange = (event: StorageEvent) => { if (event.key === APPEARANCE_KEY) apply(readAppearanceMode(event.newValue), readAppearancePalette(event.newValue), readInterfaceLayout(event.newValue)); };
  media?.addEventListener('change', systemChange); window.addEventListener('storage', storageChange);
  return () => { listeners.delete(listener); media?.removeEventListener('change', systemChange); window.removeEventListener('storage', storageChange); };
}
