import { DEFAULT_WORKSPACE_ID, INITIAL_LEDGER, INITIAL_PROJECTS } from '../data';
import type { LedgerEntry, Preferences, Project, PromptTemplate, Workspace } from '../types';
import { migratePreferences } from './preferences';
import type { WorkflowRun } from '../configuration-types';

export const blocksProjectTrash = (run: Pick<WorkflowRun, 'status'>) => run.status === 'running' || run.status === 'paused';

export interface WorkspaceState {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  projects: Project[];
  ledger: LedgerEntry[];
  preferencesByWorkspace: Record<string, Preferences>;
  customPrompts: PromptTemplate[];
}
export interface LegacyState {
  projects: (Omit<Project, 'workspaceId'> & { workspaceId?: string })[];
  ledger: LedgerEntry[];
  preferences: Preferences;
}

export const visibleWorkspaces = (workspaces: Workspace[]) => workspaces.filter(workspace => !workspace.removedAt);
export function workspaceRemoveError(workspaces: Workspace[], workspaceId: string): string {
  const workspace = workspaces.find(item => item.id === workspaceId);
  if (!workspace) return '工作区不存在。';
  if (workspace.removedAt) return '此工作区已移除，可以在“已移除的工作区”中恢复。';
  if (visibleWorkspaces(workspaces).length < 2) return '至少保留一个工作区。请先新建或恢复另一个工作区，再移除此工作区。';
  return '';
}
export function removeWorkspaceState(state: WorkspaceState, workspaceId: string, removedAt = new Date().toISOString()): WorkspaceState {
  const error = workspaceRemoveError(state.workspaces, workspaceId);
  if (error) throw new Error(error);
  const workspaces = state.workspaces.map(item => item.id === workspaceId ? { ...item, removedAt } : item);
  return { ...state, workspaces, activeWorkspaceId: state.activeWorkspaceId === workspaceId ? visibleWorkspaces(workspaces)[0].id : state.activeWorkspaceId };
}
export function restoreWorkspaceState(state: WorkspaceState, workspaceId: string): WorkspaceState {
  const workspace = state.workspaces.find(item => item.id === workspaceId);
  if (!workspace) throw new Error('工作区不存在。');
  if (!workspace.removedAt) return state;
  return { ...state, workspaces: state.workspaces.map(item => {
    if (item.id !== workspaceId) return item;
    const restored = { ...item }; delete restored.removedAt; return restored;
  }) };
}

export function migrateLegacyWorkspace(legacy?: LegacyState | null): WorkspaceState {
  const preferences = migratePreferences(legacy?.preferences);
  const projects = (legacy?.projects ?? INITIAL_PROJECTS).map(project => ({ ...project, workspaceId: DEFAULT_WORKSPACE_ID }));
  return {
    workspaces: [{ id: DEFAULT_WORKSPACE_ID, name: preferences.studioName, description: '原有项目与演示记录已保留在这里。', createdAt: '2026-10-29', lastProjectId: projects[0]?.id }],
    activeWorkspaceId: DEFAULT_WORKSPACE_ID,
    projects,
    ledger: (legacy?.ledger ?? INITIAL_LEDGER).map(entry => ({ ...entry })),
    preferencesByWorkspace: { [DEFAULT_WORKSPACE_ID]: preferences },
    customPrompts: [],
  };
}

export function scopeWorkspace(projects: Project[], ledger: LedgerEntry[], workspaceId: string) {
  const scopedProjects = projects.filter(project => project.workspaceId === workspaceId);
  const projectIds = new Set(scopedProjects.map(project => project.id));
  return { projects: scopedProjects.filter(project => !project.trashedAt), trashedProjects: scopedProjects.filter(project => Boolean(project.trashedAt)), ledger: ledger.filter(entry => projectIds.has(entry.projectId)) };
}

export function projectTrashError(project: Project | undefined, workspaceId: string, busyIds: ReadonlySet<string>): string {
  if (!project || project.workspaceId !== workspaceId) return '项目不属于当前工作区。';
  if (project.trashedAt) return '项目已经在回收站中。';
  if (busyIds.has(project.id) || ['processing', 'paused'].includes(project.status)) return '请先完成或取消项目的运行、暂停任务，再移入回收站。';
  return '';
}

export function trashProjectState(projects: Project[], projectId: string, workspaceId: string, busyIds: ReadonlySet<string>, timestamp: string): Project[] {
  if (projectTrashError(projects.find(project => project.id === projectId), workspaceId, busyIds)) return projects;
  return projects.map(project => project.id === projectId ? { ...project, trashedAt: timestamp } : project);
}

export function restoreProjectState(projects: Project[], projectId: string, workspaceId: string): Project[] {
  return projects.map(project => {
    if (project.id !== projectId || project.workspaceId !== workspaceId || !project.trashedAt) return project;
    const restored = { ...project }; delete restored.trashedAt; return restored;
  });
}

export function moveProjectWorkspace(projects: Project[], projectId: string, workspaceId: string): Project[] {
  return projects.map(project => project.id === projectId ? { ...project, workspaceId, businessCategoryId: undefined } : project);
}

export function recoverInterruptedTasks(state: WorkspaceState): WorkspaceState {
  return {
    ...state,
    preferencesByWorkspace: Object.fromEntries(Object.entries(state.preferencesByWorkspace).map(([id, preferences]) => [id, migratePreferences(preferences)])),
    projects: state.projects.map(project => ['processing', 'paused'].includes(project.status) ? { ...project, status: 'draft' } : project),
    ledger: state.ledger.map(entry => entry.status === 'processing' ? { ...entry, status: 'cancelled' } : entry),
  };
}
