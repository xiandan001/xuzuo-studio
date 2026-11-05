import type { WorkflowRun } from '../configuration-types';
import { canOrganizeRun } from './task-visibility';
export type TaskOrganizeAction = 'hide' | 'trash' | 'restore';
export const taskCanOrganizeAs = (run: WorkflowRun, action: TaskOrganizeAction) => canOrganizeRun(run) && (action === 'restore' ? !!(run.hiddenAt || run.trashedAt) : action === 'hide' ? !run.hiddenAt && !run.trashedAt : !run.trashedAt);
export async function organizeTaskBatch({ ids, action, workspaceId, getRuns, projectIds, manage, stillCurrent = () => true }: { ids: string[]; action: TaskOrganizeAction; workspaceId: string; getRuns: () => WorkflowRun[]; projectIds: ReadonlySet<string>; manage: (id: string, action: TaskOrganizeAction) => Promise<void>; stillCurrent?: () => boolean }) {
  const failedIds: string[] = []; let done = 0;
  for (const [index, id] of [...new Set(ids)].entries()) {
    const run = getRuns().find(run => run.id === id);
    if (index >= 100 || !stillCurrent() || !run || run.workspaceId !== workspaceId || !projectIds.has(run.projectId) || !taskCanOrganizeAs(run, action)) { failedIds.push(id); continue; }
    try { await manage(id, action); done++; } catch { failedIds.push(id); }
  }
  return { done, skipped: failedIds.length, failedIds };
}
