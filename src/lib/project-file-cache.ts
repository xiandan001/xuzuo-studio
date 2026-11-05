import type { ArtifactMetadata } from '../live-types';

interface Entry { generation: number; files?: ArtifactMetadata[]; at: number; pending?: { generation: number; promise: Promise<ArtifactMetadata[]> }; }
export function createProjectFileCache(now = Date.now) {
  const entries = new Map<string, Entry>();
  function entryFor(id: string) {
    const entry = entries.get(id) || { generation: 0, at: 0 }; entries.delete(id); entries.set(id, entry);
    if (entries.size > 64) for (const [key, item] of entries) { if (!item.pending && key !== id) { entries.delete(key); break; } }
    return entry;
  }
  return {
    read(id: string, load: () => Promise<ArtifactMetadata[]>, force = false) {
      const entry = entryFor(id);
      if (entry.pending?.generation === entry.generation) return entry.pending.promise;
      if (!force && entry.files && now() - entry.at < 1500) return Promise.resolve(entry.files);
      const generation = entry.generation;
      const promise = Promise.resolve().then(load).then(files => { if (entry.generation === generation) { entry.files = files; entry.at = now(); } return files; }).finally(() => { if (entry.pending?.promise === promise) entry.pending = undefined; });
      entry.pending = { generation, promise }; return promise;
    },
    invalidate(id: string) { const entry = entries.get(id); if (entry) { entry.generation++; entry.files = undefined; entry.at = 0; } },
    clear() { for (const entry of entries.values()) entry.generation++; entries.clear(); },
  };
}
