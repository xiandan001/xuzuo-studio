import type { ArtifactMetadata } from './live-types';

export interface BeadColor {
  code: string;
  name: string;
  hex: string;
  rgb: [number, number, number];
  kind: 'solid' | 'transparent' | 'special';
  automatic: boolean;
}
export interface BeadPalette {
  id: string;
  name: string;
  brand: string;
  version: string;
  sourceUrl: string;
  sourceNote: string;
  license: string;
  colors: BeadColor[];
}
export interface BeadSettings {
  columns: number;
  rows: number;
  fit: 'contain' | 'cover';
  maxColors: number;
  alphaThreshold: number;
  boardColumns: number;
  boardRows: number;
}
export interface BeadPattern {
  type: 'xuzuo-bead-pattern';
  version: 1;
  columns: number;
  rows: number;
  palette: BeadPalette;
  cells: number[]; // 0 is an empty cell; 1..N indexes palette.colors.
}
export interface BeadProcurement {
  copies: number;
  lossPercent: number;
  defaultPackSize: number;
  stock: Record<string, number>;
  packSizes: Record<string, number>;
}
export interface BeadDocument {
  type: 'xuzuo-bead-document';
  version: 1;
  id: string;
  projectId: string;
  revision: number;
  title: string;
  referenceId?: string;
  sourceSha256?: string;
  settings: BeadSettings;
  pattern: BeadPattern;
  procurement: BeadProcurement;
  updatedAt: string;
}
export interface BeadUsageRow {
  code: string;
  name: string;
  hex: string;
  kind: BeadColor['kind'];
  cells: number;
  required: number;
  reserve: number;
  stock: number;
  shortage: number;
  packSize: number;
  bags: number;
}
export interface BeadSourcePreview {
  referenceId: string;
  name: string;
  sourceSha256: string;
  originalWidth: number;
  originalHeight: number;
  dataUrl: string;
}
export type BeadExportFormat = 'png' | 'pdf' | 'csv' | 'xlsx' | 'json' | 'bundle';
export interface BeadExportResult {
  artifact: ArtifactMetadata;
  artifacts?: ArtifactMetadata[];
  exportRunId?: string;
  sourceRevision?: number;
}
export interface BeadSavedVersion { revision: number; title: string; updatedAt: string; columns: number; rows: number; recoveryState?: 'saved' | 'prepared' | 'unverified'; }
export interface BeadRaster {
  width: number;
  height: number;
  pixels: Uint8Array | Uint8ClampedArray;
  format?: 'rgba' | 'bgra';
  premultiplied?: boolean;
}
export interface BeadBridge {
  source: (input: { projectId: string; referenceId: string }) => Promise<BeadSourcePreview>;
  read: (input: { projectId: string }) => Promise<BeadDocument | undefined>;
  generate: (input: { projectId: string; referenceId: string; title: string; settings: BeadSettings; palette: BeadPalette; procurement: BeadProcurement; expectedRevision?: number }) => Promise<BeadDocument>;
  save: (input: { projectId: string; document: BeadDocument; expectedRevision: number }) => Promise<BeadDocument>;
  export: (input: { projectId: string; format: BeadExportFormat; expectedRevision: number }) => Promise<BeadExportResult>;
  importPalette: (input: { projectId: string }) => Promise<BeadPalette | undefined>;
  importDocument: (input: { projectId: string }) => Promise<BeadDocument | undefined>;
  exportRecovery: (input: { projectId: string; document: BeadDocument }) => Promise<{ saved: boolean; path?: string }>;
  history: (input: { projectId: string }) => Promise<BeadSavedVersion[]>;
  restore: (input: { projectId: string; revision: number; expectedRevision?: number }) => Promise<BeadDocument>;
  cancel: (input: { projectId: string }) => Promise<void>;
}
