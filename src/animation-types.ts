import type { ArtifactMetadata } from './live-types';

export type AnimationMode = 'atlas' | 'gif';
export type AnimationStyle = 'pixel-light' | 'pixel-actions' | 'illustrated-actions' | 'photo-people' | 'photo-pets' | 'clay-mascot' | 'lenticular' | 'type-linked' | 'comic-fusion';
export type AnimationMotion = 'nod' | 'jump' | 'sway' | 'startle' | 'tremble' | 'ponder' | 'breathe' | 'stomp' | 'rush' | 'peek' | 'pulse' | 'pop' | 'offer' | 'lean' | 'droop' | 'dance';
export interface AnimationFrame { id: string; atlasArtifactId: string; cell: [number, number]; grid: [number, number]; crop?: [number, number, number, number]; durationMs: number; }
export interface AnimationEntry {
  id: string; caption: string; description: string; motion: AnimationMotion; frames: AnimationFrame[];
  outputArtifactId?: string; coverArtifactId?: string; sourceHash?: string; renderedHash?: string;
  status: 'draft' | 'ready' | 'stale' | 'failed'; error?: string;
  inspection?: { width: number; height: number; frames: number; loopMs: number; transparent: boolean; warnings: string[] };
}
export interface AnimationDocument {
  version: 1; projectId: string; revision: number; title: string; mode: AnimationMode; style: AnimationStyle;
  prompt: string; referenceArtifactIds: string[]; modelConfigId: string; credentialId: string;
  width: number; height: number; fps: number; loopMs: number; background: 'transparent' | 'opaque';
  columns: number; rows: number; entries: AnimationEntry[]; acceptedSampleId?: string; updatedAt: string;
}
export interface AnimationHistoryEntry { id: string; label: string; revision: number; createdAt: string; }
export interface AnimationJob {
  id: string; projectId: string; status: 'running' | 'complete' | 'cancelled' | 'failed' | 'interrupted';
  stage: 'generating' | 'composing' | 'checking' | 'complete'; entryIds: string[]; completedEntryIds: string[];
  runIds: string[]; createdAt: string; updatedAt: string; error?: string;
}
export interface AnimationSnapshot { document: AnimationDocument; history: AnimationHistoryEntry[]; job?: AnimationJob; artifacts: ArtifactMetadata[]; helper: { available: boolean; reason?: string }; }
export interface AnimationBridge {
  read: (input: { projectId: string }) => Promise<AnimationSnapshot>;
  save: (input: { projectId: string; expectedRevision: number; document: AnimationDocument; label?: string }) => Promise<AnimationSnapshot>;
  restore: (input: { projectId: string; versionId: string; expectedRevision: number }) => Promise<AnimationSnapshot>;
  generate: (input: { projectId: string; sampleOnly?: boolean; entryIds?: string[]; retry?: boolean }) => Promise<AnimationSnapshot>;
  refine: (input: { projectId: string; entryId: string; frameId?: string; instruction: string; retry?: boolean }) => Promise<AnimationSnapshot>;
  control: (input: { projectId: string; action: 'cancel' | 'continue' | 'retry' }) => Promise<AnimationSnapshot>;
  compose: (input: { projectId: string; entryIds?: string[] }) => Promise<AnimationSnapshot>;
  export: (input: { projectId: string; format: 'atlas' | 'frames' | 'gif' | 'zip' | 'project'; entryIds?: string[] }) => Promise<{ artifact: ArtifactMetadata }>;
  importProject?: (input: { projectId: string; artifactId: string; expectedRevision: number }) => Promise<AnimationSnapshot>;
  onChanged?: (listener: (event: { projectId: string; revision?: number }) => void) => () => void;
}

export interface AnimationToolManifest {
  version: 1; mode: AnimationMode; style: AnimationStyle; title: string; width: number; height: number; fps: number; loopMs: number;
  background: 'transparent' | 'opaque'; fontPath?: string; exportFrames?: boolean;
  atlases: { id: string; path: string }[];
  entries: { id: string; caption: string; motion: AnimationMotion; frames: { atlasId: string; cell: [number, number]; grid: [number, number]; crop?: [number, number, number, number]; durationMs: number }[] }[];
}
export interface AnimationToolOutput {
  entryId: string; gifPath?: string; coverPath: string; framePaths: string[];
  report: { width: number; height: number; frames: number; loopMs: number; loop: number; transparent: boolean; warnings: string[]; durationsMs?: number[] };
}
