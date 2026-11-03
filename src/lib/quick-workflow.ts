import type { ModelCapability, WorkflowStep } from '../configuration-types';
import type { LedgerEntry, ProjectKind } from '../types';

function defaultLocalStep(kind: 'manual-review' | 'export'): WorkflowStep {
  return { id: crypto.randomUUID(), name: kind === 'export' ? '生成实际交付文件' : '人工检查实际结果', kind, prompt: '', inputSource: 'previous', budgetCents: undefined, enabled: true };
}

function isUnchangedDefaultStep(step: WorkflowStep, kind: 'manual-review' | 'export'): boolean {
  const allowed = new Set(['id', 'name', 'kind', 'prompt', 'inputSource', 'budgetCents', 'enabled']);
  return step.kind === kind && step.name === (kind === 'export' ? '生成实际交付文件' : '人工检查实际结果') && step.prompt === '' && step.inputSource === 'previous' && step.budgetCents === undefined && step.enabled && Object.keys(step).every(key => allowed.has(key));
}

export function quickWorkflowTail(outputKind: ProjectKind, capability: ModelCapability, action: LedgerEntry['action'], existing?: WorkflowStep[]): WorkflowStep[] {
  const documentDelivery = outputKind !== 'image' && capability === 'text' && action !== 'AI 复核';
  if (existing) {
    if (documentDelivery && existing.length === 2 && isUnchangedDefaultStep(existing[0], 'manual-review') && isUnchangedDefaultStep(existing[1], 'export')) return [existing[1], existing[0]];
    return existing;
  }
  const review = defaultLocalStep('manual-review');
  if (action === 'AI 复核' || outputKind === 'image' && capability === 'text') return [review];
  const delivery = defaultLocalStep('export');
  return documentDelivery ? [delivery, review] : [review, delivery];
}
