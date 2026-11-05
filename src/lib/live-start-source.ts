import type { WorkflowRun } from '../configuration-types';
import type { ArtifactMetadata, LiveStartRequest } from '../live-types';

export async function prepareLiveStartSource(input: LiveStartRequest, detail: (id: string) => Promise<WorkflowRun>, list: (projectId: string) => Promise<ArtifactMetadata[]>): Promise<LiveStartRequest> {
  if (!input.replaceWaitingReviewRunId) return input;
  const old = await detail(input.replaceWaitingReviewRunId);
  if (old.projectId !== input.project.id || old.workspaceId !== input.project.workspaceId || old.mode !== 'live') throw new Error('上一轮任务不属于当前项目或工作区，原任务未改变。');
  if (['complete', 'cancelled', 'failed', 'interrupted'].includes(old.status)) {
    const { replaceWaitingReviewRunId: _run, replaceWaitingReviewAttemptId: _attempt, refinementFork: _fork, ...next } = input;
    return next;
  }
  const step = old.snapshot.steps[old.stepIndex];
  const pending = [...old.attempts].reverse().find(attempt => attempt.stepId === step?.id && attempt.status === 'waiting-review');
  if (step?.kind === 'manual-review' && pending) return { ...input, replaceWaitingReviewAttemptId: pending.id };
  const quality = [...(old.qualityReviews || [])].reverse().find(review => review.stepId === step?.id);
  if (input.project.kind !== 'image' || !step?.qualityGate || step.role !== 'reviewer' || quality?.passed !== false) return input;
  const models = input.workflow.steps.filter(item => item.enabled && !['manual-review', 'export'].includes(item.kind));
  if (!models.length || models.some(item => item.kind !== 'image-editing')) throw new Error('当前复核未通过，请明确精修所选图片；原检查、原图与费用保留。');
  const files = await list(input.project.id);
  const source = input.attachmentIds.map(id => files.find(file => file.id === id && file.kind === 'image' && file.projectId === input.project.id && !file.trashedAt && !file.unavailable)).find(Boolean);
  if (!source) throw new Error('请选择当前项目中可用的精修原图，原检查与费用保留。');
  return { ...input, replaceWaitingReviewAttemptId: quality.attemptId, refinementFork: { reviewAttemptId: quality.attemptId, sourceArtifactId: source.id } };
}
