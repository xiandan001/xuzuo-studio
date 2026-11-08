import type { ArtifactMetadata } from './live-types';

export interface CommerceLayerBase {
  id: string; name: string; x: number; y: number; width: number; height: number;
  opacity: number; visible: boolean; locked: boolean;
}
export interface CommerceRasterLayer extends CommerceLayerBase {
  type: 'image'; role: 'product' | 'background' | 'logo'; artifactId: string;
}
export interface CommerceTextLayer extends CommerceLayerBase {
  type: 'text'; text: string; fontSize: number; color: string; fontFamily: string;
  fontWeight: 'normal' | 'bold'; align: 'left' | 'center' | 'right';
}
export type CommerceImageLayer = CommerceRasterLayer | CommerceTextLayer;
export interface CommerceImageDocument {
  type: 'xuzuo-commerce-image'; version: 1; id: string; projectId: string; sourceArtifactId: string;
  sourceSha256: string; revision: number; title: string; width: number; height: number;
  background: string; layers: CommerceImageLayer[]; protectedMaskArtifactId?: string; protectionSourceArtifactId?: string; updatedAt: string;
}
export interface CommerceImageSource {
  id: string; name: string; width: number; height: number; sha256: string; previewDataUrl: string;
}
export interface CommerceImageScope { projectId: string; sourceArtifactId: string; documentId?: string; }
export interface CommerceImageRead extends CommerceImageScope {
  documentId: string; document?: CommerceImageDocument; source: CommerceImageSource; previews: Record<string, string>;
  workingDiffersFromExport?: boolean;
}
export interface CommerceImageSize { width: number; height: number; label: string; }
export interface CommerceImageRenderResult {
  artifacts: ArtifactMetadata[]; documentId: string; sourceRevision: number; runId: string;
}
export interface CommerceAlphaResult {
  artifact: ArtifactMetadata; width: number; height: number; sourceSha256: string;
}
export interface CommerceProtectResult {
  artifact: ArtifactMetadata; width: number; height: number; protectedPixelsVerified: true;
}
export interface CommerceImageSavedVersion { revision: number; title: string; savedAt: string; }
export interface CommerceImagesBridge {
  read: (input: CommerceImageScope & { fromSnapshot?: boolean }) => Promise<CommerceImageRead>;
  save: (input: CommerceImageScope & { expectedRevision: number; document: CommerceImageDocument }) => Promise<CommerceImageDocument>;
  render: (input: CommerceImageScope & { expectedRevision: number; sizes?: CommerceImageSize[] }) => Promise<CommerceImageRenderResult>;
  applyAlpha: (input: CommerceImageScope & { alphaArtifactId: string }) => Promise<CommerceAlphaResult>;
  protect: (input: CommerceImageScope & { editedArtifactId: string; maskArtifactId: string }) => Promise<CommerceProtectResult>;
  mask: (input: CommerceImageScope & { dataUrl: string }) => Promise<ArtifactMetadata>;
  cancel: (input: { projectId: string }) => Promise<void>;
  exportRecovery?: (input: { projectId: string; document: CommerceImageDocument }) => Promise<{ saved: boolean }>;
  history?: (input: CommerceImageScope) => Promise<CommerceImageSavedVersion[]>;
  restore?: (input: CommerceImageScope & { revision: number; expectedRevision: number }) => Promise<CommerceImageDocument>;
}
