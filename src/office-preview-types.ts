import type { ArtifactMetadata } from './live-types';

export interface OfficePreviewStatus { available: boolean; renderer?: { name: 'LibreOffice'; version: string; path: string }; reason?: string; downloadUrl: string; }
export interface RenderedOfficePreview { previewId: string; artifactId: string; sourceSha256: string; sourceName: string; renderer: string; generatedAt: string; pdfBase64: string; pdfBytes: number; }
export interface OfficePreviewBridge {
  status: () => Promise<OfficePreviewStatus>;
  chooseRenderer: () => Promise<OfficePreviewStatus>;
  openDownload: () => Promise<void>;
  render: (input: { artifactId: string; requestId: string; refresh?: boolean }) => Promise<RenderedOfficePreview>;
  cancel: (requestId: string) => Promise<void>;
  savePdf: (input: { previewId: string }) => Promise<{ artifact: ArtifactMetadata }>;
}
