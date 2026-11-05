import type { EditorDocument, EditorKind } from '../editor-types';
import { normalizeWordTable } from './word-table';

export interface RecoveryDraft { document: EditorDocument; sourceArtifactIds: string[]; baseRevision: number; previousDrafts?: RecoveryDraft[]; }
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
export const recoveryKey = (projectId: string) => `xuzuo.editor-recovery.${projectId}`;
export const conflictKey = (projectId: string) => `xuzuo.editor-conflict-recovery.${projectId}`;
function validNativeTable(value: unknown): boolean {
  try { normalizeWordTable(value); return true; }
  catch { return false; }
}
function validDraft(value: unknown, kind: EditorKind): value is RecoveryDraft {
  const draft = value as RecoveryDraft | undefined;
  const items = kind === 'word' ? draft?.document.kind === 'word' ? draft.document.blocks : undefined : draft?.document.kind === 'ppt' ? draft.document.slides : undefined;
  return !!draft && draft.document.schemaVersion === 1 && draft.document.kind === kind && typeof draft.document.title === 'string' && Array.isArray(draft.sourceArtifactIds) && draft.sourceArtifactIds.every(id => typeof id === 'string') && Number.isSafeInteger(draft.baseRevision) && draft.baseRevision >= 0 && Array.isArray(items) && items.length > 0 && items.every(item => item && typeof item.id === 'string' && Number.isInteger(item.fontSize) && ['left', 'center', 'right'].includes(item.align) && ('type' in item ? typeof item.text === 'string' && ['paragraph', 'heading', 'bullet', 'image', 'table'].includes(item.type) && typeof item.bold === 'boolean' && typeof item.italic === 'boolean' && (item.type !== 'table' || item.text === '' && validNativeTable(item.table)) : typeof item.title === 'string' && typeof item.body === 'string' && typeof item.notes === 'string' && ['title-body', 'two-columns', 'image-right', 'image-full'].includes(item.layout))) && (draft.document.kind !== 'ppt' || ['paper', 'violet', 'forest', 'night'].includes(draft.document.theme));
}
export function parseEditorRecovery(raw: string | null, kind: EditorKind): RecoveryDraft | undefined {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (!validDraft(value, kind)) return undefined;
    if (value.previousDrafts !== undefined && (!Array.isArray(value.previousDrafts) || value.previousDrafts.some(item => !validDraft(item, kind) || item.previousDrafts !== undefined))) return undefined;
    return value;
  } catch { return undefined; }
}
export function readRecovery(storage: Pick<Storage, 'getItem'>, projectId: string, kind: EditorKind, key = recoveryKey(projectId)): RecoveryDraft | undefined {
  try { return parseEditorRecovery(storage.getItem(key), kind); } catch { return undefined; }
}
export function loadProtectedEditorRecovery(storage: StorageLike, projectId: string, kind: EditorKind, hasSavedSource: boolean): { draft?: RecoveryDraft; notice?: string; backupKey?: string } {
  const key = recoveryKey(projectId), raw = storage.getItem(key), draft = parseEditorRecovery(raw, kind);
  if (raw === null || draft) return { draft };
  if (!hasSavedSource) throw new Error('恢复草稿格式无效，原始内容已保留。当前没有项目保存版本，未创建空白稿覆盖它；请先恢复原草稿或切换其它项目。');
  const backupKey = `${key}.invalid.${Date.now()}-${crypto.randomUUID()}`;
  try { storage.setItem(backupKey, raw); }
  catch { throw new Error('恢复草稿格式无效，原串副本未能成功保存，原恢复内容仍保留。请检查本机存储后重试，当前未载入空白稿。'); }
  return { notice: '恢复草稿格式异常，原始副本已另行保留。已载入项目保存版本，请核对未保存内容。', backupKey };
}
export function recoveryDrafts(draft?: RecoveryDraft): RecoveryDraft[] { return draft ? [draft, ...(draft.previousDrafts || [])] : []; }
export function preserveEditorDraft(storage: StorageLike, projectId: string, draft: RecoveryDraft): RecoveryDraft {
  const key = conflictKey(projectId), raw = storage.getItem(key), previous = parseEditorRecovery(raw, draft.document.kind);
  if (raw && !previous) throw new Error('已有恢复副本暂不能读取，未替换当前文稿，请先保留并检查本机存储。');
  const identity = (item: RecoveryDraft) => JSON.stringify({ document: item.document, sourceArtifactIds: item.sourceArtifactIds, baseRevision: item.baseRevision });
  const seen = new Set([identity(draft)]), previousDrafts: RecoveryDraft[] = [];
  for (const { previousDrafts: _previous, ...item } of recoveryDrafts(previous)) { const fingerprint = identity(item); if (!seen.has(fingerprint)) { previousDrafts.push(item); seen.add(fingerprint); } }
  const result = { ...draft, previousDrafts };
  storage.setItem(key, JSON.stringify(result));
  return result;
}
