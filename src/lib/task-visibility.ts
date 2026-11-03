import type { WorkflowRun } from '../configuration-types';
export type TaskScope = 'visible' | 'hidden' | 'trash';
export const canOrganizeRun = (run: WorkflowRun) => ['interrupted', 'failed', 'cancelled', 'complete'].includes(run.status);
export function scopedTaskRuns(runs: WorkflowRun[], scope: TaskScope): WorkflowRun[] {
  return runs.filter(run => scope === 'trash' ? Boolean(run.trashedAt) : scope === 'hidden' ? Boolean(run.hiddenAt && !run.trashedAt) : !run.hiddenAt && !run.trashedAt);
}
export function updateRunVisibility(run: WorkflowRun, action: 'hide' | 'trash' | 'restore', timestamp: string): WorkflowRun {
  if (!canOrganizeRun(run)) throw new Error('请先完成或取消任务，再整理记录。');
  if (action === 'restore') return { ...run, hiddenAt: undefined, trashedAt: undefined };
  if (action === 'trash') return { ...run, hiddenAt: undefined, trashedAt: run.trashedAt || timestamp };
  if (run.trashedAt) throw new Error('请先从任务回收站恢复。');
  return { ...run, hiddenAt: run.hiddenAt || timestamp };
}
