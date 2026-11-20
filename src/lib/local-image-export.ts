import type { WorkflowRun } from '../configuration-types';
import { isRedPacketCoverWorkflow } from './wechat-red-packet-cover';

export function isCoverDeliveryLayoutFailure(run: WorkflowRun): boolean {
  if (run.mode !== 'live' || run.status !== 'failed' || !run.snapshot || !isRedPacketCoverWorkflow(run.snapshot, run.projectId)) return false;
  const step = run.snapshot.steps[run.stepIndex];
  if (step?.kind !== 'export' || !step.enabled) return false;
  const attempt = run.attempts?.filter(item => item.stepId === step.id).at(-1);
  if (attempt?.status !== 'failed') return false;
  if (attempt.errorCode) return attempt.errorCode === 'COVER_LAYOUT_REJECTED';
  return [run.error, attempt.error].some(message => /完整保留这张图会把主体缩得过小|头像昵称区或底部按钮区仍有密集细节/.test(message || ''));
}

export function canResumeLocalImageExport(run: WorkflowRun): boolean {
  if (run.mode !== 'live' || run.status !== 'cancelled' || run.supersededByRunId || run.snapshot.outputKind !== 'image') return false;
  const step = run.snapshot.steps[run.stepIndex];
  return step?.kind === 'export' && step.enabled && Boolean(step.wallpaperTarget || step.engineeringReferenceId || step.imageExportSize || isRedPacketCoverWorkflow(run.snapshot, run.projectId));
}
