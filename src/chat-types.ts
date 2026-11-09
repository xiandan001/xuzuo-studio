import type { CredentialMetadata, ModelConfiguration, ModelConnection } from './configuration-types';
import type { LedgerEntry } from './types';
import type { ModelUsage, CostState } from './live-types';
import type { CostCalculation } from './billing-types';
import type { ReasoningEffort } from './lib/reasoning-options';
import type { NaturalAutomationPlan } from './natural-automation-types';
import type { ProjectKind } from './types';
import type { ArtifactMetadata } from './live-types';

export interface ChatAttachment {
  id: string;
  name: string;
  mimeType: string;
  bytes: number;
  kind: 'text' | 'image' | 'document';
}

export interface ChatTurn {
  id: string;
  userText: string;
  text: string;
  status: 'running' | 'complete' | 'cancelled' | 'failed' | 'interrupted';
  createdAt: string;
  updatedAt: string;
  modelName: string;
  modelId: string;
  modelConfigId: string;
  credentialId: string;
  reasoningEffort?: ReasoningEffort;
  sourceTurnId?: string;
  mode?: 'chat' | 'plan';
  outputKind?: ProjectKind;
  attachments?: ChatAttachment[];
  plan?: NaturalAutomationPlan;
  contextTruncated?: boolean;
  error?: string;
  saveIssue?: string;
  usage?: ModelUsage;
  costCents: number;
  costState: CostState;
  calculation?: CostCalculation;
  costReason?: string;
}
export interface ChatConversationSummary {
  id: string;
  workspaceId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
  activeTurnId?: string;
}
export interface ChatConversation extends ChatConversationSummary { version: 1; turns: ChatTurn[]; }
export interface ChatStartRequest {
  id: string;
  workspaceId: string;
  conversationId: string;
  text: string;
  connection: ModelConnection;
  model: ModelConfiguration;
  credentialId: CredentialMetadata['id'];
  reasoningEffort?: ReasoningEffort;
  sourceTurnId?: string;
  mode?: 'chat' | 'plan';
  outputKind?: ProjectKind;
  attachmentIds?: string[];
}
export interface ChatChangedEvent { workspaceId: string; conversationId: string; ledgerChanged: boolean; turn?: ChatTurn; title?: string; updatedAt?: string; }
export interface ChatBridge {
  importAttachments?: (input: { workspaceId: string; conversationId: string }) => Promise<ChatAttachment[]>;
  transferAttachments?: (input: { workspaceId: string; conversationId: string; projectId: string } & ({ turnId: string; attachmentIds?: never } | { attachmentIds: string[]; turnId?: never })) => Promise<ArtifactMetadata[]>;
  list: (workspaceId: string) => Promise<ChatConversationSummary[]>;
  read: (input: { workspaceId: string; conversationId: string }) => Promise<ChatConversation>;
  start: (input: ChatStartRequest) => Promise<ChatConversation>;
  cancel: (input: { workspaceId: string; conversationId: string; turnId: string }) => Promise<ChatConversation>;
  flush: (input: { workspaceId: string; conversationId: string }) => Promise<ChatConversation>;
  ledger: (workspaceId?: string) => Promise<LedgerEntry[]>;
  onChanged: (listener: (event: ChatChangedEvent) => void) => () => void;
}
