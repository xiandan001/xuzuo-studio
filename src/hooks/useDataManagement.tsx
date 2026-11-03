import { DataManagement } from '../components/DataManagement';
import type { MutableRefObject } from 'react';
import type { StudioConfiguration, StorageIssue } from '../configuration-types';
import type { WorkspaceState } from '../lib/workspace-state';
import type { BackupMeta } from '../data-management-types';
import { loadStoredConfiguration } from '../lib/configuration-storage';
import { writeWorkspaceState } from '../lib/workspace-persistence';
import { persistBackupImport, relocatedWorkspaceState } from '../lib/data-management';

interface Options {
  workspaceId: string;
  state: MutableRefObject<WorkspaceState>;
  configuration: StudioConfiguration;
  storageIssue?: StorageIssue;
  applyState: (state: WorkspaceState) => void;
  notify: (message: string, type?: 'success' | 'info' | 'error') => void;
}
export function readBackupMeta(state: WorkspaceState, storage: Pick<Storage, 'getItem'>, issue?: StorageIssue): BackupMeta {
  if (issue) throw new Error(`工作室索引尚未恢复，请先处理存储问题再创建完整备份。${issue.message}`);
  const stored = loadStoredConfiguration(storage);
  if (stored.issue) throw new Error(`模型与工作流配置尚未恢复，未创建不完整备份。${stored.issue.message}`);
  return { ...state, configuration: stored.state };
}
export function useDataManagement({ workspaceId, state, configuration, storageIssue, applyState, notify }: Options) {
  return <DataManagement workspaceId={workspaceId} projects={state.current.projects} getMeta={() => readBackupMeta(state.current, localStorage, storageIssue)} exportError={storageIssue?.message || configuration.storageIssue?.message} notify={notify} onImported={result => {
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
