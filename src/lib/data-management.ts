import type { BackupImportResult, DirectoryLocations } from '../data-management-types';
import type { WorkspaceState } from './workspace-state';
import type { ConfigurationState } from './configuration';
import { readConfigurationResult } from './configuration';
import { CONFIGURATION_KEY, loadStoredConfiguration } from './configuration-storage';
import { readWorkspaceState, WORKSPACE_STORAGE_KEY } from './workspace-persistence';

const appendMissing = <T extends { id: string }>(current: T[], added: T[]) => [...current, ...added.filter(item => !current.some(existing => existing.id === item.id))];
export function mergeBackupImport(current: WorkspaceState, configuration: ConfigurationState, imported: BackupImportResult) {
  const meta = imported.meta;
  const state: WorkspaceState = { ...current, workspaces: appendMissing(current.workspaces, meta.workspaces), projects: appendMissing(current.projects, meta.projects.map(project => project.liveLedgerBaselineCents === undefined ? project : { ...project, liveLedgerBaselineCents: meta.ledger.filter(entry => entry.projectId === project.id && entry.billingMode === 'live').reduce((sum, entry) => sum + entry.costCents, 0) })), ledger: appendMissing(current.ledger, meta.ledger), customPrompts: appendMissing(current.customPrompts, meta.customPrompts), preferencesByWorkspace: { ...meta.preferencesByWorkspace, ...current.preferencesByWorkspace } };
  const settings = Object.fromEntries(Object.entries(configuration).map(([name, items]) => [name, appendMissing<{ id: string }>(items, meta.configuration[name as keyof ConfigurationState] || [])])) as unknown as ConfigurationState;
  return { state, configuration: settings };
}
export function relocatedWorkspaceState(current: WorkspaceState, locations: DirectoryLocations): WorkspaceState {
  return { ...current, workspaces: current.workspaces.map(item => { const location = locations.workspaces.find(entry => entry.workspaceId === item.id); return location ? { ...item, directory: location.directory } : item; }), projects: current.projects.map(item => { const location = locations.projects.find(entry => entry.projectId === item.id); return location ? { ...item, directory: location.directory, workspaceId: location.workspaceId } : item; }) };
}
export function persistBackupImport(storage: Storage, current: WorkspaceState, imported: BackupImportResult) {
  const stored = readWorkspaceState(storage), configuration = loadStoredConfiguration(storage);
  if (stored.issue || configuration.issue) throw new Error('现有工作室或模型配置处于恢复状态，请先恢复读取，再保存导入登记；备份文件及恢复凭据仍保留。');
  const next = mergeBackupImport(current, configuration.state, imported), workspaceRaw = JSON.stringify(next.state), configurationRaw = JSON.stringify(next.configuration);
  if (readConfigurationResult(configurationRaw).issue || readWorkspaceState({ getItem: name => name === WORKSPACE_STORAGE_KEY ? workspaceRaw : null, setItem: () => undefined }).issue) throw new Error('导入界面索引未通过格式检查，未覆盖现有数据。');
  const beforeWorkspace = storage.getItem(WORKSPACE_STORAGE_KEY), beforeConfiguration = storage.getItem(CONFIGURATION_KEY), journal = `xuzuo-import-${imported.backupId}`;
  storage.setItem(journal, JSON.stringify({ version: 1, backupId: imported.backupId, beforeWorkspace, beforeConfiguration, workspaceRaw, configurationRaw }));
  try {
    if (storage.getItem(WORKSPACE_STORAGE_KEY) !== beforeWorkspace || storage.getItem(CONFIGURATION_KEY) !== beforeConfiguration) throw new Error('另一处修改了工作室索引，请重新读取后重试。');
    storage.setItem(CONFIGURATION_KEY, configurationRaw); storage.setItem(WORKSPACE_STORAGE_KEY, workspaceRaw);
    if (storage.getItem(WORKSPACE_STORAGE_KEY) !== workspaceRaw || storage.getItem(CONFIGURATION_KEY) !== configurationRaw) throw new Error('导入登记写入后核验失败。');
  } catch (error) {
    for (const [name, written, before] of [[WORKSPACE_STORAGE_KEY, workspaceRaw, beforeWorkspace], [CONFIGURATION_KEY, configurationRaw, beforeConfiguration]]) {
      try { if (storage.getItem(name!) === written) { if (before === null) storage.removeItem(name!); else storage.setItem(name!, before!); } } catch { /* The import journal and native receipt retain both states for a retry. */ }
    }
    throw new Error(`界面索引尚未完成保存，原始索引与恢复凭据已保留，可重新保存恢复登记。${error instanceof Error ? error.message : ''}`);
  }
  try { storage.removeItem(journal); } catch { /* A leftover journal does not repeat import or fees. */ }
  return next.state;
}
