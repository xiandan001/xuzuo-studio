import type { WorkflowRun } from '../configuration-types';
import { isRedPacketCoverWorkflow } from './wechat-red-packet-cover';

export function canResumeLocalImageExport(run: WorkflowRun): boolean {
  if (run.mode !== 'live' || run.status !== 'cancelled' || run.supersededByRunId || run.snapshot.outputKind !== 'image') return false;
  const step = run.snapshot.steps[run.stepIndex];
  return step?.kind === 'export' && step.enabled && Boolean(step.wallpaperTarget || step.engineeringReferenceId || step.imageExportSize || isRedPacketCoverWorkflow(run.snapshot, run.projectId));
}
