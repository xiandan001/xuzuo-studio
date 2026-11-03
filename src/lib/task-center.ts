import type { WorkflowRun } from '../configuration-types';
import type { Project } from '../types';
import { scopedTaskRuns } from './task-visibility';
import type { TaskScope } from './task-visibility';

export type TaskGroup = 'attention' | 'running' | 'finished';
export function taskGroup(run: Pick<WorkflowRun, 'status'>): TaskGroup {
  return run.status === 'running' ? 'running' : ['paused', 'waiting-review', 'failed', 'interrupted'].includes(run.status) ? 'attention' : 'finished';
}
export function taskStatusLabel(run: Pick<WorkflowRun, 'status' | 'supersededByRunId'>): string {
  return run.status === 'cancelled' && run.supersededByRunId ? '已由后续创作替代' : ({ running: '执行中', paused: '已暂停', 'waiting-review': '等待检查', complete: '执行完成', cancelled: '已取消', interrupted: '已中断', failed: '执行失败' })[run.status];
}
export function taskNextAction(run: Pick<WorkflowRun, 'status'>): 'project' | 'detail' {
  return run.status === 'complete' || run.status === 'waiting-review' ? 'project' : 'detail';
}
export function filterTaskRuns(runs: WorkflowRun[], projects: Pick<Project, 'id' | 'name'>[], filter: { scope: TaskScope; group: TaskGroup | 'all'; projectId: string; query: string }): WorkflowRun[] {
  const names = new Map(projects.map(project => [project.id, project.name]));
  const query = filter.query.trim().toLocaleLowerCase();
  return scopedTaskRuns(runs, filter.scope).filter(run => (filter.group === 'all' || taskGroup(run) === filter.group) && (filter.projectId === 'all' || run.projectId === filter.projectId) && `${names.get(run.projectId) || ''} ${run.workflowName} ${run.error || ''}`.toLocaleLowerCase().includes(query)).sort((left, right) => {
    const groupOrder = { attention: 0, running: 1, finished: 2 };
    return groupOrder[taskGroup(left)] - groupOrder[taskGroup(right)] || (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0);
  });
}
