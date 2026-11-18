import { DataManagement } from '../components/DataManagement';
import { useEffect, type MutableRefObject } from 'react';
import type { StudioConfiguration, StorageIssue } from '../configuration-types';
import type { WorkspaceState } from '../lib/workspace-state';
import type { BackupMeta, BackupSelection, DataManagementBridge } from '../data-management-types';
import { collectQuoteBackups } from '../lib/quote-backup';
import { loadStoredConfiguration } from '../lib/configuration-storage';
import { readWorkspaceState, WORKSPACE_STORAGE_KEY, writeWorkspaceState } from '../lib/workspace-persistence';
import { persistBackupImport, relocatedWorkspaceState } from '../lib/data-management';
import { BACKUP_SOURCE_SAVED_EVENT } from '../lib/backup-change-events';

interface Options {
  workspaceId: string;
  state: MutableRefObject<WorkspaceState>;
  configuration: StudioConfiguration;
  storageIssue?: StorageIssue;
  applyState: (state: WorkspaceState) => void;
  notify: (message: string, type?: 'success' | 'info' | 'error') => void;
}
export function readBackupMeta(state: WorkspaceState, storage: Pick<Storage, 'getItem'>, issue?: StorageIssue, selection?: BackupSelection): BackupMeta {
  if (issue) throw new Error(`工作室索引尚未恢复，请先处理存储问题再创建完整备份。${issue.message}`);
  const stored = loadStoredConfiguration(storage);
  if (stored.issue) throw new Error(`模型与工作流配置尚未恢复，未创建不完整备份。${stored.issue.message}`);
  const projects = state.projects.filter(project => !project.purgedAt && (!selection || selection.workspaceIds.includes(project.workspaceId) && (!selection.projectIds || selection.projectIds.includes(project.id))));
  const quoteDrafts = collectQuoteBackups(storage, projects);
  return { ...state, configuration: stored.state, ...(quoteDrafts.length ? { quoteDrafts } : {}) };
}
export function readPersistedBackupMeta(storage: Pick<Storage, 'getItem'>, workspaceId: string, issue?: StorageIssue): BackupMeta {
  if (issue) throw Error('本机索引尚未成功保存，自动备份已等待恢复：' + issue.message);
  const stored = readWorkspaceState(storage);
  if (stored.issue || stored.raw === null) throw Error(stored.issue?.message || '工作区索引尚未保存，准备好后再自动备份。');
  const state = stored.originalKey === WORKSPACE_STORAGE_KEY ? JSON.parse(stored.raw) as WorkspaceState : stored.state;
  if (!state.workspaces.some(item => item.id === workspaceId && !item.removedAt)) throw Error('该工作区已移除或尚未保存，未创建不完整备份。');
  return readBackupMeta(state, storage, undefined, { workspaceIds: [workspaceId] });
}
export function useDataManagement({ workspaceId, state, configuration, storageIssue, applyState, notify }: Options) {
  const persistedState = state.current;
  useEffect(() => {
    const bridge = window.desktop?.dataManagement as DataManagementBridge | undefined;
    if (!bridge?.syncBackupMeta || !bridge.backupStatus) return;
    let active = true, timer: ReturnType<typeof setTimeout> | undefined, syncing = false, all = false;
    const pending = new Set<string>();
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => { void sync(); }, 1000); };
    function schedule(id?: string) {
      if (!active) return; if (id) pending.add(id); else all = true;
      arm();
    }
    async function sync() {
      if (!active) return;
      if (syncing) { arm(); return; } syncing = true;
      const requested = new Set(pending), entire = all; pending.clear(); all = false;
      try {
        if (entire) { const status = await bridge!.backupStatus!({ workspaceId }); for (const id of status.enabledWorkspaceIds || (status.enabled ? [workspaceId] : [])) requested.add(id); }
        for (const id of requested) {
          if (!active) break;
          const status = await bridge!.backupStatus!({ workspaceId: id }); if (!active || !status.enabled) continue;
          let meta: BackupMeta;
          try { meta = readPersistedBackupMeta(localStorage, id, storageIssue || configuration.storageIssue); }
          catch (cause) { if (active) await bridge!.syncBackupMeta!({ workspaceId: id, issue: cause instanceof Error ? cause.message : '工作区索引尚不能可靠读取。' }); continue; }
          if (active) await bridge!.syncBackupMeta!({ workspaceId: id, meta });
        }
      } catch { /* The inline backup panel reports backend availability; never replace persisted source data. */ }
      finally { syncing = false; if (active && (pending.size || all)) arm(); }
    }
    const saved = (event: Event) => schedule((event as CustomEvent<{ workspaceId?: string }>).detail?.workspaceId);
    const remove = bridge.onBackupChanged?.(event => schedule(event.workspaceId));
    window.addEventListener(BACKUP_SOURCE_SAVED_EVENT, saved); window.addEventListener('storage', saved); schedule();
    return () => { active = false; clearTimeout(timer); remove?.(); window.removeEventListener(BACKUP_SOURCE_SAVED_EVENT, saved); window.removeEventListener('storage', saved); };
  }, [workspaceId, persistedState.workspaces, persistedState.projects, persistedState.ledger, persistedState.preferencesByWorkspace, persistedState.customPrompts, storageIssue, configuration.storageIssue, configuration.connections, configuration.models, configuration.workflows, configuration.categories, configuration.studioActions, configuration.useTemplates]);
  return <DataManagement workspaceId={workspaceId} projects={state.current.projects} getMeta={selection => readBackupMeta(state.current, localStorage, storageIssue, selection)} getSavedMeta={() => readPersistedBackupMeta(localStorage, workspaceId, storageIssue || configuration.storageIssue)} exportError={storageIssue?.message || configuration.storageIssue?.message} notify={notify} onImported={result => {
    if (storageIssue?.kind === 'read') throw new Error('工作室索引尚未恢复读取，导入文件及恢复凭据已保留。');
    const next = persistBackupImport(localStorage, state.current, result);
    if (!configuration.reloadStorage()) throw new Error('模型配置尚未重新读取，恢复凭据仍保留，请重试恢复登记。');
    applyState(next);
  }} onRelocated={locations => {
    const next = relocatedWorkspaceState(state.current, locations), issue = writeWorkspaceState(() => localStorage, next, storageIssue);
    if (issue) throw new Error(`本地目录已经切换，界面路径尚未保存，请重试重新连接。${issue.message}`);
    applyState(next);
  }} />;
}
