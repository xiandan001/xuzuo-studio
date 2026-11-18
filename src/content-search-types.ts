import type { ArtifactMetadata } from './live-types';

export interface DocumentContentHit {
  id: string;
  projectId: string;
  projectName: string;
  artifact: ArtifactMetadata;
  snippet: string;
  sourceSha256: string;
  sourceRevision?: number;
}
export interface ContentSearchRequest { requestId: string; workspaceId: string; query: string; cursor?: string; limit?: number; }
export interface ContentSearchPage { items: DocumentContentHit[]; scanned: number; indexed: number; cached: number; skipped: number; cacheUnavailable?: boolean; nextCursor?: string; }
export interface ContentSearchBridge {
  search: (input: ContentSearchRequest) => Promise<ContentSearchPage>;
  cancel: (input: { requestId: string; workspaceId: string }) => Promise<{ cancelled: boolean }>;
}
