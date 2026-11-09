import type { ModelCapability, StudioConfiguration, WorkflowDefinition } from '../configuration-types';
import type { Project } from '../types';
import type { NaturalAutomationPlan } from '../natural-automation-types';
import type { NaturalAutomationBindings } from './natural-automation-plan';
import { naturalModelSelection, type NaturalBinding } from '../components/NaturalAutomationModels';
import { normalizeReasoningEffort } from './reasoning-options';

export const naturalKindLabel = { word: 'Word 文档', ppt: 'PPT 演示', excel: 'Excel 表格', image: '图片' };
export const naturalQuestionAnswer = (answers: Record<string, string>, question: string): string => Object.hasOwn(answers, question) && typeof answers[question] === 'string' ? answers[question] : '';
export function naturalTargetProject(projects: Project[], currentId: string, kind: Project['kind']): string {
  const compatible = projects.filter(project => !project.trashedAt && !project.purgedAt && project.kind === kind);
  return compatible.some(project => project.id === currentId) ? currentId : compatible.length === 1 ? compatible[0].id : currentId;
}
export function naturalEffectiveBindings(configuration: StudioConfiguration, bindings: NaturalAutomationBindings, planner: NaturalBinding): NaturalAutomationBindings {
  const next = { ...bindings };
  if (!next.text?.modelConfigId && !next.text?.credentialId) next.text = planner;
  const reuse = (capability: keyof NaturalAutomationBindings, selected: NaturalBinding | undefined) => {
    if (next[capability]?.modelConfigId || next[capability]?.credentialId || !selected?.modelConfigId) return;
    const source = configuration.models.find(model => model.id === selected.modelConfigId && model.enabled && !model.demo && model.capabilities.includes(capability));
    if (source) next[capability] = { ...selected };
  };
  reuse('vision', next.text);
  const generation = naturalModelSelection(configuration, 'image-generation', next['image-generation']);
  reuse('image-editing', generation.model ? { modelConfigId: generation.model.id, credentialId: generation.credentialId } : undefined);
  return next;
}
export function naturalRuleInput(plan: NaturalAutomationPlan, base: string, answers: Record<string, string>): string {
  const marker = base.lastIndexOf('\n\n【用户补充的制作资料】\n');
  if (marker >= 0) base = base.slice(0, marker);
  const supplied = plan.questions.flatMap(question => { const answer = naturalQuestionAnswer(answers, question).trim(); return answer ? [`问题：${question}\n用户补充：${answer}`] : []; });
  return supplied.length ? `${base}\n\n【用户补充的制作资料】\n${supplied.join('\n\n')}` : base;
}
export function naturalPreparationMissing(plan: NaturalAutomationPlan, answers: Record<string, string>): string[] {
  return plan.questions.filter(question => !naturalQuestionAnswer(answers, question).trim()).map(question => `制作资料：${question}`);
}
export function naturalBoundWorkflow(workflow: WorkflowDefinition, configuration: StudioConfiguration, bindings: NaturalAutomationBindings, changedCapabilities?: (keyof NaturalAutomationBindings)[]): WorkflowDefinition {
  return { ...workflow, steps: workflow.steps.map(step => {
    if (!['text', 'vision', 'image-generation', 'image-editing'].includes(step.kind)) return step;
    const explicitlyChanged = !changedCapabilities || changedCapabilities.includes(step.kind as keyof NaturalAutomationBindings);
    if (!explicitlyChanged && step.modelConfigId && step.credentialId) return step;
    const preferred = explicitlyChanged || !step.modelConfigId && !step.credentialId ? bindings[step.kind as keyof NaturalAutomationBindings] : { modelConfigId: step.modelConfigId, credentialId: step.credentialId, reasoningEffort: step.reasoningEffort };
    const chosen = naturalModelSelection(configuration, step.kind as ModelCapability, preferred);
    return { ...step, modelConfigId: chosen.model?.id, credentialId: chosen.credentialId, ...(['text', 'vision'].includes(step.kind) && (preferred?.reasoningEffort !== undefined || step.reasoningEffort !== undefined) ? { reasoningEffort: preferred?.reasoningEffort === undefined ? undefined : normalizeReasoningEffort(configuration.connections.find(connection => connection.id === chosen.model?.connectionId), chosen.model, preferred.reasoningEffort) } : {}) };
  }) };
}
