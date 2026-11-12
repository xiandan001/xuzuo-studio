import type { CredentialMetadata, ModelConfiguration, ModelConnection } from './configuration-types';
import type { LedgerEntry } from './types';
import type { ModelUsage, CostState, ArtifactMetadata, ArtifactPreview } from './live-types';
import type { CostCalculation } from './billing-types';
import type { ReasoningEffort } from './lib/reasoning-options';
import type { NaturalAutomationPlan } from './natural-automation-types';
import type { ProjectKind } from './types';
import type { AssetProvenance } from './asset-types';

export interface ChatAttachment { id: string; name: string; mimeType: string; bytes: number; kind: 'text' | 'image' | 'office'; sha256: string; createdAt: string; provenance?: AssetProvenance; }
export interface ChatTarget { projectId: string; artifactId: string; sha256: string; kind: ProjectKind; editorRevision?: number; }
export interface ChatTargetInspection { artifact: ArtifactMetadata; sha256: string; documentSource?: string; sourceRevision?: number; }
export interface ChatProductionLink { runId: string; target: ChatTarget; instruction: string; createdAt: string; sourceOnly?: boolean; sourceRunId?: string; }
export interface ChatExportLink { runId: string; projectId: string; turnId: string; kind: 'word' | 'ppt' | 'excel'; sourceSha256: string; createdAt: string; sourceOnly?: boolean; }
export interface ChatHistoryRequest { workspaceId: string; query?: string; scope?: 'active' | 'archived' | 'trash'; cursor?: number; limit?: number; }
export interface ChatHistoryPage { items: ChatConversationSummary[]; total: number; scanned: number; nextCursor?: number; }
export interface ChatManageRequest { workspaceId: string; conversationId: string; action: 'rename' | 'pin' | 'unpin' | 'archive' | 'trash' | 'restore'; title?: string; }
export interface ChatStreamDelta { turnId: string; sequence: number; textOffset: number; textDelta: string; }

export interface ChatTurn {
  id: string;
  userText: string;
  requestText?: string;
  target?: ChatTarget;
  streamSequence?: number;
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
  pinned?: boolean;
  archivedAt?: string;
  trashedAt?: string;
  matchSnippet?: string;
}
export interface ChatConversation extends ChatConversationSummary { version: 1; turns: ChatTurn[]; productions?: ChatProductionLink[]; exports?: ChatExportLink[]; unavailableReason?: string; }
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
  target?: ChatTarget;
}
export interface ChatChangedEvent { workspaceId: string; conversationId: string; ledgerChanged: boolean; turn?: ChatTurn; stream?: ChatStreamDelta; title?: string; updatedAt?: string; historyChanged?: boolean; }
export interface ChatBridge {
  linkExport?: (input: { workspaceId: string; conversationId: string; turnId: string; runId: string; kind: 'word' | 'ppt' | 'excel'; sourceSha256: string }) => Promise<ChatConversation>;
  selectTarget: (input: { workspaceId: string; projectId: string; artifactId: string; kind: ProjectKind }) => Promise<{ target: ChatTarget; inspection: ChatTargetInspection }>;
  linkProduction: (input: { workspaceId: string; conversationId: string; target: ChatTarget; runId: string; instruction: string }) => Promise<ChatConversation>;
  search: (input: ChatHistoryRequest) => Promise<ChatHistoryPage>;
  manage: (input: ChatManageRequest) => Promise<ChatConversation>;
  inspectTarget: (input: { workspaceId: string; target: ChatTarget }) => Promise<ChatTargetInspection>;
  importBytes: (input: { workspaceId: string; conversationId: string; files: { name: string; mimeType: string; bytes: Uint8Array }[] }) => Promise<ChatAttachment[]>;
  importAsset: (input: { workspaceId: string; conversationId: string; assetId: string; builtin?: boolean }) => Promise<ChatAttachment[]>;
  importProjectArtifact: (input: { workspaceId: string; conversationId: string; projectId: string; artifactId: string }) => Promise<ChatAttachment[]>;
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
