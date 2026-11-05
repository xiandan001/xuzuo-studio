import type { AssetProvenance } from './asset-types';
import type { ModelConfiguration, ModelConnection, WorkflowDefinition, WorkflowRun } from './configuration-types';
import type { LedgerEntry, Project } from './types';

export interface ArtifactMetadata { id: string; name: string; mimeType: string; bytes: number; path: string; kind: 'text' | 'image' | 'audio' | 'video' | 'office' | 'other'; createdAt: string; runId?: string; projectId?: string; trashedAt?: string; unavailable?: boolean; unavailableReason?: string; provenance?: AssetProvenance; }
export interface ModelUsage {
  inputTokens?: number; outputTokens?: number; totalTokens?: number; images?: number; seconds?: number; providerRequestId?: string;
  inputTextTokens?: number; inputImageTokens?: number; cachedInputTokens?: number; uncachedInputTokens?: number;
  cacheWriteInputTokens?: number; cacheWrite5mTokens?: number; cacheWrite1hTokens?: number; cacheWrite30mTokens?: number; cacheWrite12hTokens?: number;
  cachedInputTextTokens?: number; cachedInputImageTokens?: number; outputImageTokens?: number; outputTextTokens?: number; reasoningTokens?: number;
  usageSource?: string;
}
export type CostState = 'simulation' | 'calculated' | 'manual' | 'unknown' | 'not-incurred';
export interface LiveStartRequest {
  purpose?: 'automation-plan';
  workflow: WorkflowDefinition;
  project: Project;
  connections: ModelConnection[];
  models: ModelConfiguration[];
  input: string;
  variables: Record<string, string>;
  attachmentIds: string[];
  dispatchKey?: string;
  acknowledgePaidCalls: boolean;
  acknowledgeUnknownCost: boolean;
  replaceWaitingReviewRunId?: string;
}
export interface LivePreflightStep { id: string; name: string; kind: string; modelName?: string; domain?: string; credentialName?: string; estimatedCents?: number; costNote?: string; }
export interface LivePreflightIssue { message: string; stepId?: string; field?: 'modelConfigId' | 'credentialId' | 'prompt' | 'maxOutputTokens' | 'count' | 'imageSize' | 'inputSource' | 'budgetCents' | 'connection' | 'input' | 'variables' | 'attachments' | 'project'; }
export interface LivePreflight { ok: boolean; errors: string[]; issues?: LivePreflightIssue[]; warnings: string[]; steps: LivePreflightStep[]; estimatedCents?: number; unknownCost: boolean; }
export interface LiveSnapshot { delta?: boolean; runs: WorkflowRun[]; ledger: LedgerEntry[]; revision?: number; }
export interface ArtifactPreview { mimeType: string; dataUrl?: string; text?: string; documentSource?: boolean; sourceRevision?: number; thumbnail?: boolean; width?: number; height?: number; originalWidth?: number; originalHeight?: number; transparency?: 'present' | 'unknown'; }
export interface LiveRuntimeStatus { available: boolean; reason?: string; }
export interface LiveRuntimeBridge {
  thumbnailArtifact?: (id: string) => Promise<ArtifactPreview>;
  onProjectFilesChanged?: (listener: (projectId: string) => void) => () => void;
  listProjectArtifacts?: (projectId: string) => Promise<ArtifactMetadata[]>;
  trashArtifact: (id: string) => Promise<ArtifactMetadata>;
  restoreArtifact: (id: string) => Promise<ArtifactMetadata>;
  listTrashedArtifacts: () => Promise<ArtifactMetadata[]>;
  exportDraft: (input: { project: Project; title: string; text: string; attachmentIds?: string[] }) => Promise<ArtifactMetadata[]>;
  status: () => Promise<LiveRuntimeStatus>;
  preflight: (request: LiveStartRequest) => Promise<LivePreflight>;
  start: (request: LiveStartRequest) => Promise<WorkflowRun>;
  snapshot: () => Promise<LiveSnapshot>;
  pollSnapshot?: (afterRevision: number) => Promise<LiveSnapshot | null>;
  runDetail?: (id: string) => Promise<WorkflowRun>;
  control: (input: { id: string; action: 'pause' | 'resume' | 'cancel' | 'retry' | 'continue'; stepId?: string; stepBudgetCents?: number | null; project?: Project; connections?: ModelConnection[]; models?: ModelConfiguration[] }) => Promise<void>;
  reconcile: (input: { entryId: string; costCents: number }) => Promise<void>;
  recalculateCosts?: () => Promise<{ updated: number }>;
  importFiles: (projectId?: string) => Promise<ArtifactMetadata[]>;
  manageRun?: (input: { id: string; action: 'hide' | 'trash' | 'restore' }) => Promise<void>;
  previewArtifact: (id: string) => Promise<ArtifactPreview>;
  openArtifact: (id: string) => Promise<void>;
  saveArtifact: (id: string) => Promise<{ saved: boolean; path?: string }>;
  probe: (input: { connection: ModelConnection; credentialId: string }) => Promise<{ ok: boolean; message: string }>;
}
