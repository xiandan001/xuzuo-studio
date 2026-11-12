import type { ArtifactMetadata } from './live-types';

export interface ProofRegion { x: number; y: number; width: number; height: number; }
export interface ProofingAnnotation {
  id: string; pageId: string; text: string; locatorId?: string; selectedText?: string; region?: ProofRegion;
}
export interface ProofingFeedbackFile {
  format: 'xuzuo-proof-feedback'; version: 1; packageId: string; fingerprint: string; createdAt: string; annotations: ProofingAnnotation[];
}
export interface ProofingPackage {
  packageId: string; fingerprint: string; title: string; createdAt: string; pageCount: number; artifact: ArtifactMetadata;
  files: { artifactId: string; projectId: string; name: string; sha256: string; bytes: number; sourceRevision?: number }[];
}
export interface ProofingImportResult { packageId: string; annotations: number; duplicate: number; orderId?: string; imported: boolean; }
export interface CustomerProofingBridge {
  create: (input: { workspaceId: string; projectId: string; artifactIds: string[]; orderId?: string; title: string }) => Promise<ProofingPackage>;
  importFeedback: (input: { workspaceId: string; projectId?: string; packageId?: string }) => Promise<ProofingImportResult | undefined>;
}
