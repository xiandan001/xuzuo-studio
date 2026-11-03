import type { ArtifactMetadata } from './live-types';

export type EditorKind = 'word' | 'ppt';
export type EditorAlignment = 'left' | 'center' | 'right';
export interface WordTableColumn { id: string; }
export interface WordTableCell { id: string; text: string; }
export interface WordTableRow { id: string; cells: WordTableCell[]; }
export interface WordTable { columns: WordTableColumn[]; rows: WordTableRow[]; header: boolean; borders: boolean; }
export interface WordBlock {
  id: string; type: 'paragraph' | 'heading' | 'bullet' | 'image' | 'table'; text: string;
  fontSize: number; bold: boolean; italic: boolean; align: EditorAlignment; imageId?: string; table?: WordTable;
}
export interface EditorSlide {
  id: string; title: string; body: string; notes: string;
  layout: 'title-body' | 'two-columns' | 'image-right' | 'image-full';
  fontSize: number; align: EditorAlignment; imageId?: string;
}
export interface WordEditorDocument { schemaVersion: 1; kind: 'word'; title: string; blocks: WordBlock[]; }
export interface PresentationEditorDocument { schemaVersion: 1; kind: 'ppt'; title: string; theme: 'paper' | 'violet' | 'forest' | 'night'; slides: EditorSlide[]; }
export type EditorDocument = WordEditorDocument | PresentationEditorDocument;
export interface EditorRecord { version: 1; projectId: string; revision: number; savedAt: string; document: EditorDocument; sourceArtifactIds: string[]; }
export interface EditorVersionInfo { revision: number; savedAt: string; title: string; kind: EditorKind; recoveryState?: 'saved' | 'prepared' | 'unverified'; }
export interface EditorSaveInput { projectId: string; expectedRevision: number; document: EditorDocument; sourceArtifactIds?: string[]; }
export interface EditorBridge {
  restore?: (input: { projectId: string; revision: number }) => Promise<EditorRecord>;
  load: (input: { projectId: string; kind: EditorKind; title: string }) => Promise<EditorRecord | null>;
  save: (input: EditorSaveInput) => Promise<EditorRecord>;
  history: (input: { projectId: string }) => Promise<EditorVersionInfo[]>;
  loadVersion: (input: { projectId: string; revision: number }) => Promise<EditorRecord>;
  export: (input: EditorSaveInput) => Promise<{ record: EditorRecord; artifacts: ArtifactMetadata[] }>;
}
