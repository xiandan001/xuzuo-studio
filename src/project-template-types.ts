import type { ArtifactMetadata } from './live-types';
import type { ProjectKind } from './types';
import type { WorkflowDefinition, WorkflowDraft } from './configuration-types';
export interface ProjectTemplateRetain { content?: boolean; assets?: boolean; workflow?: boolean; formulas?: boolean; }
export interface ProjectTemplateImageSettings { width: number; height: number; mimeType: string; }
export interface ProjectTemplateInfo { id: string; workspaceId: string; name: string; kind: ProjectKind; createdAt: string; retain: ProjectTemplateRetain; sourceRevision?: number; files: number; imageSettings?: ProjectTemplateImageSettings; }
export interface ProjectTemplateInput { workspaceId: string; sourceProjectId: string; sourceArtifactId?: string; kind: ProjectKind; name: string; retain?: ProjectTemplateRetain; workflow?: WorkflowDefinition; }
export interface ProjectTemplateResult { projectId: string; artifacts: ArtifactMetadata[]; workflow?: WorkflowDraft; sourceRevision?: number; imageSettings?: ProjectTemplateImageSettings; }
export interface ProjectTemplatesBridge {
  list: (workspaceId: string) => Promise<ProjectTemplateInfo[]>;
  save: (input: ProjectTemplateInput) => Promise<ProjectTemplateInfo>;
  remove: (input: { workspaceId: string; id: string }) => Promise<void>;
  instantiate: (input: { workspaceId: string; targetProjectId: string; templateId?: string; sourceProjectId?: string; sourceArtifactId?: string; kind: ProjectKind; name: string; mode: 'template' | 'copy' }) => Promise<ProjectTemplateResult>;
}
