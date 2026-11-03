import type { StorageIssue } from '../configuration-types';
import { INITIAL_PREFERENCES } from '../data';
import { migrateLegacyWorkspace, recoverInterruptedTasks, visibleWorkspaces } from './workspace-state';
import type { LegacyState, WorkspaceState } from './workspace-state';

export const WORKSPACE_STORAGE_KEY = 'xuzuo-ui-prototype-v2';
const LEGACY_KEY = 'xuzuo-ui-prototype-v1';
type Store = Pick<Storage, 'getItem' | 'setItem'>;
type StoreSource = Store | (() => Store);
export interface WorkspaceRead { state: WorkspaceState; issue?: StorageIssue; originalKey: string; raw: string | null; }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const strings = (value: Record<string, unknown>, fields: string[]) => fields.every(field => typeof value[field] === 'string');
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
const project = (value: unknown) => object(value) && strings(value, ['id', 'name', 'description', 'status', 'updatedAt', 'accent']) && finite(value.costCents) && finite(value.version) && ['word', 'ppt', 'excel', 'image'].includes(String(value.kind)) && (value.referenceFiles === undefined || Array.isArray(value.referenceFiles) && value.referenceFiles.length <= 16 && value.referenceFiles.every(file => object(file) && strings(file, ['id', 'name', 'mimeType', 'kind']) && finite(file.bytes)));
const entry = (value: unknown) => object(value) && strings(value, ['id', 'projectId', 'projectName', 'action', 'model', 'time', 'status']) && finite(value.costCents);
const preference = (value: unknown) => object(value) && (value.studioName === undefined || typeof value.studioName === 'string') && ['hourlyRate', 'channelFeePercent', 'targetProfit', 'monthlyBudget'].every(field => value[field] == null || finite(value[field]));
const prompt = (value: unknown) => object(value) && strings(value, ['id', 'name', 'description', 'content', 'category', 'mode', 'updatedAt']);
function normalize(state: WorkspaceState): WorkspaceState {
  const recovered = recoverInterruptedTasks(state);
  return { ...recovered, projects: recovered.projects.map(item => item.budgetCents === null ? { ...item, budgetCents: undefined } : item), preferencesByWorkspace: Object.fromEntries(Object.entries(recovered.preferencesByWorkspace).map(([id, preference]) => [id, preference.monthlyBudget === null ? { ...preference, monthlyBudget: undefined } : preference])) };
}
export function emptyWorkspaceState(): WorkspaceState {
  const id = `workspace-${crypto.randomUUID()}`;
  return { workspaces: [{ id, name: '我的个人工作室', description: '', createdAt: new Date().toISOString() }], activeWorkspaceId: id, projects: [], ledger: [], preferencesByWorkspace: { [id]: { ...INITIAL_PREFERENCES } }, customPrompts: [] };
}
export function readWorkspaceState(source: StoreSource): WorkspaceRead {
  let raw: string | null = null, originalKey = WORKSPACE_STORAGE_KEY;
  try {
    const storage = typeof source === 'function' ? source() : source;
    raw = storage.getItem(originalKey);
    if (raw !== null) {
      const value = JSON.parse(raw) as WorkspaceState;
      if (!object(value) || !Array.isArray(value.workspaces) || !value.workspaces.length || !value.workspaces.every(item => object(item) && strings(item, ['id', 'name']) && (item.description === undefined || typeof item.description === 'string')) || !Array.isArray(value.projects) || !value.projects.every(project) || !Array.isArray(value.ledger) || !value.ledger.every(entry) || !object(value.preferencesByWorkspace) || !Object.values(value.preferencesByWorkspace).every(preference) || value.customPrompts != null && (!Array.isArray(value.customPrompts) || !value.customPrompts.every(prompt))) throw new Error('工作室数据结构未通过检查。');
      if (value.workspaces.some(item => item.removedAt !== undefined && (typeof item.removedAt !== 'string' || !Number.isFinite(Date.parse(item.removedAt))))) throw new Error('工作区移除状态未通过检查。');
      const visible = visibleWorkspaces(value.workspaces);
      if (!visible.length) throw new Error('缺少可用工作区，原索引已保留。');
      const state = { ...value, activeWorkspaceId: visible.some(item => item.id === value.activeWorkspaceId) ? value.activeWorkspaceId : visible[0].id, customPrompts: value.customPrompts || [] };
      return { state: normalize(state), originalKey, raw };
    }
    originalKey = LEGACY_KEY; raw = storage.getItem(originalKey);
    if (raw !== null) {
      const value = JSON.parse(raw) as LegacyState;
      if (!object(value) || !Array.isArray(value.projects) || !value.projects.every(project) || !Array.isArray(value.ledger) || !value.ledger.every(entry) || !preference(value.preferences)) throw new Error('旧版工作室数据结构未通过检查。');
      return { state: normalize(migrateLegacyWorkspace(value)), originalKey, raw };
    }
    return { state: emptyWorkspaceState(), originalKey: WORKSPACE_STORAGE_KEY, raw: null };
  } catch {
    return { state: emptyWorkspaceState(), originalKey, raw, issue: { kind: 'read', message: '工作室数据暂时无法读取，已暂停自动写入，原始内容没有被替换。', canExportOriginal: raw !== null } };
  }
}
export function writeWorkspaceState(source: StoreSource, state: WorkspaceState, issue?: StorageIssue): StorageIssue | undefined {
  if (issue?.kind === 'read') return issue;
  try { (typeof source === 'function' ? source() : source).setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(state)); return undefined; }
  catch { return { kind: 'write', message: '工作室数据未能保存。当前内存中的内容仍保留，请先导出，再检查本机存储空间或权限。', canExportOriginal: true }; }
}
export function resetWorkspaceState(source: StoreSource, loaded: WorkspaceRead, currentDraft?: WorkspaceState): { ok: boolean; issue?: StorageIssue } {
  try {
    const storage = typeof source === 'function' ? source() : source;
    const originalKey = loaded.issue?.kind === 'read' ? loaded.originalKey : WORKSPACE_STORAGE_KEY;
    const original = storage.getItem(originalKey);
    if (loaded.issue?.kind === 'read' && original !== loaded.raw) return { ok: false, issue: { ...loaded.issue, message: '数据已被其他窗口更新，请先重新读取；尚未重置任何内容。' } };
    if (original === null && loaded.issue?.kind === 'read' && loaded.raw === null) throw new Error('原数据无法读取。');
    const backup = { version: 1, originalKey, raw: original ?? loaded.raw, ...(currentDraft ? { currentDraft } : {}) };
    storage.setItem(`${WORKSPACE_STORAGE_KEY}.recovery.${Date.now()}-${crypto.randomUUID()}`, JSON.stringify(backup));
    if (storage.getItem(originalKey) !== original) throw new Error('数据已在其他窗口更新。');
    storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(emptyWorkspaceState()));
    return { ok: true };
  } catch { return { ok: false, issue: { kind: loaded.issue?.kind || 'write', message: '备份或重置未完成，原始内容仍保留，尚未建立新的工作室。请先导出数据并检查存储空间。', canExportOriginal: loaded.raw !== null || !!currentDraft } }; }
}
