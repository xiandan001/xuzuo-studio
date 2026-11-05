import type { ArtifactMetadata, ArtifactPreview } from '../live-types';

interface PendingPreview { promise: Promise<ArtifactPreview>; invalidated: boolean; }
export function createArtifactPreviewCache(options: { completed?: boolean; maxEntries?: number; maxBytes?: number; ttlMs?: number; now?: () => number } = {}) {
  const pending = new Map<string, Map<string, PendingPreview>>();
  const completed = new Map<string, { id: string; result: ArtifactPreview; bytes: number; expires: number }>();
  let usedBytes = 0;
  const now = options.now || Date.now, limit = options.maxEntries ?? 24, byteLimit = options.maxBytes ?? 4 * 1024 * 1024;
  const remove = (key: string) => { const value = completed.get(key); if (value) { usedBytes -= value.bytes; completed.delete(key); } };
  const metadataKey = (value?: ArtifactMetadata) => value ? JSON.stringify([value.path, value.bytes, value.createdAt, value.trashedAt, value.unavailable]) : '';
  function invalidate(id: string) {
    const entries = pending.get(id);
    if (entries) for (const entry of entries.values()) entry.invalidated = true;
    pending.delete(id);
    for (const [key, value] of completed) if (value.id === id) remove(key);
  }
  return {
    preview(scope: string, id: string, read: () => Promise<ArtifactPreview>, metadata?: ArtifactMetadata): Promise<ArtifactPreview> {
      const key = `${scope}|${metadataKey(metadata)}`, cacheKey = `${id}|${key}`, previous = pending.get(id)?.get(key);
      if (previous) return previous.promise;
      if (metadata?.trashedAt) return Promise.reject(new Error('产物当前不可预览，请恢复或重新读取文件状态。'));
      const saved = completed.get(cacheKey);
      if (saved && saved.expires > now() && !metadata?.unavailable) { completed.delete(cacheKey); completed.set(cacheKey, saved); return Promise.resolve(saved.result); }
      remove(cacheKey);
      const entries = pending.get(id) || new Map<string, PendingPreview>();
      const entry: PendingPreview = { promise: Promise.resolve({ mimeType: '' }), invalidated: false };
      entry.promise = Promise.resolve().then(read).then(result => {
        if (entry.invalidated) throw new Error('产物状态已改变，请重新预览。');
        if (options.completed && !metadata?.unavailable) {
          const bytes = (result.dataUrl?.length || 0) * 2 + (result.text?.length || 0) * 2;
          if (bytes <= byteLimit) {
            completed.set(cacheKey, { id, result, bytes, expires: now() + (options.ttlMs ?? 5000) }); usedBytes += bytes;
            while (completed.size > limit || usedBytes > byteLimit) remove(completed.keys().next().value!);
          }
        }
        return result;
      }).finally(() => {
        if (entries.get(key) === entry) entries.delete(key);
        if (!entries.size && pending.get(id) === entries) pending.delete(id);
      });
      entries.set(key, entry); pending.set(id, entries);
      return entry.promise;
    },
    invalidate,
    clear() { for (const id of pending.keys()) invalidate(id); completed.clear(); usedBytes = 0; },
  };
}
