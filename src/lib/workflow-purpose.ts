import type { WorkflowRun } from '../configuration-types';

export const isProductionRun = (run: Pick<WorkflowRun, 'purpose'>) => run.purpose !== 'automation-plan';
