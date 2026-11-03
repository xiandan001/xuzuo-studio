export const RECOVERY_SAVE_ERROR = '恢复草稿未能保存，当前编辑仍在内存中。请重试，或下载恢复稿后再离开。';
export function writeRecoveryDraft(storage: Pick<Storage, 'setItem'>, key: string, serialized: string): string {
  try { storage.setItem(key, serialized); return ''; }
  catch { return RECOVERY_SAVE_ERROR; }
}
