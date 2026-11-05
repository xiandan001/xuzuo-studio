import type { ProjectKind } from './types';

export interface ProjectPurgePreviewItem {
  projectId: string; workspaceId: string; name: string; kind: ProjectKind;
  directory?: string; folderMissing?: boolean; error?: string;
}
export interface ProjectPurgePreview {
  selectionId: string; workspaceId: string; projectIds: string[]; deleteFiles: boolean;
  items: ProjectPurgePreviewItem[];
}
export interface ProjectPurgeItem extends ProjectPurgePreviewItem {
  cleanupDirectory?: string;
  trashedAt: string; purgedAt?: string; costCents: number; updatedAt: string; requestId: string;
  recordPurged: boolean; filesDeleted: boolean; folderMissing: boolean; filesPending: boolean;
  retryable: boolean;
}
export interface ProjectPurgeResult {
  id: string; requestId: string; workspaceId: string; projectIds: string[]; deleteFiles: boolean;
  complete: boolean; items: ProjectPurgeItem[];
  inProgress?: boolean; finishedAt?: string;
}
export interface ProjectPurgeRequest {
  id: string; selectionId: string; workspaceId: string; projectIds: string[]; deleteFiles: boolean;
}
export interface ProjectPurgeBridge {
  preview: (input: { workspaceId: string; projectIds: string[]; deleteFiles: boolean }) => Promise<ProjectPurgePreview>;
  execute: (input: ProjectPurgeRequest) => Promise<ProjectPurgeResult>;
  status: (input: { id: string; workspaceId: string }) => Promise<ProjectPurgeResult | null>;
  tombstones: (input: { workspaceId: string }) => Promise<ProjectPurgeItem[]>;
}
