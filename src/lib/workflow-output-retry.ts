import type { WorkflowRun } from '../configuration-types';

export function workflowOutputRetryLimit(run: WorkflowRun): number | undefined {
  if (run.status !== 'failed' || run.referenceIssue) return;
  const step = run.snapshot?.steps[run.stepIndex];
  if (!step?.enabled || !['text', 'vision', 'video-understanding'].includes(step.kind)) return;
  const attempt = run.attempts.filter(item => item.stepId === step.id).at(-1);
  if (attempt?.status !== 'failed') return;
  const message = attempt.error || '';
  const incomplete = attempt.errorCode === 'INCOMPLETE_OUTPUT'
    || (attempt.errorCode === undefined && (message === 'INCOMPLETE_OUTPUT' || message.startsWith('模型未完整生成结果，')));
  if (!incomplete) return;
  const limit = step.maxOutputTokens || 2048;
  if (!Number.isSafeInteger(limit) || limit < 16 || limit >= 16384) return;
  const used = attempt.usage?.outputTokens;
  if (attempt.incompleteReason === 'output-limit' || (typeof used === 'number' && Number.isSafeInteger(used) && used >= limit)) {
    const increase = limit < 2048 ? limit : limit < 8192 ? 2048 : 4096;
    return Math.min(limit + increase, 16384);
  }
}
