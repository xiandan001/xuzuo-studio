import type { AssetProvenance } from './asset-types';
import type { ModelConfiguration, ModelConnection, WorkflowDefinition, WorkflowRun } from './configuration-types';
import type { LedgerEntry, Project } from './types';
import type { ImageOutputOptions } from './image-options-types';

export interface ArtifactMetadata { id: string; name: string; mimeType: string; bytes: number; path: string; kind: 'text' | 'image' | 'audio' | 'video' | 'office' | 'other'; createdAt: string; runId?: string; projectId?: string; trashedAt?: string; unavailable?: boolean; unavailableReason?: string; provenance?: AssetProvenance; }
export interface ModelUsage {
  inputTokens?: number; outputTokens?: number; totalTokens?: number; images?: number; seconds?: number; providerRequestId?: string;
  inputTextTokens?: number; inputImageTokens?: number; cachedInputTokens?: number; uncachedInputTokens?: number;
  cacheWriteInputTokens?: number; cacheWrite5mTokens?: number; cacheWrite1hTokens?: number; cacheWrite30mTokens?: number; cacheWrite12hTokens?: number;
  cachedInputTextTokens?: number; cachedInputImageTokens?: number; outputImageTokens?: number; outputTextTokens?: number; reasoningTokens?: number;
  imageOutputFormat?: 'png' | 'jpeg' | 'webp' | 'svg' | 'gif';
  svgUsage?: { model?: string; inputTokens?: number; outputTokens?: number; reasoningTokens?: number; totalTokens?: number };
  usageSource?: string;
}
export type CostState = 'simulation' | 'calculated' | 'manual' | 'unknown' | 'not-incurred';
export type LiveStartResult = { status: 'started'; runId: string; recovered?: boolean } | { status: 'rejected'; error: string; code?: string } | { status: 'unknown'; error: string; dispatchKey: string };
export type LiveCheckedStartResult = { status: 'started'; run: WorkflowRun; recovered?: boolean } | { status: 'rejected'; error: string; code?: string } | { status: 'unknown'; error: string; dispatchKey: string };
export interface LiveStartLookup { projectId: string; workspaceId: string; dispatchKey: string; }
export interface LiveStartRequest {
  purpose?: 'automation-plan' | 'business-assist';
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
  replaceWaitingReviewAttemptId?: string;
  refinementFork?: { reviewAttemptId: string; sourceArtifactId: string };
}
export interface LivePreflightStep { id: string; name: string; kind: string; modelName?: string; domain?: string; credentialName?: string; estimatedCents?: number; costNote?: string; }
export interface LivePreflightIssue { message: string; stepId?: string; field?: 'modelConfigId' | 'credentialId' | 'prompt' | 'maxOutputTokens' | 'count' | 'imageSize' | 'inputSource' | 'budgetCents' | 'connection' | 'input' | 'variables' | 'attachments' | 'project'; }
export interface LivePreflight { ok: boolean; errors: string[]; issues?: LivePreflightIssue[]; warnings: string[]; steps: LivePreflightStep[]; estimatedCents?: number; unknownCost: boolean; }
export interface LiveSnapshot { delta?: boolean; runs: WorkflowRun[]; ledger: LedgerEntry[]; revision?: number; }
export interface ArtifactPreview { mimeType: string; dataUrl?: string; text?: string; documentSource?: boolean; sourceRevision?: number; thumbnail?: boolean; width?: number; height?: number; originalWidth?: number; originalHeight?: number; transparency?: 'present' | 'unknown'; }
export interface ImageArtifactInspection { id: string; mimeType: string; bytes: number; }
export interface GeneratedAnimationReferenceInput { projectId: string; sourceArtifactId: string; sourceSha256?: string; pngBytes?: Uint8Array; }
export interface GeneratedAnimationReference { sourceArtifactId: string; sourceSha256: string; prompt: string; imageOptions: ImageOutputOptions; mimeType: 'image/gif'; width: number; height: number; sourceBytes?: Uint8Array; reference?: ArtifactMetadata; }
export interface SvgReferenceInput { projectId: string; sourceArtifactId: string; sourceSha256?: string; pngBytes?: Uint8Array; }
export interface SvgReference { sourceArtifactId: string; sourceSha256: string; mimeType: 'image/svg+xml'; sourceWidth: number; sourceHeight: number; width: number; height: number; sourceBytes?: Uint8Array; reference?: ArtifactMetadata; }
export interface Wallpaper4KExportInput { projectId: string; sourceArtifactId: string; orientation: 'portrait' | 'landscape'; fit: 'cover' | 'contain'; }
export interface Wallpaper4KExportResult { artifact: ArtifactMetadata; target: import('./wallpaper-types').WallpaperTarget; locallyAdapted: true; }
export interface LiveRuntimeStatus { available: boolean; reason?: string; }
export interface LiveRuntimeBridge {
  prepareGeneratedAnimationReference?: (input: GeneratedAnimationReferenceInput) => Promise<GeneratedAnimationReference>;
  prepareSvgReference?: (input: SvgReferenceInput) => Promise<SvgReference>;
  exportWallpaper4K?: (input: Wallpaper4KExportInput) => Promise<Wallpaper4KExportResult>;
  saveImageMarkup?: (input: { projectId: string; sourceArtifactId: string; dataUrl: string }) => Promise<ArtifactMetadata>;
  startChecked?: (input: LiveStartRequest) => Promise<LiveCheckedStartResult>;
  lookupStart?: (input: LiveStartLookup) => Promise<{ status: 'started'; run: WorkflowRun } | { status: 'not-found' } | { status: 'unknown' }>;
  thumbnailArtifact?: (id: string) => Promise<ArtifactPreview>;
  inspectImageArtifact?: (id: string) => Promise<ImageArtifactInspection>;
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
