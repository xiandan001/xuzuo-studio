import type { Project, ProjectKind } from './types';
import type { ArtifactMetadata } from './live-types';
import type { NaturalAutomationBindings } from './lib/natural-automation-plan';

export type BusinessRecipe = 'merchant' | 'digital' | 'documents';
export type BusinessOrderStatus = 'draft' | 'ready' | 'running' | 'sample-review' | 'review' | 'complete' | 'paused' | 'failed' | 'archived';
export interface BusinessBrand {
  id: string; name: string; contact: string; projectId?: string; logoArtifactId?: string;
  colors: string[]; font: string; voice: string; forbiddenClaims: string[]; approvedSampleIds: string[]; updatedAt: string;
}
export interface BusinessProduct {
  id: string; sku: string; name: string; projectId: string; referenceArtifactIds: string[];
  facts: Record<string, string>; factsConfirmedAt?: string; updatedAt: string;
}
export interface BusinessTask {
  inputHash?: string;
  operation?: 'cutout' | 'background' | 'compose' | 'document'; referenceArtifactIds?: string[]; dispatchKey?: string; submittedAt?: string;
  id: string; label: string; kind: ProjectKind; productId?: string; projectId?: string; runId?: string;
  status: 'pending' | 'running' | 'review' | 'complete' | 'failed' | 'cancelled' | 'stale';
  artifactIds: string[]; factsRevision: number; error?: string;
}
export interface BusinessOrder {
  paymentPlan?: BusinessPaymentPlan;
  intakes?: BusinessIntake[];
  referenceArtifactIds?: string[];
  deliveries?: BusinessDeliveryReceipt[];
  preparedHash?: string;
  id: string; name: string; recipe: BusinessRecipe; sourceProjectId: string; brandId?: string;
  brief: string; productIds: string[]; projectIds: string[]; runIds: string[]; outputIds: string[];
  includedRevisions: number; deadline?: string; status: BusinessOrderStatus; factsRevision: number;
  facts: Record<string, string>; factsConfirmedAt?: string; outputKinds: ProjectKind[];
  imageCount: number; sizes: { width: number; height: number; label: string }[];
  tasks: BusinessTask[]; bindings: NaturalAutomationBindings;
  createdAt: string; updatedAt: string; error?: string;
}
export interface BusinessDeliveryReceipt {
  id: string; confirmedAt: string; factsRevision: number;
  files: { artifactId: string; projectId: string; name: string; sha256: string; bytes: number }[];
  checks: { content: boolean; rights: boolean; format: boolean };
}
export interface BusinessFeedback {
  revisionAdoption?: { sourceArtifactId: string; sourceSha256: string; exportRevision: number; artifactIds: string[]; adoptedAt: string };
  id: string; orderId: string; round: number;
  target: { projectId: string; artifactId?: string; pageId?: string; blockId?: string; selectedText?: string; sheetId?: string; cellAddress?: string; region?: { x: number; y: number; width: number; height: number } };
  proofPackageId?: string; proofAnnotationId?: string; sourceSha256?: string; sourceRevision?: number;
  text: string; tasks: string[]; status: 'open' | 'approved' | 'applied' | 'confirmed';
  runIds: string[]; additionalQuoteCents?: number; createdAt: string; updatedAt: string;
}
export interface BusinessCostAllocation {
  id: string; entryId: string; projectId?: string; orderId?: string; basisPoints: number;
  note: string; createdAt: string; voidedAt?: string;
}
export interface BusinessTransaction {
  paymentMilestoneId?: string;
  id: string; orderId: string; productId?: string; kind: 'receipt' | 'refund' | 'fee' | 'expense' | 'labor';
  amountCents: number; quantity?: number; minutes?: number; hourlyRateCents?: number; occurredAt: string;
  note: string; source?: string; externalId?: string; voidedAt?: string;
}
export interface BusinessPaymentPlan {
  currency: 'CNY'; agreedCents: number;
  milestones: { id: string; label: string; amountCents: number; dueDate?: string; note?: string }[];
  assignments?: { id: string; transactionId: string; milestoneId?: string; createdAt: string; voidedAt?: string }[];
}
export type BusinessIntakeKey = 'brief' | 'purpose' | 'quantity' | 'size' | 'deadline' | 'includedRevisions' | 'formats';
export interface BusinessIntakeSource { artifactId: string; originalArtifactId?: string; sha256: string; name: string; mimeType: string; text?: string; }
export interface BusinessIntakeCandidate {
  key: BusinessIntakeKey; value: string;
  evidence: { artifactId: string; page?: number; snippet: string; textMatched: boolean }[];
}
export interface BusinessIntake {
  requestId?: string;
  id: string; createdAt: string; factsRevision: number; sources: BusinessIntakeSource[];
  candidates: BusinessIntakeCandidate[]; missing: BusinessIntakeKey[]; warnings: string[];
  runId?: string; confirmedAt?: string; confirmedValues?: Partial<Record<BusinessIntakeKey, string>>;
}
export interface BusinessMetric {
  evidenceArtifactId?: string;
  id: string; orderId: string; artifactId?: string; platform: string; variant: string; publishedAt?: string;
  period: string; impressions?: number; clicks?: number; inquiries?: number; orders?: number;
  revenueCents?: number; source: string; externalId?: string; createdAt: string;
}
export interface BusinessState {
  costAllocations?: BusinessCostAllocation[];
  version: 1; workspaceId: string; revision: number; brands: BusinessBrand[]; products: BusinessProduct[];
  orders: BusinessOrder[]; feedback: BusinessFeedback[]; transactions: BusinessTransaction[]; metrics: BusinessMetric[];
}
export interface BusinessEconomics {
  approximate?: boolean;
  receiptsCents: number; refundsCents: number; feesCents: number; expensesCents: number; laborCents: number;
  receivedQuantity?: number; refundedQuantity?: number;
  apiCents: number; knownBalanceCents: number; complete: boolean; missing: string[];
}
export interface BusinessMetricSummary {
  platform: string; period: string; variant: string; impressions?: number; clicks?: number; inquiries?: number;
  orders?: number; revenueCents?: number; clickRate?: number; inquiryRate?: number; conversionRate?: number;
}
export interface BusinessImportPreview {
  warnings?: string[];
  token: string; kind: 'products' | 'transactions' | 'metrics'; columns: string[]; rows: Record<string, string>[];
  issues: string[]; duplicates: number; conflicts: string[];
}
export interface BusinessProductionResult { state: BusinessState; projects: Project[]; }
export interface BusinessListingInput {
  workspaceId: string; orderId: string; projectId: string; artifactIds: string[];
  title: string; description: string; licence: string; instructions: string; watermark: string;
}
export interface BusinessListingResult { artifacts: ArtifactMetadata[]; formalArtifactIds: string[]; previewArtifactIds: string[]; }
export interface BusinessBridge {
  adoptRevision?: (input: { workspaceId: string; orderId: string; feedbackId: string; sourceArtifactId: string; sourceSha256: string; sourceRevision?: number; exportRevision: number; artifactIds: string[] }) => Promise<BusinessProductionResult>;
  intakeRead?: (input: { workspaceId: string; orderId: string; artifactIds: string[]; text?: string }) => Promise<{ state: BusinessState; intakeId: string }>;
  intakeExtract?: (input: { workspaceId: string; orderId: string; intakeId: string }) => Promise<{ state: BusinessState; intakeId: string }>;
  intakeConfirm?: (input: { workspaceId: string; orderId: string; intakeId: string; expectedRevision: number; values: Partial<Record<BusinessIntakeKey, string>>; confirmed: true }) => Promise<BusinessState>;
  exportStatement?: (input: { workspaceId: string; orderId: string }) => Promise<{ saved: boolean; artifact?: ArtifactMetadata }>;
  linkOutput?: (input: { workspaceId: string; projectId: string; artifactIds: string[]; orderId?: string; name?: string }) => Promise<BusinessState>;
  allocateCosts?: (input: { workspaceId: string; expectedRevision: number; entryId: string; allocations: { projectId?: string; orderId?: string; basisPoints: number }[]; note?: string }) => Promise<BusinessState>;
  importProofFeedback?: (input: { workspaceId: string; orderId?: string; title?: string; packageId: string; annotations: { id: string; target: BusinessFeedback['target']; text: string; sourceSha256: string; sourceRevision?: number }[] }) => Promise<BusinessState>;
  onChanged?: (listener: (event: { workspaceId: string; revision: number }) => void) => () => void;
  snapshot: (workspaceId: string) => Promise<BusinessState>;
  save: (input: { workspaceId: string; expectedRevision: number; state: BusinessState }) => Promise<BusinessState>;
  importPreview: (input: { workspaceId: string; kind: BusinessImportPreview['kind']; orderId?: string; projectId?: string }) => Promise<BusinessImportPreview | undefined>;
  importCommit: (input: { workspaceId: string; expectedRevision: number; token: string; orderId?: string; projectId?: string }) => Promise<BusinessState>;
  exportRecovery: (input: { workspaceId: string; state?: BusinessState }) => Promise<{ saved: boolean }>;
  prepare: (input: { workspaceId: string; orderId: string }) => Promise<BusinessProductionResult>;
  start: (input: { workspaceId: string; orderId: string; sampleOnly?: boolean; taskIds?: string[] }) => Promise<BusinessProductionResult>;
  control: (input: { workspaceId: string; orderId: string; action: 'pause' | 'cancel' | 'continue' | 'retry'; taskId?: string }) => Promise<BusinessProductionResult>;
  listing: (input: BusinessListingInput) => Promise<BusinessListingResult>;
  deliver: (input: { workspaceId: string; orderId: string; checks: { content: boolean; rights: boolean; format: boolean } }) => Promise<BusinessProductionResult>;
  adopt?: (input: { workspaceId: string; orderId: string; taskId?: string; artifactIds: string[] }) => Promise<BusinessProductionResult>;
  assist?: (input: { workspaceId: string; orderId: string; purpose: 'listing' | 'feedback' | 'performance'; text?: string; attachmentIds?: string[] }) => Promise<{ text: string; runId: string }>;
}
