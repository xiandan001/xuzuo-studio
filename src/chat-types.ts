import type { CredentialMetadata, ModelConfiguration, ModelConnection } from './configuration-types';
import type { LedgerEntry } from './types';
import type { ModelUsage, CostState, ArtifactMetadata, ArtifactPreview } from './live-types';
import type { CostCalculation } from './billing-types';
import type { ReasoningEffort } from './lib/reasoning-options';
import type { NaturalAutomationPlan } from './natural-automation-types';
import type { ProjectKind } from './types';

export interface ChatAttachment { id: string; name: string; mimeType: string; bytes: number; kind: 'text' | 'image' | 'office'; sha256: string; createdAt: string; }

export interface ChatTurn {
  id: string;
  userText: string;
  requestText?: string;
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
  plan?: NaturalAutomationPlan;
  contextTruncated?: boolean;
  attachments?: ChatAttachment[];
  contextAttachments?: ChatAttachment[];
  attachmentNotice?: string;
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
  requestText?: string;
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
  importAttachments: (input: { workspaceId: string; conversationId: string }) => Promise<ChatAttachment[]>;
  previewAttachment: (input: { workspaceId: string; conversationId: string; attachmentId: string }) => Promise<ArtifactPreview>;
  attachToProject: (input: { workspaceId: string; conversationId: string; attachmentIds: string[]; projectId: string }) => Promise<ArtifactMetadata[]>;
  list: (workspaceId: string) => Promise<ChatConversationSummary[]>;
  read: (input: { workspaceId: string; conversationId: string }) => Promise<ChatConversation>;
  start: (input: ChatStartRequest) => Promise<ChatConversation>;
  cancel: (input: { workspaceId: string; conversationId: string; turnId: string }) => Promise<ChatConversation>;
  flush: (input: { workspaceId: string; conversationId: string }) => Promise<ChatConversation>;
  ledger: (workspaceId?: string) => Promise<LedgerEntry[]>;
  onChanged: (listener: (event: ChatChangedEvent) => void) => () => void;
}
