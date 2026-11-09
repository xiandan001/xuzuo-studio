import type { ImageOutputOptions } from './image-options-types';
import type { LedgerEntry, ProjectKind } from './types';
import type { ArtifactMetadata, CostState, LivePreflight, LiveRuntimeStatus, ModelUsage } from './live-types';
import type { BillingRequestSnapshot, CostCalculation } from './billing-types';
import type { WallpaperTarget } from './wallpaper-types';
import type { AnimationWorkflowSettings } from './lib/animation-workflow';
import type { ReasoningEffort } from './lib/reasoning-options';

export interface BusinessCategory { id: string; workspaceId: string; name: string; parentId?: string; archived: boolean; }
export interface ImageUseTemplate { id: string; workspaceId: string; name: string; prompt: string; size: string; background: 'auto' | 'opaque' | 'transparent'; minReferences: number; enabled: boolean; builtin?: boolean; }
export type ImageUseTemplateDraft = Omit<ImageUseTemplate, 'id' | 'workspaceId' | 'builtin'>;
export type ApiProtocol = 'demo' | 'openai-chat' | 'openai-responses' | 'anthropic' | 'gemini' | 'image' | 'audio' | 'video' | 'custom';
export type ModelCapability = 'text' | 'vision' | 'image-generation' | 'image-editing' | 'transcription' | 'speech' | 'video-understanding' | 'video-generation';
export interface ModelConnection { id: string; name: string; providerId: string; protocol: ApiProtocol; baseUrl: string; enabled: boolean; status: 'configured' | 'format-checked'; demo?: boolean; }
export interface ModelPricing { unit: 'million-tokens' | 'image' | 'second' | 'request'; currency: 'CNY' | 'USD'; input: string; output: string; exchangeRate?: string; referenceOnly?: boolean; referenceNote?: string; officialUrl?: string; verifiedAt?: string; }
export interface ModelConfiguration { id: string; name: string; modelId: string; connectionId: string; capabilities: ModelCapability[]; pricing: ModelPricing; enabled: boolean; demo?: boolean; }
export interface CredentialMetadata { id: string; name: string; connectionId: string; lastFour: string; enabled: boolean; updatedAt: string; }
export interface CredentialInput { id?: string; name: string; connectionId: string; secret: string; }
export interface VaultStatus { available: boolean; requiresAuthorization?: boolean; reason?: string; }
export interface CredentialsBridge {
  status: () => Promise<VaultStatus>;
  list: () => Promise<CredentialMetadata[]>;
  save: (input: CredentialInput) => Promise<CredentialMetadata>;
  setEnabled: (input: { id: string; enabled: boolean }) => Promise<CredentialMetadata>;
}
export type WorkflowStepKind = ModelCapability | 'manual-review' | 'export' | 'animation-compose';
export interface WorkflowStep extends ImageOutputOptions { reasoningEffort?: ReasoningEffort; animation?: AnimationWorkflowSettings; referenceArtifactIds?: string[]; beadBaseRequestId?: string; engineeringReferenceId?: string; wallpaperTarget?: WallpaperTarget | null; imageSourceStepId?: string; role?: 'planner' | 'producer' | 'reviewer'; qualityGate?: { repairStepId?: string; maxRepairs: number; minScore?: number }; id: string; name: string; kind: WorkflowStepKind; prompt: string; promptTemplateId?: string; modelConfigId?: string; credentialId?: string; inputSource: 'project' | 'previous'; budgetCents?: number; enabled: boolean; maxOutputTokens?: number; imageSize?: string; imageBackground?: 'auto' | 'opaque' | 'transparent'; voice?: string; count?: number; contentSourceStepId?: string; contentSourceStepIds?: string[]; documentImageSource?: 'references' | 'previous'; documentImageStepIds?: string[]; }
export interface WorkflowDefinition { goalBrief?: import('./lib/automation-recipes').GoalBrief; foundationVersion?: string; id: string; workspaceId: string; name: string; description: string; outputKind: ProjectKind; businessCategoryId?: string; steps: WorkflowStep[]; updatedAt: string; }
export type WorkflowDraft = Omit<WorkflowDefinition, 'id' | 'workspaceId' | 'updatedAt'>;
export interface StudioAction { id: string; workspaceId: string; name: string; description: string; studio: 'documents' | 'images'; outputKind: ProjectKind; workflowId: string; enabled: boolean; }
export interface GenerationIntent { token: string; workflowId: string; projectId: string; input: string; attachmentIds?: string[]; editFirst?: boolean; replaceWaitingReviewRunId?: string; }
export interface WorkflowAttempt { engineeringSource?: import('./engineering-types').EngineeringSourceSnapshot; sourceArtifactIds?: string[]; recoveredFromReceiptAt?: string; recoveredError?: string; billingRequestSnapshot?: BillingRequestSnapshot; id: string; stepId: string; stepName: string; modelLabel: string; status: 'running' | 'waiting-review' | 'complete' | 'cancelled' | 'failed'; costCents: number; calculation?: CostCalculation; summary: string; input: string; prompt: string; action: LedgerEntry['action'] | '本地导出'; artifacts?: ArtifactMetadata[]; usage?: ModelUsage; costState?: CostState; error?: string; providerRequestId?: string; }
export interface WorkflowReferenceIssue { sourceStepId: string; artifactId?: string; reason: 'missing' | 'trashed' | 'changed' | 'foreign-project' | 'unsupported-format' | 'unreadable' | 'incomplete'; }
export interface WorkflowRun { referenceIssue?: WorkflowReferenceIssue; purpose?: 'automation-plan' | 'business-assist'; completedAt?: string; dispatchKey?: string; repairCounts?: Record<string, number>; repairContext?: { stepId: string; sourceAttemptId: string; reviewStepId: string; targetIndex: number; issues: string[]; number: number }; qualityReviews?: { passed: boolean; score?: number; issues: string[]; summary: string; stepId: string; attemptId: string; reviewedAt: string }[]; detailVersion?: number; contentTruncated?: boolean; detailAvailable?: boolean; hiddenAt?: string; trashedAt?: string; id: string; workspaceId: string; projectId: string; workflowId: string; workflowName: string; snapshot: WorkflowDefinition; status: 'running' | 'paused' | 'waiting-review' | 'complete' | 'cancelled' | 'interrupted' | 'failed'; stepIndex: number; attempts: WorkflowAttempt[]; variables: Record<string, string>; input: string; createdAt: string; updatedAt: string; retryStepOnly?: boolean; mode?: 'live' | 'simulation'; error?: string; pauseRequested?: boolean; attachmentIds?: string[]; supersededByRunId?: string; supersedesRunId?: string; }
export interface StorageIssue { kind: 'read' | 'write'; message: string; canExportOriginal: boolean; }
export interface SimulationStorageRecovery { issue?: StorageIssue; exportOriginal: () => boolean | Promise<boolean>; reload: () => boolean; reset: () => boolean; }
export interface StudioConfiguration {
  storageIssue?: StorageIssue;
  reloadStorage: () => boolean;
  exportOriginalStorage: () => boolean | Promise<boolean>;
  resetStorage: () => boolean;
  useTemplates: ImageUseTemplate[];
  saveUseTemplate: (draft: ImageUseTemplateDraft, id?: string) => boolean;
  deleteUseTemplate: (id: string) => boolean;
  studioActions: StudioAction[];
  saveStudioAction: (draft: Omit<StudioAction, 'id' | 'workspaceId'>, id?: string) => boolean;
  setStudioActionEnabled: (id: string, enabled: boolean) => void;
  categories: BusinessCategory[];
  workflows: WorkflowDefinition[];
  connections: ModelConnection[];
  models: ModelConfiguration[];
  credentials: CredentialMetadata[];
  vaultStatus: VaultStatus;
  saveCategory: (draft: { name: string; parentId?: string }, id?: string) => boolean;
  archiveCategory: (id: string, archived: boolean) => void;
  saveWorkflow: (draft: WorkflowDraft, id?: string, options?: { silent?: boolean }) => boolean;
  duplicateWorkflow: (id: string) => void;
  saveConnection: (draft: Omit<ModelConnection, 'id' | 'status' | 'demo'>, id?: string) => boolean;
  checkConnection: (id: string, credentialId?: string) => Promise<{ ok: boolean; message: string } | void>;
  setConnectionEnabled: (id: string, enabled: boolean) => void;
  saveModel: (draft: Omit<ModelConfiguration, 'id' | 'demo'>, id?: string) => boolean;
  setModelEnabled: (id: string, enabled: boolean) => void;
  saveCredential: (input: CredentialInput) => Promise<boolean>;
  setCredentialEnabled: (id: string, enabled: boolean) => Promise<void>;
  refreshCredentials: () => Promise<void>;
}
export interface WorkflowRunner {
  prepareGeneratedAnimationReference?: (input: import('./live-types').GeneratedAnimationReferenceInput) => Promise<import('./live-types').GeneratedAnimationReference>;
  prepareSvgReference?: (input: import('./live-types').SvgReferenceInput) => Promise<import('./live-types').SvgReference>;
  exportWallpaper4K?: (input: import('./live-types').Wallpaper4KExportInput) => Promise<import('./live-types').Wallpaper4KExportResult>;
  inventoryRevision?: number;
  thumbnailArtifact?: (id: string) => Promise<import('./live-types').ArtifactPreview>;
  inspectImageArtifact?: (id: string) => Promise<import('./live-types').ImageArtifactInspection>;
  loadRunDetail?: (id: string) => Promise<WorkflowRun>;
  listProjectArtifacts?: (projectId: string, options?: { refresh?: boolean }) => Promise<ArtifactMetadata[]>;
  simulationStorage?: SimulationStorageRecovery;
  trashedArtifacts?: ArtifactMetadata[];
  trashArtifact: (id: string) => Promise<void>;
  restoreArtifact: (id: string) => Promise<void>;
  listTrashedArtifacts: () => Promise<ArtifactMetadata[]>;
  reconcileCost: (entryId: string, costCents: number) => Promise<void>;
  runtimeStatus: LiveRuntimeStatus;
  preflight: (workflow: WorkflowDefinition, projectId: string, input: string, variables: Record<string, string>, attachmentIds: string[]) => Promise<LivePreflight>;
  startLive: (workflow: WorkflowDefinition, projectId: string, input: string, variables: Record<string, string>, attachmentIds: string[], acknowledgeUnknownCost: boolean, replaceWaitingReviewRunId?: string) => Promise<import('./live-types').LiveStartResult>;
  readStartResult: (projectId: string) => Promise<import('./live-types').LiveStartResult>;
  importFiles: (projectId?: string) => Promise<ArtifactMetadata[]>;
  manageRun?: (id: string, action: 'hide' | 'trash' | 'restore') => Promise<void>;
  previewArtifact: (id: string) => Promise<import('./live-types').ArtifactPreview>;
  openArtifact: (id: string) => Promise<void>;
  saveArtifact: (id: string) => Promise<{ saved: boolean; path?: string }>;
  runs: WorkflowRun[];
  start: (workflow: WorkflowDefinition, projectId: string, input: string, variables: Record<string, string>) => boolean;
  pause: (id: string) => void;
  resume: (id: string, stepBudgetCents?: number | null) => void;
  cancel: (id: string) => void;
  retry: (id: string, stepId: string) => void;
}
