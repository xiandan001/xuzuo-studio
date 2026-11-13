import type { StorageIssue } from '../configuration-types';
import type { Preferences } from '../types';
import type { WorkspaceState } from './workspace-state';
import { migratePreferences } from './preferences';
import { settingsPreferenceError } from './settings-preferences';
import { writeWorkspaceState } from './workspace-persistence';

type SaveResult = { ok: true; state: WorkspaceState } | { ok: false; message: string; issue?: StorageIssue };
export function saveWorkspacePreferences(source: Parameters<typeof writeWorkspaceState>[0], state: WorkspaceState, workspaceId: string, changes: Partial<Preferences>, previousIssue?: StorageIssue): SaveResult {
  if (previousIssue?.kind === 'read') return { ok: false, message: previousIssue.message, issue: previousIssue };
  const workspace = state.workspaces.find(item => item.id === workspaceId && !item.removedAt);
  if (!workspace || state.activeWorkspaceId !== workspaceId) return { ok: false, message: '工作区已经切换，请在当前工作区重新保存设置。' };
  const preferences = { ...migratePreferences(state.preferencesByWorkspace[workspaceId]), studioName: workspace.name, ...changes };
  const error = settingsPreferenceError(preferences); if (error) return { ok: false, message: error };
  preferences.studioName = preferences.studioName.trim();
  const next = { ...state, workspaces: state.workspaces.map(item => item.id === workspaceId ? { ...item, name: preferences.studioName } : item), preferencesByWorkspace: { ...state.preferencesByWorkspace, [workspaceId]: preferences } };
  const issue = writeWorkspaceState(source, next, previousIssue);
  return issue ? { ok: false, message: issue.message, issue } : { ok: true, state: next };
}
