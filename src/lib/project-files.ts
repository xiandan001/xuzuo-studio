import type { WorkflowAttempt, WorkflowRun } from '../configuration-types';
import type { ArtifactMetadata } from '../live-types';

export type ProjectFileGroup = 'office' | 'image' | 'source' | 'report' | 'text' | 'other' | 'trash';
export interface ProjectFileItem { artifact: ArtifactMetadata; sourceRevision?: number; group: ProjectFileGroup; description?: string; }
const DOCUMENT_LABEL = { word: 'Word', ppt: 'PPT', excel: 'Excel' };
function filePresentation(run: WorkflowRun, attempt: WorkflowAttempt, artifact: ArtifactMetadata): Pick<ProjectFileItem, 'group' | 'description'> {
  if (artifact.kind === 'office' || artifact.kind === 'image') return { group: artifact.kind };
  if (artifact.kind !== 'text') return { group: 'other' };
  const step = run.snapshot.steps.find(item => item.id === attempt.stepId);
  if (artifact.runId !== run.id || attempt.status !== 'complete' || !step) return { group: 'text' };
  if (step.kind === 'export' && /(?:检查报告|check[-_ ]?report)\.json$/i.test(artifact.name)) return { group: 'report', description: '本地导出检查报告，不是正式文档' };
  if (step.kind === 'text' && /^(?:AI\s*复核|人工智能复核|检查报告|审查报告|review|audit)$/i.test(step.name.trim())) return { group: 'report', description: '模型检查意见，不是正式文档' };
  if (run.snapshot.outputKind === 'image' || !['text', 'transcription'].includes(step.kind)) return { group: 'text' };
  const exporter = run.snapshot.steps.filter(item => item.enabled && item.kind === 'export').at(-1);
  const before = exporter ? run.snapshot.steps.slice(0, run.snapshot.steps.indexOf(exporter)) : run.snapshot.steps;
  const contentStepId = exporter?.contentSourceStepId || before.filter(item => item.enabled && ['text', 'transcription'].includes(item.kind)).at(-1)?.id;
  return contentStepId === step.id ? { group: 'source', description: `${DOCUMENT_LABEL[run.snapshot.outputKind]} 生成源稿 · 中间文件` } : { group: 'text' };
}
export function projectFiles(runs: WorkflowRun[], projectId: string, trashed: ArtifactMetadata[] = []): ProjectFileItem[] {
  const deleted = new Set(trashed.map(artifact => artifact.id));
  const files = new Map<string, ProjectFileItem>();
  const ordered = runs.filter(run => run.mode === 'live' && run.projectId === projectId).slice().sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
  for (const run of ordered) {
    const revision = 'sourceRevision' in run && typeof run.sourceRevision === 'number' && Number.isSafeInteger(run.sourceRevision) && run.sourceRevision > 0 ? run.sourceRevision : undefined;
    for (const attempt of run.attempts) for (const artifact of attempt.artifacts || []) {
      if (artifact.projectId && artifact.projectId !== projectId || artifact.trashedAt || deleted.has(artifact.id)) continue;
      const presentation = filePresentation(run, attempt, artifact), existing = files.get(artifact.id);
      if (existing) {
        const provenance = existing.group === 'text' && ['source', 'report'].includes(presentation.group) ? presentation : {};
        files.set(artifact.id, { ...existing, ...provenance, ...(!existing.sourceRevision && revision ? { sourceRevision: revision } : {}) });
        continue;
      }
      files.set(artifact.id, { artifact, ...presentation, ...(revision ? { sourceRevision: revision } : {}) });
    }
  }
  return [...files.values()];
}
