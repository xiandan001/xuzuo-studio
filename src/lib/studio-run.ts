import type { CredentialMetadata, ModelConfiguration, StudioConfiguration, WorkflowDefinition, WorkflowDraft, WorkflowStep } from '../configuration-types';

export function studioCredential(credentials: CredentialMetadata[], connectionId?: string, preferredId?: string): string | undefined {
  const available = credentials.filter(item => item.enabled && item.connectionId === connectionId);
  if (available.some(item => item.id === preferredId)) return preferredId;
  return available.length === 1 ? available[0].id : undefined;
}

export function studioModel(models: ModelConfiguration[], preferredId?: string): ModelConfiguration | undefined {
  const available = models.filter(model => model.enabled);
  const preferred = available.find(model => model.id === preferredId);
  if (preferred) return preferred;
  const real = available.filter(model => !model.demo);
  return real.length === 1 ? real[0] : undefined;
}
export function workflowStepSelection(step: WorkflowStep, configuration: Pick<StudioConfiguration, 'models' | 'connections' | 'credentials'>): WorkflowStep {
  if (['manual-review', 'export', 'animation-compose'].includes(step.kind)) return step;
  const available = configuration.models.filter(model => model.enabled && model.capabilities.includes(step.kind as typeof model.capabilities[number]) && configuration.connections.some(connection => connection.id === model.connectionId && connection.enabled));
  const model = studioModel(available, step.modelConfigId);
  return { ...step, modelConfigId: model?.id, credentialId: model && !model.demo ? studioCredential(configuration.credentials, model.connectionId, step.credentialId) : undefined };
}
export function workflowSelections<T extends WorkflowDefinition | WorkflowDraft>(workflow: T, configuration: Pick<StudioConfiguration, 'models' | 'connections' | 'credentials'>): T {
  return { ...workflow, steps: workflow.steps.map(step => workflowStepSelection(step, configuration)) };
}
export const WORKFLOW_OUTPUT_MIN = 16;
export const WORKFLOW_OUTPUT_MAX = 16384;
export function workflowPublicError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : fallback;
}
