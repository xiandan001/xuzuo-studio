type DisclosureValue = boolean | string;
const prefix = 'xuzuo-disclosure-v1:';
const values = new Map<string, DisclosureValue>();
const listeners = new Map<string, Set<() => void>>();
const notify = (key: string) => { for (const listener of [...(listeners.get(key) || [])]) listener(); };

export function readDisclosure<T extends DisclosureValue>(key: string, fallback: T): T {
  if (values.has(key)) { const value = values.get(key); return typeof value === typeof fallback ? value as T : fallback; }
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(prefix + key);
    if (raw) { const stored = JSON.parse(raw); if (stored?.version === 1 && typeof stored.value === typeof fallback) return stored.value; }
  } catch { /* A display preference must not interrupt editing. */ }
  return fallback;
}

export function writeDisclosure(key: string, value: DisclosureValue): void {
  values.set(key, value);
  try { localStorage.setItem(prefix + key, JSON.stringify({ version: 1, value })); values.delete(key); } catch { /* Keep this session usable if local preference storage is unavailable. */ }
  notify(key);
}

function storageChanged(event: StorageEvent) {
  try { if (event.storageArea && event.storageArea !== localStorage) return; } catch { return; }
  if (event.key === null) { values.clear(); for (const key of listeners.keys()) notify(key); }
  else if (event.key.startsWith(prefix)) { const key = event.key.slice(prefix.length); values.delete(key); notify(key); }
}

export function subscribeDisclosure(key: string, listener: () => void): () => void {
  if (!listeners.size && typeof window !== 'undefined') window.addEventListener('storage', storageChanged);
  const group = listeners.get(key) || new Set<() => void>(); group.add(listener); listeners.set(key, group);
  return () => {
    group.delete(listener); if (!group.size) listeners.delete(key);
    if (!listeners.size && typeof window !== 'undefined') window.removeEventListener('storage', storageChanged);
  };
}
