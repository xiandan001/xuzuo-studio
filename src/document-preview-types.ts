import type { WorkflowRunner } from './configuration-types';
export interface DocumentPreviewImageContext {
  scope: string;
  projectId: string;
  runner: Pick<WorkflowRunner, 'listProjectArtifacts' | 'thumbnailArtifact' | 'previewArtifact'>;
  onEditUnit?: (unitId: string) => void;
}
