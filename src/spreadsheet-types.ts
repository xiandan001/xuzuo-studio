import type { ArtifactMetadata } from './live-types';

export type SpreadsheetValue = string | number | boolean | null;
export type SpreadsheetFormat = 'general' | 'number' | 'currency' | 'percent';
export interface SpreadsheetCell {
  value: SpreadsheetValue;
  formula?: string;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  format?: SpreadsheetFormat;
}
export interface SpreadsheetSheet {
  id: string;
  name: string;
  rowCount: number;
  columnCount: number;
  cells: Record<string, SpreadsheetCell>;
}
export interface SpreadsheetDocument {
  schemaVersion: 1;
  kind: 'excel';
  title: string;
  sheets: SpreadsheetSheet[];
}
export interface SpreadsheetCellResult {
  status: 'value' | 'calculated' | 'error' | 'unsupported';
  value?: SpreadsheetValue;
  error?: string;
  message?: string;
}
export interface SpreadsheetIssue {
  sheetId: string;
  address: string;
  status: 'error' | 'unsupported';
  code: string;
  message: string;
}
export interface SpreadsheetCalculation {
  engineVersion: string;
  cells: Record<string, Record<string, SpreadsheetCellResult>>;
  formulaCount: number;
  calculatedCount: number;
  issues: SpreadsheetIssue[];
  allFormulasValid: boolean;
}
export interface SpreadsheetRecord {
  version: 1;
  projectId: string;
  revision: number;
  savedAt: string;
  document: SpreadsheetDocument;
  sourceArtifactIds: string[];
  calculation: SpreadsheetCalculation;
}
export interface SpreadsheetVersionInfo {
  recoveryState?: 'saved' | 'prepared' | 'unverified';
  revision: number;
  savedAt: string;
  title: string;
  sheetCount: number;
  formulaCount: number;
  issueCount: number;
}
export interface SpreadsheetSaveInput {
  projectId: string;
  expectedRevision: number;
  document: SpreadsheetDocument;
  sourceArtifactIds?: string[];
}
export interface SpreadsheetBridge {
  restore?: (input: { projectId: string; revision: number }) => Promise<SpreadsheetRecord>;
  load: (input: { projectId: string }) => Promise<SpreadsheetRecord | null>;
  save: (input: SpreadsheetSaveInput) => Promise<SpreadsheetRecord>;
  history: (input: { projectId: string }) => Promise<SpreadsheetVersionInfo[]>;
  loadVersion: (input: { projectId: string; revision: number }) => Promise<SpreadsheetRecord>;
  export: (input: SpreadsheetSaveInput) => Promise<{ record: SpreadsheetRecord; artifacts: ArtifactMetadata[] }>;
}
