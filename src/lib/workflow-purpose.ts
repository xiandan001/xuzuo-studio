import type { WorkflowRun } from '../configuration-types';

export const isProductionRun = (run: Pick<WorkflowRun, 'purpose'>) => !['automation-plan', 'business-assist'].includes(run.purpose || '');

export function isLocalExportRun(run: WorkflowRun): boolean {
  const steps = run.snapshot.steps.filter(step => step.enabled);
  return run.mode === 'live' && !['automation-plan', 'business-assist'].includes(run.purpose || '') && steps.length > 0 && steps.every(step => step.kind === 'export')
    && run.attempts.every(attempt => attempt.costState === 'not-incurred' && attempt.costCents === 0 && !attempt.usage && !attempt.calculation);
}
