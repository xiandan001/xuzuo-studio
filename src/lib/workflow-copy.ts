import type { WorkflowDefinition } from '../configuration-types';

export function copyWorkflow(source: WorkflowDefinition, newId: () => string = () => crypto.randomUUID()): WorkflowDefinition {
  const ids = new Map(source.steps.map(step => [step.id, newId()]));
  if (ids.size !== source.steps.length) throw new Error('源工作流有重复步骤编号，请先修复步骤后再复制。');
  const copy = structuredClone(source);
  return {
    ...copy,
    id: newId(),
    name: `${source.name}（副本）`,
    updatedAt: new Date().toLocaleString('zh-CN'),
    steps: copy.steps.map(step => ({
      ...step,
      id: ids.get(step.id)!,
      ...(step.contentSourceStepId ? { contentSourceStepId: ids.get(step.contentSourceStepId) || step.contentSourceStepId } : {}),
      ...(step.contentSourceStepIds ? { contentSourceStepIds: step.contentSourceStepIds.map(id => ids.get(id) || id) } : {}),
      ...(step.imageSourceStepId ? { imageSourceStepId: ids.get(step.imageSourceStepId) || step.imageSourceStepId } : {}),
      ...(step.documentImageStepIds ? { documentImageStepIds: step.documentImageStepIds.map(id => ids.get(id) || id) } : {}),
      ...(step.qualityGate ? { qualityGate: { ...step.qualityGate, ...(step.qualityGate.repairStepId ? { repairStepId: ids.get(step.qualityGate.repairStepId) || step.qualityGate.repairStepId } : {}) } } : {}),
    })),
  };
}
