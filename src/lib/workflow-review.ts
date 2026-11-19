import type { WorkflowRun } from '../configuration-types';
import { isRedPacketCoverWorkflow } from './wechat-red-packet-cover';

export function hasLegacyCoverAspectReview(run: WorkflowRun) {
  if (workflowReviewState(run) !== 'quality-failed' || !isRedPacketCoverWorkflow(run.snapshot, run.projectId)) return false;
  const verdict = run.qualityReviews?.filter(item => item.stepId === run.snapshot.steps[run.stepIndex].id).at(-1);
  return /9\s*[:：/]\s*16|1080\s*[×xX✕*]\s*1920/.test([run.error, verdict?.summary, ...(verdict?.issues || [])].join('\n'));
}

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

export function recoverableQualityAttempt(run: WorkflowRun) {
  if (run.status !== 'waiting-review' || run.mode !== 'live' || run.supersededByRunId) return;
  const step = run.snapshot.steps[run.stepIndex];
  if (!step?.enabled || step.role !== 'reviewer' || !step.qualityGate || !['vision', 'text'].includes(step.kind)) return;
  const attempt = run.attempts.filter(item => item.stepId === step.id).at(-1);
  if (attempt?.status !== 'complete') return;
  const verdict = run.qualityReviews?.filter(item => item.stepId === step.id).at(-1);
  if (verdict?.attemptId === attempt.id) return verdict.passed ? undefined : attempt;
  if (/独立检查未返回有效 JSON|检查结论需要 passed/.test(run.error || '')) return attempt;
}

export function qualityRepairSource(run: WorkflowRun) {
  const steps = run.snapshot.steps;
  const current = steps[run.stepIndex];
  const remaining = steps.slice(run.stepIndex + 1).filter(step => step.enabled);
  const [exportStep, finalReview] = remaining;
  if (run.snapshot.outputKind !== 'image' || run.retryStepOnly || run.supersededByRunId || run.attempts.some(attempt => attempt.status === 'running')
    || current?.kind !== 'vision' || current.role !== 'reviewer' || current.inputSource !== 'previous' || current.referenceArtifactIds !== undefined || remaining.length !== 2
    || exportStep?.kind !== 'export' || finalReview?.kind !== 'manual-review' || exportStep.imageExportSize !== undefined
    || exportStep.wallpaperTarget !== undefined || exportStep.engineeringReferenceId !== undefined) return;
  const sourceId = exportStep.contentSourceStepIds === undefined ? exportStep.contentSourceStepId
    : exportStep.contentSourceStepId === undefined && exportStep.contentSourceStepIds.length === 1 ? exportStep.contentSourceStepIds[0] : undefined;
  const priorSteps = steps.slice(0, run.stepIndex);
  const producer = priorSteps.find(step => step.id === sourceId);
  if (!producer?.enabled || !['image-generation', 'image-editing'].includes(producer.kind)
    || producer.role === 'reviewer' || producer.role === 'planner' || (producer.count ?? 1) !== 1 || (producer.imageOutputFormat ?? 'png') !== 'png') return;
  const previous = priorSteps.filter(step => step.enabled && step.kind !== 'manual-review' && step.kind !== 'export'
    && run.attempts.some(attempt => attempt.stepId === step.id && attempt.status === 'complete')).at(-1);
  if (previous?.id !== producer.id) return;
  const attempt = run.attempts.filter(item => item.stepId === producer.id && item.status === 'complete').at(-1);
  const files = (attempt?.artifacts || []).filter(file => file.kind === 'image');
  const [file] = files;
  if (files.length === 1 && file?.id && file.mimeType === 'image/png'
    && file.projectId === run.projectId && file.runId === run.id && !file.trashedAt && !file.unavailable) return { file, producer };
}
