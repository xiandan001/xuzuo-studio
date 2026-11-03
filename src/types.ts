import type { DataManagementBridge } from './data-management-types';
import type { DeliveryBridge, DeliveryReceipt, DeliverySelection } from './delivery-types';
import type { BatchBridge } from './batch-types';
import type { FileDialogsBridge } from './dialog-types';
import type { CredentialsBridge, GenerationIntent, ModelCapability, StudioConfiguration, WorkflowRunner } from './configuration-types';
import type { ArtifactMetadata, CostState, LiveRuntimeBridge, ModelUsage } from './live-types';
import type { BillingRequestSnapshot, CostCalculation } from './billing-types';
import type { WorkspaceFilesBridge } from './workspace-types';
import type { EditorBridge } from './editor-types';
import type { SpreadsheetBridge } from './spreadsheet-types';
import type { AssetLibraryBridge, ProjectReference } from './asset-types';
import type { AppUpdateBridge } from './update-types';
import type { ReactNode } from 'react';

export type ViewId = 'overview' | 'documents' | 'images' | 'projects' | 'assets' | 'activity' | 'finance' | 'settings' | 'prompts' | 'categories' | 'workflows' | 'models';
export type ProjectKind = 'ppt' | 'word' | 'excel' | 'image';
export type PromptCategory = ProjectKind | 'general';
export interface Workspace {
  removedAt?: string;
  directory?: string;
  id: string;
  name: string;
  description: string;
  createdAt: string;
  lastProjectId?: string;
}
export interface PromptDraft {
  businessCategoryId?: string;
  name: string;
  description: string;
  category: PromptCategory;
  content: string;
  mode: 'create' | 'refine';
  imagePreset?: string;
}
export interface PromptTemplate extends PromptDraft {
  id: string;
  builtin: boolean;
  workspaceId?: string;
  updatedAt: string;
}
export interface AssetApplication { token: string; workspaceId: string; projectId: string; file: ArtifactMetadata; }
export interface PromptApplication {
  token: string;
  projectId: string;
  category: PromptCategory;
  content: string;
  mode: 'create' | 'refine';
  imagePreset?: string;
}
export type ProjectStatus = 'draft' | 'processing' | 'review' | 'complete' | 'paused';
export interface Project {
  confirmedDelivery?: { id: string; fingerprint: string; runStateSignature: string };
  liveLedgerBaselineCents?: number;
  referenceFiles?: ProjectReference[];
  directory?: string;
  trashedAt?: string;
  lastLiveCompletionId?: string;
  lastLiveStateSignature?: string;
  businessCategoryId?: string;
  workspaceId: string;
  id: string;
  name: string;
  kind: ProjectKind;
  status: ProjectStatus;
  description: string;
  updatedAt: string;
  costCents: number;
  budgetCents?: number;
  version: number;
  accent: 'purple' | 'orange' | 'green' | 'blue';
  favorite?: boolean;
}
export interface LedgerEntry {
  billingRequestSnapshot?: BillingRequestSnapshot;
  calculation?: CostCalculation;
  costReason?: string;
  queryOnly?: boolean;
  billingMode?: 'live' | 'simulation';
  costState?: CostState;
  usage?: ModelUsage;
  workflowRunId?: string;
  workflowStepId?: string;
  workflowAttemptId?: string;
  quantity?: number;
  id: string;
  projectId: string;
  projectName: string;
  action: '初次生成' | 'AI 精修' | '重新生成' | 'AI 复核';
  model: string;
  costCents: number;
  time: string;
  status: 'complete' | 'processing' | 'cancelled' | 'failed';
}
export interface Preferences {
  studioName: string;
  hourlyRate: number;
  channelFeePercent: number;
  targetProfit: number;
  monthlyBudget?: number;
  confirmGeneration: boolean;
  confirmGenerationVersion?: 1;
  keepVersions: boolean;
  reduceMotion: boolean;
}
export interface PageProps {
  onBatchProjectsCreated?: (projects: Project[]) => void;
  dataManagement?: ReactNode;
  onBindWorkspace?: () => Promise<boolean>;
  generationIntent?: GenerationIntent;
  onGenerationIntentConsumed: (token: string) => void;
  onUseStudioAction: (id: string, projectId: string, input?: string, attachmentIds?: string[]) => void;
  configuration: StudioConfiguration;
  workflowRunner: WorkflowRunner;
  workspaceId: string;
  workspace: Workspace;
  workspaces: Workspace[];
  prompts: PromptTemplate[];
  promptToApply?: PromptApplication;
  assetToApply?: AssetApplication;
  onUseAsset?: (projectId: string, file: ArtifactMetadata) => boolean | Promise<boolean>;
  onAssetApplied?: (token: string) => void;
  onPromptApplied: (token: string) => void;
  onSavePrompt: (draft: PromptDraft, id?: string) => void;
  onUsePrompt: (template: PromptTemplate, resolvedContent: string) => void;
  onMoveProject: (projectId: string, workspaceId: string, changes?: import('./lib/project-move').ProjectMoveChanges) => Promise<boolean>;
  taskProgress?: Record<string, number>;
  projects: Project[];
  trashedProjects: Project[];
  onTrashProject: (projectId: string) => void;
  onRestoreProject: (projectId: string) => void;
  ledger: LedgerEntry[];
  preferences: Preferences;
  activeProject: Project;
  navigate: (view: ViewId, projectId?: string) => void;
  notify: (message: string, type?: 'success' | 'info' | 'error') => void;
  onCreateProject: (kind?: ProjectKind) => void;
  onUpdateProject: (id: string, changes: Partial<Project>) => void;
  onProjectDelivered?: (projectId: string, receipt: DeliveryReceipt, selection: DeliverySelection) => void | Promise<void>;
  onGenerate: (projectId: string, action: LedgerEntry['action'], count?: number, onStarted?: () => void, input?: { prompt: string; input?: string; attachmentIds?: string[]; imageSize?: string; imageBackground?: 'auto' | 'opaque' | 'transparent'; modelConfigId?: string; capability?: ModelCapability; documentImages?: import('./lib/document-illustrations').DocumentImageOptions }) => void;
  onExport: (projectId?: string, draft?: { title: string; text: string }) => void;
  onUpdatePreferences: (changes: Partial<Preferences>) => void;
}
export interface DesktopBridge {
  updates?: AppUpdateBridge;
  maintenance?: { status: () => Promise<{ available: boolean; reason?: string }>; openUninstall: () => Promise<{ opened: boolean }> };
  fileDialogs?: FileDialogsBridge;
  dataManagement?: DataManagementBridge;
  delivery?: DeliveryBridge;
  batches?: BatchBridge;
  validationProfile?: boolean;
  onCloseStateRequested?: (reader: () => { blocked: boolean }) => () => void;
  onClosingStatus?: (listener: (status: { phase: string; message?: string }) => void) => () => void;
  assets?: AssetLibraryBridge;
  workspaceFiles?: WorkspaceFilesBridge;
  editor?: EditorBridge;
  spreadsheets?: SpreadsheetBridge;
  runtime: LiveRuntimeBridge;
  credentials: CredentialsBridge;
  minimize: () => void;
  maximize: () => void;
  close: () => void;
}
declare global {
  interface Window { desktop?: DesktopBridge; }
}
