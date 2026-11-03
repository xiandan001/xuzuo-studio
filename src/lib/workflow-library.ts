import type { StudioConfiguration, WorkflowDefinition } from '../configuration-types';
import { workflowSelections } from './studio-run';

export function workflowConfigurationSummary(workflow: WorkflowDefinition, configuration: Pick<StudioConfiguration, 'models' | 'connections' | 'credentials'>) {
  const selected = workflowSelections(workflow, configuration);
  const enabled = selected.steps.filter(step => step.enabled);
  const issues: { stepId: string; message: string }[] = [];
  if (!enabled.length) issues.push({ stepId: selected.steps[0]?.id || '', message: '需要至少一个启用步骤' });
  for (const step of enabled) {
    if (step.kind === 'manual-review' || step.kind === 'export') continue;
    const model = configuration.models.find(item => item.id === step.modelConfigId);
    if (!step.prompt.trim()) issues.push({ stepId: step.id, message: `${step.name}：填写提示词` });
    if (!model) issues.push({ stepId: step.id, message: `${step.name}：选择模型` });
    else if (model.demo) issues.push({ stepId: step.id, message: `${step.name}：当前为模拟模型` });
    else if (!configuration.credentials.some(item => item.id === step.credentialId && item.enabled && item.connectionId === model.connectionId)) issues.push({ stepId: step.id, message: `${step.name}：选择 API Key` });
  }
  return { workflow: selected, enabled, issues, ready: issues.length === 0 };
}
