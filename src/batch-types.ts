import type { ArtifactMetadata, LiveStartRequest } from './live-types';
import type { LedgerEntry, Project } from './types';

export type BatchStatus = 'queued' | 'running' | 'paused' | 'waiting-review' | 'complete' | 'cancelled' | 'interrupted';
export type BatchItemStatus = 'queued' | 'submitting' | 'running' | 'waiting-review' | 'complete' | 'failed' | 'cancelled' | 'interrupted';
export interface BatchAttempt { ordinal: number; submittedAt: string; runId?: string; }
export interface BatchItem { id: string; row: number; variables: Record<string, string>; project: Project; status: BatchItemStatus; attempts: BatchAttempt[]; runId?: string; artifacts: ArtifactMetadata[]; error?: string; ledger?: LedgerEntry[]; costCents?: number; unknownCost?: boolean; }
export interface BatchRecord { version: 1; id: string; name: string; workspaceId: string; status: BatchStatus; createdAt: string; updatedAt: string; items: BatchItem[]; error?: string; }
export interface BatchImport { columns: string[]; rows: Record<string, string>[]; warnings: string[]; }
export interface BatchCreate { name: string; request: LiveStartRequest; rows: Record<string, string>[]; projectNameTemplate?: string; }
export type BatchAction = 'start' | 'pause' | 'cancel' | 'retry-item' | 'cancel-item' | 'resume-review';
export interface BatchBridge {
  parse: () => Promise<BatchImport | null>;
  create: (input: BatchCreate) => Promise<BatchRecord>;
  list: () => Promise<BatchRecord[]>;
  get: (input: { id: string }) => Promise<BatchRecord>;
  control: (input: { id: string; action: BatchAction; itemId?: string }) => Promise<BatchRecord>;
}
