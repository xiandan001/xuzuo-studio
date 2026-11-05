import type { EditorDocument } from '../editor-types';

export function documentPreviewIds(document: EditorDocument, selectedId: string, visibleIds: string[], selectedImageId?: string): string[] {
  const current = document.kind === 'ppt' ? document.slides.find(slide => slide.id === selectedId) || document.slides[0] : undefined;
  const referenced = document.kind === 'word' ? new Set(document.blocks.map(block => block.imageId)) : undefined;
  const candidates = document.kind === 'ppt' ? [current?.imageId, selectedImageId] : [selectedImageId, ...visibleIds.filter(id => referenced?.has(id))];
  return [...new Set(candidates.filter((id): id is string => !!id))].slice(0, 4);
}
export function createDocumentImagePreviewCache(options: { maxEntries?: number; maxBytes?: number } = {}) {
  const entries = new Map<string, { dataUrl: string; bytes: number }>(), maxEntries = options.maxEntries ?? 8, maxBytes = options.maxBytes ?? 16 * 1024 * 1024;
  let bytes = 0;
  function remove(id: string) { const item = entries.get(id); if (item) { bytes -= item.bytes; entries.delete(id); } }
  return {
    has: (id: string) => entries.has(id),
    put(id: string, dataUrl: string, preferred: string[]) {
      const size = dataUrl.length * 2;
      if (size > maxBytes) return false;
      remove(id);
      entries.set(id, { dataUrl, bytes: size }); bytes += size;
      while (entries.size > maxEntries || bytes > maxBytes) {
        const candidate = [...entries.keys()].find(key => !preferred.includes(key)) || [...entries.keys()].find(key => key !== preferred[0]) || entries.keys().next().value!;
        remove(candidate);
      }
      return entries.has(id);
    },
    snapshot(ids: string[]) { return Object.fromEntries(ids.flatMap(id => { const item = entries.get(id); if (!item) return []; entries.delete(id); entries.set(id, item); return [[id, item.dataUrl]]; })); },
    clear() { entries.clear(); bytes = 0; },
    stats: () => ({ entries: entries.size, bytes }),
  };
}
