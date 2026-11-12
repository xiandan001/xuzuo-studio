import type { DeliveryCheck } from './lib/delivery-quality';
import type { ProjectKind } from './types';

export interface DeliverySelection { projectId: string; kind: ProjectKind; artifactIds: string[]; sourceRevision?: number | string; checks: DeliveryCheck[]; }
export interface DeliveryFile { id: string; name: string; mimeType: string; bytes: number; sha256: string; }
export interface DeliveryReceipt { version: 1; id: string; projectId: string; kind: ProjectKind; title: string; revision: string; fingerprint: string; confirmedAt: string; files: DeliveryFile[]; checks: DeliveryCheck[]; checkedIds: string[]; }
export interface DeliveryInspection { projectId: string; kind: ProjectKind; title: string; revision: string; fingerprint: string; files: DeliveryFile[]; checks: DeliveryCheck[]; errors: string[]; ready: boolean; checkedIds: string[]; reviewSavedAt?: string; receipts: DeliveryReceipt[]; currentReceipt?: DeliveryReceipt; }
export interface DeliveryBridge {
  preflight?: (input: DeliveryPreflightRequest) => Promise<DeliveryPreflightReport>;
  cancelPreflight?: (input: { requestId: string }) => Promise<void>;
  inspect: (input: DeliverySelection) => Promise<DeliveryInspection>;
  saveReview: (input: DeliverySelection & { fingerprint: string; checkedIds: string[] }) => Promise<DeliveryInspection>;
  confirm: (input: DeliverySelection & { fingerprint: string }) => Promise<DeliveryReceipt>;
  history: (input: { projectId: string }) => Promise<DeliveryReceipt[]>;
  exportZip: (input: { projectId: string; deliveryId: string }) => Promise<{ saved: boolean; path?: string; sha256?: string; bytes?: number }>;
}

export type DeliveryPreflightMethod = 'file' | 'ooxml' | 'spreadsheet' | 'image' | 'pdf';
export interface DeliveryPreflightTarget {
  projectId: string; artifactId: string; sha256: string; sourceRevision?: number;
  pageNumber?: number; pageId?: string; blockId?: string; sheetId?: string; sheetName?: string; cellAddress?: string;
  region?: { x: number; y: number; width: number; height: number };
}
export interface DeliveryPreflightFinding {
  id: string; severity: 'error' | 'warning' | 'unverified'; label: string; detail: string; method: DeliveryPreflightMethod; target: DeliveryPreflightTarget;
}
export interface DeliveryPreflightCheck {
  id: string; label: string; status: 'passed' | 'issues' | 'unverified'; method: DeliveryPreflightMethod; detail: string; artifactId: string;
}
export interface DeliveryPreflightRequest {
  requestId: string; projectId: string; kind: ProjectKind; artifactIds: string[]; sourceRevision?: number | string; refresh?: boolean;
}
export interface DeliveryPreflightPdf {
  artifactId: string; name: string; sourceSha256: string; sourceRevision?: number; previewId: string; pdfSha256: string; pdfBase64: string; renderer: string;
  sourceMap?: { pages?: { pageId: string; text: string }[]; blocks?: { blockId: string; text: string }[] };
}
export interface DeliveryPreflightReport {
  version: 1; projectId: string; kind: ProjectKind; requestId: string; generatedAt: string; cached: boolean;
  files: DeliveryFile[]; checks: DeliveryPreflightCheck[]; findings: DeliveryPreflightFinding[];
  rendered: { status: 'available' | 'unavailable' | 'partial' | 'not-needed'; engine?: string; reason?: string };
  pdfPreviews?: DeliveryPreflightPdf[];
}
