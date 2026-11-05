import type { WorkflowRun } from '../configuration-types';
import type { ArtifactMetadata } from '../live-types';
import type { ProjectKind } from '../types';

export const HOME_CREATION_KINDS: { kind: ProjectKind; label: string; title: string; example: string }[] = [
  { kind: 'image', label: '图片', title: '做一张新品宣传图', example: '帮我制作一张产品宣传图，保留真实产品和品牌信息，自动检查并精修一轮。' },
  { kind: 'ppt', label: 'PPT', title: '准备一份品牌提案', example: '制作一份面向合作伙伴的新品发布提案，包含品牌定位、产品亮点、上市安排与配图。' },
  { kind: 'word', label: 'Word', title: '把资料整理成正式文档', example: '把项目资料整理成一份完整的合作说明书，包含目标、工作范围、交付安排和配图。' },
  { kind: 'excel', label: 'Excel', title: '把项目安排得更清楚', example: '制作一份项目排期表，包含任务、负责人、日期、预算和完成情况，加入需要的计算公式。' },
];

export function homeCreationPlanningInput(text: string, kind: ProjectKind, followup: boolean): string {
  if (followup) return text;
  const format = HOME_CREATION_KINDS.find(item => item.kind === kind)!.label;
  const original = text.replace(/\n\n用户在创作界面选择的交付格式：(图片|PPT|Word|Excel)。请按此格式规划制作和检查步骤。$/, '');
  return `${original}\n\n用户在创作界面选择的交付格式：${format}。请按此格式规划制作和检查步骤。`;
}

interface HomeRunContext {
  workspaceId: string; projectId: string; workflowId?: string; ruleId?: string;
  job?: { ruleId: string; runId?: string; dispatchKey: string; workspaceId?: string; projectId?: string };
}
export function homeCreationRun(runs: WorkflowRun[], context: HomeRunContext): WorkflowRun | undefined {
  const { job } = context;
  if (!job || !context.ruleId || job.ruleId !== context.ruleId || job.workspaceId && job.workspaceId !== context.workspaceId || job.projectId && job.projectId !== context.projectId) return undefined;
  return runs.find(run => run.mode === 'live' && run.purpose !== 'automation-plan' && run.workspaceId === context.workspaceId && run.projectId === context.projectId && (!context.workflowId || run.workflowId === context.workflowId) && (run.id === job.runId || !!job.dispatchKey && run.dispatchKey === job.dispatchKey));
}

const officeMimeTypes: Record<Exclude<ProjectKind, 'image'>, string> = {
  word: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
export function homeCreationArtifacts(run: WorkflowRun, kind: ProjectKind): ArtifactMetadata[] {
  for (const attempt of [...run.attempts].reverse()) {
    if (attempt.status !== 'complete') continue;
    const files = (attempt.artifacts || []).filter(file => !file.trashedAt && !file.unavailable && file.bytes > 0 && (!file.projectId || file.projectId === run.projectId) && (kind === 'image' ? file.kind === 'image' && /^image\//.test(file.mimeType) : file.kind === 'office' && file.mimeType === officeMimeTypes[kind]));
    if (files.length) return [...new Map(files.map(file => [file.id, file])).values()];
  }
  return [];
}

export function homeCreationDocumentSource(run: WorkflowRun, kind: ProjectKind, trashedIds: ReadonlySet<string> = new Set()): ArtifactMetadata | undefined {
  if (kind === 'image' || run.mode !== 'live' || run.purpose === 'automation-plan' || run.snapshot.outputKind && run.snapshot.outputKind !== kind) return undefined;
  const exportStep = run.snapshot.steps.filter(step => step.enabled && step.kind === 'export').at(-1);
  const end = exportStep ? run.snapshot.steps.findIndex(step => step.id === exportStep.id) : run.snapshot.steps.length;
  const sources = run.snapshot.steps.slice(0, end).filter(step => step.enabled && !['planner', 'reviewer'].includes(step.role || '') && ['text', 'transcription'].includes(step.kind)).reverse();
  if (exportStep?.contentSourceStepId) sources.sort((first, second) => Number(second.id === exportStep.contentSourceStepId) - Number(first.id === exportStep.contentSourceStepId));
  for (const step of sources) {
    const file = run.attempts.filter(attempt => attempt.stepId === step.id && attempt.status === 'complete').at(-1)?.artifacts?.filter(item => item.kind === 'text' && item.bytes > 0 && !item.trashedAt && !item.unavailable && !trashedIds.has(item.id) && (!item.projectId || item.projectId === run.projectId) && (!item.runId || item.runId === run.id)).at(-1);
    if (file) return file;
  }
  return undefined;
}

export function homeCreationProgress(run: WorkflowRun): { completed: number; total: number; percent: number; label: string } {
  const steps = run.snapshot.steps.filter(step => step.enabled);
  const completed = steps.filter(step => run.attempts.filter(attempt => attempt.stepId === step.id).at(-1)?.status === 'complete').length;
  return { completed, total: steps.length, percent: run.status === 'complete' ? 100 : steps.length ? Math.min(99, Math.round(completed / steps.length * 100)) : 0, label: run.snapshot.steps[run.stepIndex]?.name || '整理制作结果' };
}

export function homeCreationPreviewUrl(dataUrl?: string): string | undefined {
  return dataUrl && /^data:image\/(?:png|jpeg|webp|gif);base64,/.test(dataUrl) ? dataUrl : undefined;
}
