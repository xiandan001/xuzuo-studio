import type { BackupImportResult, DirectoryLocations } from '../data-management-types';
import type { WorkspaceState } from './workspace-state';
import type { ConfigurationState } from './configuration';
import { readConfigurationResult } from './configuration';
import { CONFIGURATION_KEY, loadStoredConfiguration } from './configuration-storage';
import { readWorkspaceState, WORKSPACE_STORAGE_KEY } from './workspace-persistence';
import { quoteRestorationWrites } from './quote-backup';
import { mergePurgedProjectAudits } from './workspace-state';

const appendMissing = <T extends { id: string }>(current: T[], added: T[]) => [...current, ...added.filter(item => !current.some(existing => existing.id === item.id))];
function restoredWorkspaceNames(current: WorkspaceState['workspaces'], incoming: WorkspaceState['workspaces']) {
  const used = new Set(current.map(workspace => workspace.name));
  return incoming.map(workspace => {
    const existing = current.find(item => item.id === workspace.id);
    if (existing) return { ...workspace, name: existing.name };
    let name = workspace.name, round = 1;
    while (used.has(name)) { const suffix = round === 1 ? '（恢复）' : `（恢复${round}）`; name = workspace.name.slice(0, 30 - suffix.length) + suffix; round++; }
    used.add(name); return { ...workspace, name };
  });
}
export function mergeBackupImport(current: WorkspaceState, configuration: ConfigurationState, imported: BackupImportResult) {
  const meta = imported.meta;
  const workspaces = restoredWorkspaceNames(current.workspaces, meta.workspaces);
  const preferences = Object.fromEntries(Object.entries(meta.preferencesByWorkspace).map(([id, value]) => [id, { ...value, studioName: workspaces.find(workspace => workspace.id === id)?.name || value.studioName }]));
  const projectAudits = mergePurgedProjectAudits(current.projects, meta.projects);
  const state: WorkspaceState = { ...current, workspaces: appendMissing(current.workspaces, workspaces), projects: appendMissing(projectAudits, meta.projects.filter(project => !project.purgedAt).map(project => project.liveLedgerBaselineCents === undefined ? project : { ...project, liveLedgerBaselineCents: meta.ledger.filter(entry => entry.projectId === project.id && entry.billingMode === 'live').reduce((sum, entry) => sum + entry.costCents, 0) })), ledger: appendMissing(current.ledger, meta.ledger), customPrompts: appendMissing(current.customPrompts, meta.customPrompts), preferencesByWorkspace: { ...preferences, ...current.preferencesByWorkspace } };
  const settings = Object.fromEntries(Object.entries(configuration).map(([name, items]) => [name, appendMissing<{ id: string }>(items, meta.configuration[name as keyof ConfigurationState] || [])])) as unknown as ConfigurationState;
  return { state, configuration: settings };
}
export function relocatedWorkspaceState(current: WorkspaceState, locations: DirectoryLocations): WorkspaceState {
  return { ...current, workspaces: current.workspaces.map(item => { const location = locations.workspaces.find(entry => entry.workspaceId === item.id); return location ? { ...item, directory: location.directory } : item; }), projects: current.projects.map(item => { if (item.purgedAt) return item; const location = locations.projects.find(entry => entry.projectId === item.id); return location ? { ...item, directory: location.directory, workspaceId: location.workspaceId } : item; }) };
}
export function persistBackupImport(storage: Storage, current: WorkspaceState, imported: BackupImportResult) {
  const stored = readWorkspaceState(storage), configuration = loadStoredConfiguration(storage);
  if (stored.issue || configuration.issue) throw new Error('现有工作室或模型配置处于恢复状态，请先恢复读取，再保存导入登记；备份文件及恢复凭据仍保留。');
  const next = mergeBackupImport(current, configuration.state, imported), workspaceRaw = JSON.stringify(next.state), configurationRaw = JSON.stringify(next.configuration);
  if (readConfigurationResult(configurationRaw).issue || readWorkspaceState({ getItem: name => name === WORKSPACE_STORAGE_KEY ? workspaceRaw : null, setItem: () => undefined }).issue) throw new Error('导入界面索引未通过格式检查，未覆盖现有数据。');
  const beforeWorkspace = storage.getItem(WORKSPACE_STORAGE_KEY), beforeConfiguration = storage.getItem(CONFIGURATION_KEY), journal = `xuzuo-import-${imported.backupId}`;
  const existingProjects = new Set(current.projects.map(project => project.id));
  const quoteWrites = quoteRestorationWrites(imported.meta.quoteDrafts, imported.meta.projects).filter(item => !existingProjects.has(item.projectId)).map(item => ({ key: item.key, value: item.value, before: storage.getItem(item.key) }));
  if (quoteWrites.some(item => item.before !== null && item.before !== item.value)) throw new Error('恢复项目的报价记录已存在且内容不同，未覆盖。原始备份与恢复凭据保留，请先核对报价。');
  const writes = [{ key: CONFIGURATION_KEY, value: configurationRaw, before: beforeConfiguration }, { key: WORKSPACE_STORAGE_KEY, value: workspaceRaw, before: beforeWorkspace }, ...quoteWrites];
  storage.setItem(journal, JSON.stringify({ version: 1, backupId: imported.backupId, beforeWorkspace, beforeConfiguration, workspaceRaw, configurationRaw, quoteWrites }));
  try {
    for (const item of writes) {
      if (storage.getItem(item.key) !== item.before) throw new Error('另一处修改了索引或报价，请重新读取后重试。');
      if (item.before !== item.value) storage.setItem(item.key, item.value);
    }
    if (writes.some(item => storage.getItem(item.key) !== item.value)) throw new Error('导入登记写入后核验失败。');
  } catch (error) {
    for (const item of [...writes].reverse()) {
      try { if (storage.getItem(item.key) === item.value) { if (item.before === null) storage.removeItem(item.key); else storage.setItem(item.key, item.before); } } catch { /* The import journal and native receipt retain both states for a retry. */ }
    }
    throw new Error(`界面索引尚未完成保存，原始索引与恢复凭据已保留，可重新保存恢复登记。${error instanceof Error ? error.message : ''}`);
  }
  try { storage.removeItem(journal); } catch { /* A leftover journal does not repeat import or fees. */ }
  return next.state;
}
