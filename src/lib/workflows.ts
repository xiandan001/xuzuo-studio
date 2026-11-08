import type { ModelCapability, StudioConfiguration, WorkflowDefinition, WorkflowRun, WorkflowStep } from '../configuration-types';
import type { LedgerEntry, Project } from '../types';
import { resolvePrompt } from './prompt-variables';
import { checkedAnimationWorkflowSettings } from './animation-workflow';

export const isModelStep = (step: WorkflowStep): step is WorkflowStep & { kind: ModelCapability } => !['manual-review', 'export', 'animation-compose'].includes(step.kind);
export const activeRun = (run: WorkflowRun) => ['running', 'paused', 'waiting-review'].includes(run.status);
export function workflowStepCost(step: WorkflowStep): number {
  if (!isModelStep(step)) return 0;
  const base = { text: 48, vision: 18, 'image-generation': 150, 'image-editing': 85, transcription: 30, speech: 50, 'video-understanding': 25, 'video-generation': 300 }[step.kind];
  return base * (['image-generation', 'image-editing'].includes(step.kind) ? Math.max(1, Math.min(4, step.count || 1)) : 1);
}
export function workflowStepAction(step: WorkflowStep, retry = false): LedgerEntry['action'] {
  return retry ? '重新生成' : step.kind === 'vision' || step.kind === 'video-understanding' ? 'AI 复核' : step.kind === 'image-editing' ? 'AI 精修' : '初次生成';
}
export function workflowValidation(workflow: WorkflowDefinition, project: Project | undefined, configuration: StudioConfiguration, input: string, variables: Record<string, string>): string {
  if (!project || project.workspaceId !== workflow.workspaceId) return '请选择当前工作区的项目。';
  if (project.kind !== workflow.outputKind) return '关联项目的作品类型与工作流不一致。';
  if (project.budgetCents != null && (!Number.isSafeInteger(project.budgetCents) || project.budgetCents < 0)) return '项目金额上限无效，请填写非负金额或留空。';
  if (!input.trim()) return '请填写本次工作流要完成的需求。';
  const steps = workflow.steps.filter(step => step.enabled);
  if (!steps.length) return '至少启用一个工作流步骤。';
  if (steps[0].inputSource === 'previous') return '第一步没有上一步结果，请将输入来源改为项目需求。';
  for (const step of steps) {
    if (!step.name.trim()) return '每个步骤都需要一个名称。';
    if (step.budgetCents != null && (!Number.isSafeInteger(step.budgetCents) || step.budgetCents < 0)) return `“${step.name}”的单步金额上限无效，请填写非负金额或留空。`;
    if (step.kind === 'animation-compose') { if (project.kind !== 'image') return '本地动画合成仅用于图片项目。'; try { checkedAnimationWorkflowSettings(step.animation); } catch (error) { return error instanceof Error ? error.message : '本地动画参数无效。'; } if (step.imageSourceStepId !== undefined) { const source = steps.find(item => item.id === step.imageSourceStepId); if (!source || !['image-generation','image-editing'].includes(source.kind) || steps.indexOf(source) >= steps.indexOf(step) || (source.imageOutputFormat ?? 'png') !== 'png' || (source.count ?? 1) !== 1) return '本地动画来源必须是前面的一份PNG制作结果。'; } }
    if (!isModelStep(step)) continue;
    if (!step.prompt.trim()) return `“${step.name}”还没有填写提示词。`;
    const resolution = resolvePrompt(step.prompt, variables);
    if (!resolution.complete) return `“${step.name}”缺少变量：${resolution.missing.join('、')}。`;
    const model = configuration.models.find(item => item.id === step.modelConfigId && item.enabled);
    if (!model || !model.capabilities.includes(step.kind)) return `“${step.name}”需要选择具有对应能力的启用模型。`;
    if (!configuration.connections.some(item => item.id === model.connectionId && item.enabled)) return `“${step.name}”的模型连接已停用。`;
    if (step.credentialId && !configuration.credentials.some(item => item.id === step.credentialId && item.connectionId === model.connectionId && item.enabled)) return `“${step.name}”所选凭证不可用，请重新选择或改为仅模拟。`;
    if (step.budgetCents != null && step.budgetCents < workflowStepCost(step)) return `“${step.name}”的单步预算不足，需覆盖本步演示费用。`;
  }
  const total = steps.reduce((sum, step) => sum + workflowStepCost(step), 0);
  if (project.budgetCents != null && project.costCents + total > project.budgetCents) return '项目剩余预算不足以覆盖这次模拟流程，请先调整项目预算。';
  return '';
}
export function recoverWorkflowRuns(runs: WorkflowRun[]): WorkflowRun[] {
  return runs.map(run => run.status === 'running' ? { ...run, status: 'interrupted', attempts: run.attempts.map(attempt => attempt.status === 'running' ? { ...attempt, status: 'cancelled', summary: '应用关闭或刷新导致中断，已发生的演示费用保留。' } : attempt) } : run);
}
export function readWorkflowRuns(raw: string | null): WorkflowRun[] {
  try { const data = JSON.parse(raw || '[]') as WorkflowRun[]; return Array.isArray(data) ? recoverWorkflowRuns(data.map(run => ({ ...run, snapshot: { ...run.snapshot, steps: run.snapshot.steps.map(step => ({ ...step, budgetCents: step.budgetCents ?? undefined })) } }))) : []; }
  catch { return []; }
}
export function stepInput(run: WorkflowRun, step: WorkflowStep): string {
  if (step.inputSource === 'project') return run.input;
  const position = run.snapshot.steps.findIndex(item => item.id === step.id);
  const preceding = run.snapshot.steps.slice(0, Math.max(0, position)).filter(item => item.enabled && isModelStep(item)).reverse();
  for (const previous of preceding) {
    const result = run.attempts.filter(attempt => attempt.stepId === previous.id && attempt.status === 'complete').at(-1);
    if (result) return result.summary;
  }
  return run.input;
}
