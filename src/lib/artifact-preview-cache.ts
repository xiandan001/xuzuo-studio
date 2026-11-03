import type { ArtifactMetadata, ArtifactPreview } from '../live-types';

interface PendingPreview { promise: Promise<ArtifactPreview>; invalidated: boolean; }
export function createArtifactPreviewCache() {
  const pending = new Map<string, Map<string, PendingPreview>>();
  const metadataKey = (value?: ArtifactMetadata) => value ? JSON.stringify([value.path, value.bytes, value.createdAt, value.trashedAt, value.unavailable]) : '';
  function invalidate(id: string) {
    const entries = pending.get(id);
    if (entries) for (const entry of entries.values()) entry.invalidated = true;
    pending.delete(id);
  }
  return {
    preview(scope: string, id: string, read: () => Promise<ArtifactPreview>, metadata?: ArtifactMetadata): Promise<ArtifactPreview> {
      const key = `${scope}|${metadataKey(metadata)}`, previous = pending.get(id)?.get(key);
      if (previous) return previous.promise;
      if (metadata?.trashedAt) return Promise.reject(new Error('产物当前不可预览，请恢复或重新读取文件状态。'));
      const entries = pending.get(id) || new Map<string, PendingPreview>();
      const entry: PendingPreview = { promise: Promise.resolve({ mimeType: '' }), invalidated: false };
      entry.promise = Promise.resolve().then(read).then(result => {
        if (entry.invalidated) throw new Error('产物状态已改变，请重新预览。');
        return result;
      }).finally(() => {
        if (entries.get(key) === entry) entries.delete(key);
        if (!entries.size && pending.get(id) === entries) pending.delete(id);
      });
      entries.set(key, entry); pending.set(id, entries);
      return entry.promise;
    },
    invalidate,
    clear() { for (const id of pending.keys()) invalidate(id); },
  };
}
