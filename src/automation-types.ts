import type { ModelConfiguration, ModelConnection, WorkflowDefinition } from './configuration-types';
import type { Project, Workspace } from './types';

export type AutomationTrigger = 'manual' | 'schedule' | 'reference-imported' | 'run-completed';
export interface AutomationContinuation { previousRuleId: string; previousRunId: string; }
export interface AutomationIntent { token: string; workspaceId: string; projectId: string; workflowId: string; input: string; }
export interface AutomationRule { preparation?: { questions: string[]; answers: Record<string, string> }; creationKey?: string; id: string; workspaceId: string; projectId: string; workflowId: string; name: string; enabled: boolean; trigger: AutomationTrigger; intervalMinutes?: number; sourceWorkflowId?: string; input: string; variables: Record<string, string>; updatedAt: string; lastTriggeredAt?: string; }
export type AutomationRuleDraft = Omit<AutomationRule, 'id' | 'updatedAt' | 'lastTriggeredAt'>;
export interface AutomationEvent { id: string; workspaceId: string; projectId: string; trigger: AutomationTrigger; sourceId: string; input?: string; attachmentIds?: string[]; createdAt: string; }
export interface AutomationJob { id: string; ruleId: string; workspaceId: string; projectId: string; eventId: string; dispatchKey: string; status: 'queued' | 'dispatching' | 'running' | 'decision' | 'complete' | 'cancelled'; createdAt: string; updatedAt: string; runId?: string; error?: string; attachmentIds: string[]; input: string; }
export interface AutomationDecision { id: string; jobId: string; runId?: string; workspaceId: string; projectId: string; kind: 'review' | 'failure' | 'uncertain'; title: string; detail: string; createdAt: string; resolvedAt?: string; action?: string; note?: string; }
export interface AutomationMemory { id: string; workspaceId: string; projectId: string; ruleId: string; decisionId: string; action: string; note: string; createdAt: string; }
export interface AutomationSnapshot { revision: number; rules: AutomationRule[]; events: AutomationEvent[]; jobs: AutomationJob[]; decisions: AutomationDecision[]; memories: AutomationMemory[]; available: boolean; issue?: string; }
export interface AutomationContext { workspaceId?: string; workspaces: Workspace[]; projects: Project[]; workflows: WorkflowDefinition[]; models: ModelConfiguration[]; connections: ModelConnection[]; }
export interface AutomationBridge {
  prepareProjectArchive: (input: { projectId: string; workspaceId: string }) => Promise<void>;
  restoreProjectArchive: (input: { projectId: string; workspaceId: string }) => Promise<void>;
  onChanged?: (listener: () => void) => () => void;
  reload: () => Promise<void>;
  snapshot: (workspaceId: string) => Promise<AutomationSnapshot>;
  syncContext: (context: AutomationContext) => Promise<void>;
  saveRule: (draft: AutomationRuleDraft & { id?: string }) => Promise<AutomationRule>;
  setEnabled: (input: { id: string; enabled: boolean }) => Promise<void>;
  trigger: (input: { ruleId: string; continuation?: AutomationContinuation }) => Promise<AutomationJob>;
  cancelJob: (id: string) => Promise<void>;
  resolve: (input: { id: string; action: 'approve' | 'continue' | 'reject' | 'refresh'; note?: string; remember?: boolean }) => Promise<void>;
}
