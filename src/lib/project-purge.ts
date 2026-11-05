import type { Project } from '../types';
import type { ProjectPurgeItem } from '../project-purge-types';
import { documentStudioFormKey } from './document-studio-state';
import { imageDraftKey } from './image-studio';
import { recoveryKey, conflictKey } from './editor-recovery';
import { projectQuoteKey } from './project-quotes';
import { quoteWorkingKey } from './quote-working-drafts';
import { purgedProjectAudit } from './workspace-state';

export function nativeProjectPurgeAudits(items: readonly ProjectPurgeItem[]): Project[] {
  return items.filter(item => item.recordPurged && item.purgedAt).map(item => purgedProjectAudit({
    id: item.projectId, workspaceId: item.workspaceId, name: item.name, kind: item.kind,
    status: 'draft', description: '', costCents: item.costCents, version: 0,
    accent: item.kind === 'ppt' ? 'orange' : item.kind === 'word' ? 'blue' : item.kind === 'excel' ? 'green' : 'purple',
    updatedAt: item.updatedAt, trashedAt: item.trashedAt, purgedAt: item.purgedAt,
  }));
}
export function clearPurgedProjectDrafts(storage: Pick<Storage, 'length' | 'key' | 'removeItem'>, project: Pick<Project, 'id' | 'workspaceId'>): boolean {
  return clearPurgedProjectsDrafts(storage, [project]);
}
export function clearPurgedProjectsDrafts(storage: Pick<Storage, 'length' | 'key' | 'removeItem'>, projects: readonly Pick<Project, 'id' | 'workspaceId'>[]): boolean {
  if (!projects.length) return true;
  const exact = new Set<string>(), recoveries = new Set<string>(), conflicts = new Set<string>();
  for (const { id, workspaceId } of projects) {
    const prefixes = [recoveryKey(id), conflictKey(id), `xuzuo.spreadsheet-recovery.${id}`, `xuzuo.spreadsheet-conflict.${id}`];
    for (const key of [`xuzuo.document.${id}`, documentStudioFormKey(id), imageDraftKey(id), `xuzuo.spreadsheet-form.${id}`, ...prefixes, projectQuoteKey(workspaceId, id), quoteWorkingKey(workspaceId, id)]) exact.add(key);
    prefixes.forEach(key => recoveries.add(key)); conflicts.add(`xuzuo.spreadsheet-conflict.${id}`);
  }
  const matches = (key: string) => {
    const invalid = key.lastIndexOf('.invalid.'), separator = key.lastIndexOf('.');
    return exact.has(key) || invalid >= 0 && recoveries.has(key.slice(0, invalid)) || conflicts.has(key.slice(0, separator)) && /^\d+$/.test(key.slice(separator + 1));
  };
  let keys: string[];
  try { keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => !!key && matches(key)); }
  catch { return false; }
  let cleared = true;
  for (const key of keys) try { storage.removeItem(key); } catch { cleared = false; }
  return cleared;
}
export function purgeResultCounts(items: readonly ProjectPurgeItem[]) {
  return { removed: items.filter(item => item.recordPurged).length, filesDeleted: items.filter(item => item.filesDeleted).length,
    pending: items.filter(item => item.recordPurged && (item.filesPending || item.retryable)).length, failed: items.filter(item => !item.recordPurged).length };
}
export function projectPurgeChunks<T>(items: readonly T[], size = 100): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}
