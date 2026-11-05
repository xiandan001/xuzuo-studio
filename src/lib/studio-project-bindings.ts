import type { ModelCapability, ModelConfiguration, CredentialMetadata, WorkflowRun, WorkflowStep } from '../configuration-types';
import { isProductionRun } from './workflow-purpose';

export function latestStudioBinding(runs: WorkflowRun[], workspaceId: string, projectId: string, capability: ModelCapability): WorkflowStep | undefined {
  const recent = runs.filter(run => run.mode === 'live' && isProductionRun(run) && run.workspaceId === workspaceId && run.projectId === projectId).sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
  for (const run of recent) {
    const steps = run.snapshot.steps.filter(step => step.enabled && step.kind === capability && step.modelConfigId);
    const producer = steps.find(step => step.role === 'producer');
    if (producer || steps.length) return producer || steps.at(-1);
  }
}

export function studioProjectModel(models: ModelConfiguration[], preferredId?: string, inherited?: WorkflowStep): ModelConfiguration | undefined {
  const id = preferredId || inherited?.modelConfigId;
  return id ? models.find(model => model.id === id && model.enabled) : models.length === 1 ? models[0] : undefined;
}

export function studioProjectCredential(credentials: CredentialMetadata[], model: ModelConfiguration | undefined, preferredId?: string, inherited?: WorkflowStep): string | undefined {
  if (!model) return undefined;
  const available = credentials.filter(key => key.enabled && key.connectionId === model.connectionId);
  let preferred = preferredId;
  if (preferredId?.startsWith('{')) {
    try { const value = JSON.parse(preferredId); if (value.version !== 1 || typeof value.credentialId !== 'string') return undefined; preferred = value.modelConfigId === model.id && value.connectionId === model.connectionId ? value.credentialId : undefined; }
    catch { return undefined; }
  }
  const id = preferred || (inherited?.modelConfigId === model.id ? inherited.credentialId : undefined);
  return id ? available.find(key => key.id === id)?.id : available.length === 1 ? available[0].id : undefined;
}

export function studioCredentialChoice(credentialId: string, model: ModelConfiguration | undefined) { return credentialId && model ? JSON.stringify({ version: 1, modelConfigId: model.id, connectionId: model.connectionId, credentialId }) : ''; }
export function studioCredentialPreferenceKey(projectId: string, capability: ModelCapability) { return `xuzuo-studio-credential-v1:${projectId}:${capability}`; }
export function readStudioCredentialPreference(projectId: string, capability: ModelCapability) { try { return localStorage.getItem(studioCredentialPreferenceKey(projectId, capability)) || ''; } catch { return ''; } }
export function saveStudioCredentialPreference(projectId: string, capability: ModelCapability, value: string) { try { localStorage.setItem(studioCredentialPreferenceKey(projectId, capability), value); return true; } catch { return false; } }
