import type { ArtifactMetadata } from './live-types';
import type { ProjectKind } from './types';
import type { WorkflowDefinition, WorkflowDraft } from './configuration-types';
export interface ProjectTemplateRetain { content?: boolean; assets?: boolean; workflow?: boolean; formulas?: boolean; }
export interface ProjectTemplateImageSettings { width: number; height: number; mimeType: string; }
export type ProjectTemplateCreativeSource = { kind: 'commerce'; documentId?: string } | { kind: 'animation' };
export interface ProjectTemplateSourceInfo { kind: 'commerce' | 'animation'; label: string; sourceArtifactId?: string; documentId?: string; animationMode?: 'atlas' | 'gif'; revision: number; width: number; height: number; }
export interface ProjectTemplateInfo { id: string; workspaceId: string; name: string; kind: ProjectKind; createdAt: string; retain: ProjectTemplateRetain; sourceRevision?: number; files: number; imageSettings?: ProjectTemplateImageSettings; creativeKind?: 'commerce' | 'animation'; animationMode?: 'atlas' | 'gif'; }
export interface ProjectTemplateInput { workspaceId: string; sourceProjectId: string; sourceArtifactId?: string; kind: ProjectKind; name: string; retain?: ProjectTemplateRetain; workflow?: WorkflowDefinition; creativeSource?: ProjectTemplateCreativeSource; }
export interface ProjectTemplateResult { projectId: string; artifacts: ArtifactMetadata[]; workflow?: WorkflowDraft; sourceRevision?: number; imageSettings?: ProjectTemplateImageSettings; creative?: { kind: 'commerce'; sourceArtifactId: string; documentId: string } | { kind: 'animation'; mode: 'atlas' | 'gif' }; }
export interface ProjectTemplatesBridge {
  list: (workspaceId: string) => Promise<ProjectTemplateInfo[]>;
  sources?: (input: { workspaceId: string; sourceProjectId: string; sourceArtifactId?: string }) => Promise<ProjectTemplateSourceInfo[]>;
  save: (input: ProjectTemplateInput) => Promise<ProjectTemplateInfo>;
  remove: (input: { workspaceId: string; id: string }) => Promise<void>;
  instantiate: (input: { workspaceId: string; targetProjectId: string; templateId?: string; sourceProjectId?: string; sourceArtifactId?: string; kind: ProjectKind; name: string; mode: 'template' | 'copy'; creativeSource?: ProjectTemplateCreativeSource }) => Promise<ProjectTemplateResult>;
}
