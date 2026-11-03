import { STATUS_LABEL } from '../data';
import type { WorkflowRun } from '../configuration-types';
import type { Project } from '../types';
import { explicitTimestamp } from './studio-time';

export function liveProjectStateSignature(run: WorkflowRun): string {
  return `${run.id}:${run.status}:${run.stepIndex}:${run.attempts.length}`;
}
export function selectProjectStatusRun(project: Project, latest?: WorkflowRun, active?: WorkflowRun): WorkflowRun | undefined {
  if (latest?.status === 'complete' && active?.status === 'waiting-review' && project.confirmedDelivery?.runStateSignature === liveProjectStateSignature(latest)) {
    const activeTime = explicitTimestamp(active.updatedAt), latestTime = explicitTimestamp(latest.updatedAt);
    if (activeTime !== undefined && latestTime !== undefined && activeTime <= latestTime) return latest;
  }
  return active || latest;
}
export function liveProjectStatus(project: Project, run: WorkflowRun): Project['status'] {
  if (['complete', 'waiting-review'].includes(run.status) && project.confirmedDelivery?.runStateSignature === liveProjectStateSignature(run)) return 'complete';
  return run.status === 'running' ? 'processing' : run.status === 'paused' ? 'paused' : ['waiting-review', 'complete'].includes(run.status) ? 'review' : 'draft';
}
export function projectCardStatusLabel(project: Project, runs: WorkflowRun[] = []): string {
  if (project.status !== 'review') return STATUS_LABEL[project.status];
  const mimeTypes = { word: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ppt: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  const generated = runs.some(run => run.mode === 'live' && run.projectId === project.id && run.attempts.some(attempt => attempt.status === 'complete' && attempt.artifacts?.some(artifact => {
    if (artifact.projectId && artifact.projectId !== project.id || artifact.trashedAt || artifact.unavailable || artifact.bytes <= 0) return false;
    return project.kind === 'image' ? artifact.kind === 'image' && /^image\//.test(artifact.mimeType) : artifact.kind === 'office' && artifact.mimeType === mimeTypes[project.kind];
  })));
  return generated ? '已生成' : STATUS_LABEL.review;
}
