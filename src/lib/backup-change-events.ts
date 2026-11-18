export const BACKUP_SOURCE_SAVED_EVENT = 'xuzuo-backup-source-saved-v1';
export function notifyBackupSourceSaved(workspaceId?: string) {
  try {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function' || typeof CustomEvent === 'undefined') return;
    window.dispatchEvent(new CustomEvent(BACKUP_SOURCE_SAVED_EVENT, { detail: workspaceId ? { workspaceId } : {} }));
  } catch { /* A successful local save must not depend on optional backup listeners. */ }
}
