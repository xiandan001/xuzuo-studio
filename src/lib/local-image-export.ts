import type { WorkflowRun } from '../configuration-types';

export function canResumeLocalImageExport(run: WorkflowRun): boolean {
  const step = run.snapshot.steps[run.stepIndex];
  return run.mode === 'live' && run.status === 'cancelled' && !run.supersededByRunId && run.snapshot.outputKind === 'image' && step?.kind === 'export' && step.enabled && Boolean(step.wallpaperTarget || step.engineeringReferenceId);
}
