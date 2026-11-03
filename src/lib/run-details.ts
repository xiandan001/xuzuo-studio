import type { WorkflowRun } from '../configuration-types';

export function runDetailKey(run: WorkflowRun): string {
  return `${run.id}:${run.detailVersion ?? ''}:${run.updatedAt}:${run.status}:${run.stepIndex}:${run.hiddenAt || ''}:${run.trashedAt || ''}:${run.attempts.map(attempt => `${attempt.id},${attempt.status},${attempt.costCents},${attempt.artifacts?.map(file => file.id).join(',')}`).join(';')}`;
}
export function mergeRunSummaries(incoming: WorkflowRun[], previous: WorkflowRun[]): WorkflowRun[] {
  const known = new Map(previous.map(run => [run.id, run]));
  return incoming.map(run => { const old = known.get(run.id); return run.contentTruncated && old && !old.contentTruncated && runDetailKey(old) === runDetailKey(run) ? old : run; });
}
