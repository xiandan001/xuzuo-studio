import type { WorkflowRun } from '../configuration-types';
import type { EditorKind } from '../editor-types';
import type { ArtifactMetadata } from '../live-types';

export interface EditorExportProof { projectId: string; revision: number; artifacts: ArtifactMetadata[]; }
const MIME = { word: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ppt: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
function sourceRevision(value: object): number | undefined {
  const revision = 'sourceRevision' in value ? value.sourceRevision : undefined;
  return typeof revision === 'number' && Number.isSafeInteger(revision) && revision > 0 ? revision : undefined;
}
export function editorExportArtifacts(projectId: string, kind: EditorKind | 'excel', revision: number | undefined, runs: WorkflowRun[], local?: EditorExportProof, trashed: ArtifactMetadata[] = []): ArtifactMetadata[] {
  if (!revision || !Number.isSafeInteger(revision) || revision < 1) return [];
  const candidates: ArtifactMetadata[] = local?.projectId === projectId && local.revision === revision ? [...local.artifacts] : [];
  for (const run of runs) {
    if (run.mode !== 'live' || run.projectId !== projectId || run.snapshot.outputKind !== kind) continue;
    for (const attempt of run.attempts) {
      if (attempt.status !== 'complete' || (sourceRevision(attempt) ?? sourceRevision(run)) !== revision || !run.snapshot.steps.some(step => step.id === attempt.stepId && step.kind === 'export')) continue;
      candidates.push(...attempt.artifacts || []);
    }
  }
  const deleted = new Set(trashed.map(item => item.id));
  const unavailable = new Set(candidates.filter(item => item.unavailable || item.trashedAt).map(item => item.id));
  return [...new Map(candidates.filter(item => item.projectId === projectId && item.kind === 'office' && item.mimeType === MIME[kind] && !unavailable.has(item.id) && !deleted.has(item.id)).map(item => [item.id, item])).values()];
}
