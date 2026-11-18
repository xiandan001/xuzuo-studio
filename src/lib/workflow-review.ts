import type { WorkflowRun } from '../configuration-types';

export function workflowReviewState(run: WorkflowRun): 'manual' | 'quality-failed' | 'blocked' | undefined {
  if (run.status !== 'waiting-review') return;
  const step = run.snapshot.steps[run.stepIndex];
  if (!step?.enabled) return 'blocked';
  const attempt = run.attempts.filter(item => item.stepId === step.id).at(-1);
  if (step.kind === 'manual-review' && attempt?.status === 'waiting-review') return 'manual';
  const verdict = run.qualityReviews?.filter(review => review.stepId === step.id).at(-1);
  if (step.qualityGate && attempt?.status === 'complete' && verdict?.passed === false && verdict.attemptId === attempt.id) return 'quality-failed';
  return 'blocked';
}
