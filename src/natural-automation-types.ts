import type { AutomationTrigger } from './automation-types';
import type { ModelCapability } from './configuration-types';
import type { ProjectKind } from './types';

export interface NaturalAutomationPlan {
  version: 1;
  name: string;
  objective: string;
  outputKind: ProjectKind;
  trigger: { type: AutomationTrigger; intervalMinutes?: number; sourceWorkflowId?: string };
  steps: { kind: Extract<ModelCapability, 'text' | 'vision' | 'image-generation' | 'image-editing'>; name: string; instruction: string }[];
  illustrations: { mode: 'none' | 'references' | 'generate'; count: number };
  acceptance: string[];
  constraints: string[];
  maxRepairs: number;
  questions: string[];
  unsupported: string[];
}
export interface AutomationPlanningRequest { id: string; workspaceId: string; projectId: string; modelConfigId: string; credentialId: string; input: string; priorPlanId?: string; currentPlan?: NaturalAutomationPlan; contextNotes?: string; calendarResolved?: boolean; }
export interface AutomationPlanningRecord { id: string; workspaceId: string; projectId: string; modelConfigId?: string; credentialId?: string; input: string; priorPlanId?: string; runId?: string; status: 'starting' | 'running' | 'complete' | 'failed' | 'interrupted' | 'cancelled' | 'cancelling'; resultText?: string; error?: string; createdAt: string; updatedAt: string; }
export interface AutomationPlanningBridge {
  start: (request: AutomationPlanningRequest) => Promise<AutomationPlanningRecord>;
  read: (input: { id: string; workspaceId: string }) => Promise<AutomationPlanningRecord>;
  list: (workspaceId: string) => Promise<AutomationPlanningRecord[]>;
  cancel: (input: { id: string; workspaceId: string }) => Promise<AutomationPlanningRecord>;
}
