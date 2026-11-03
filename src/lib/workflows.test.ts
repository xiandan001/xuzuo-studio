import { describe, expect, it } from 'vitest';
import { INITIAL_CONNECTIONS, INITIAL_MODELS } from '../model-presets';
import type { StudioConfiguration, WorkflowDefinition, WorkflowRun } from '../configuration-types';
import type { Project } from '../types';
import { readWorkflowRuns, recoverWorkflowRuns, stepInput, workflowStepAction, workflowStepCost, workflowValidation } from './workflows';

const configuration = { models: INITIAL_MODELS, connections: INITIAL_CONNECTIONS, credentials: [] } as unknown as StudioConfiguration;
const project: Project = { id: 'p', workspaceId: 'a', kind: 'ppt', name: '演示', description: '', status: 'draft', costCents: 0, budgetCents: 1000, updatedAt: '', version: 0, accent: 'purple' };
const workflow: WorkflowDefinition = { id: 'w', workspaceId: 'a', name: '示例', description: '', outputKind: 'ppt', updatedAt: '', steps: [
  { id: 's1', name: '整理', kind: 'text', prompt: '为{{主题}}整理内容', modelConfigId: 'demo-text', inputSource: 'project', budgetCents: 100, enabled: true },
  { id: 's2', name: '检查', kind: 'manual-review', prompt: '', inputSource: 'previous', budgetCents: 0, enabled: true },
] };
describe('工作流模拟校验和累计费用边界', () => {
  it('保存后的有效模拟流程不需要真实密钥', () => { expect(workflowValidation(workflow, project, configuration, '一份提案', { 主题: '茶园' })).toBe(''); });
  it('拒绝跨工作区和不同作品类型关联', () => {
    expect(workflowValidation(workflow, { ...project, workspaceId: 'b' }, configuration, '需求', { 主题: '茶园' })).not.toBe('');
    expect(workflowValidation(workflow, { ...project, kind: 'image' }, configuration, '需求', { 主题: '茶园' })).not.toBe('');
  });
  it('缺变量或第一步引用上一步时不能执行', () => {
    expect(workflowValidation(workflow, project, configuration, '需求', {})).toContain('缺少变量');
    expect(workflowValidation({ ...workflow, steps: [{ ...workflow.steps[0], inputSource: 'previous' }] }, project, configuration, '需求', { 主题: '茶园' })).toContain('第一步');
  });
  it('模型能力或凭证不匹配时拦截', () => {
    expect(workflowValidation({ ...workflow, steps: [{ ...workflow.steps[0], kind: 'image-generation' }] }, project, configuration, '需求', { 主题: '茶园' })).toContain('对应能力');
    expect(workflowValidation({ ...workflow, steps: [{ ...workflow.steps[0], credentialId: 'missing' }] }, project, configuration, '需求', { 主题: '茶园' })).toContain('凭证不可用');
  });
  it('手动步骤不产生模型费用，重试使用独立的重生成动作', () => {
    expect(workflow.steps.reduce((sum, step) => sum + workflowStepCost(step), 0)).toBe(48);
    expect(workflowStepCost(workflow.steps[1])).toBe(0);
    expect(workflowStepAction(workflow.steps[0], true)).toBe('重新生成');
  });
  it('单步及整个项目预算均检查', () => {
    expect(workflowValidation({ ...workflow, steps: [{ ...workflow.steps[0], budgetCents: 1 }] }, project, configuration, '需求', { 主题: '茶园' })).toContain('单步预算');
    expect(workflowValidation(workflow, { ...project, costCents: 980 }, configuration, '需求', { 主题: '茶园' })).toContain('剩余预算');
  });
  it('不填写项目和单步上限可运行，模拟费用仍按步骤累计', () => {
    const unbounded = { ...workflow, steps: workflow.steps.map(step => ({ ...step, budgetCents: undefined })) };
    expect(workflowValidation(unbounded, { ...project, costCents: 5000, budgetCents: undefined }, configuration, '需求', { 主题: '茶园' })).toBe('');
    expect(unbounded.steps.reduce((sum, step) => sum + workflowStepCost(step), 0)).toBe(48);
  });
  it('零元是明确上限，不会因可选字段变成无限制', () => {
    const unbounded = { ...workflow, steps: workflow.steps.map(step => ({ ...step, budgetCents: undefined })) };
    expect(workflowValidation(unbounded, { ...project, budgetCents: 0 }, configuration, '需求', { 主题: '茶园' })).toContain('剩余预算');
    expect(workflowValidation({ ...workflow, steps: [{ ...workflow.steps[0], budgetCents: 0 }] }, { ...project, budgetCents: undefined }, configuration, '需求', { 主题: '茶园' })).toContain('单步预算');
  });
  it('负数、小数、非数及数字字符串上限均拒绝', () => {
    for (const value of [-1, 0.5, NaN, Infinity, '100', '']) {
      expect(workflowValidation(workflow, { ...project, budgetCents: value as number }, configuration, '需求', { 主题: '茶园' })).toContain('无效');
      expect(workflowValidation({ ...workflow, steps: [{ ...workflow.steps[0], budgetCents: value as number }] }, project, configuration, '需求', { 主题: '茶园' })).toContain('无效');
    }
  });
  it('存量null步骤上限读取为undefined，原有0和其它数值保持', () => {
    const run = { id: 'legacy', status: 'complete', snapshot: { ...workflow, steps: [{ ...workflow.steps[0], budgetCents: null }, workflow.steps[1], { ...workflow.steps[0], id: 'limited', budgetCents: 500 }] }, attempts: [] };
    const restored = readWorkflowRuns(JSON.stringify([run]))[0];
    expect(restored.snapshot.steps.map(step => step.budgetCents)).toEqual([undefined, 0, 500]);
    expect(workflowValidation({ ...workflow, steps: [{ ...workflow.steps[0], budgetCents: null as unknown as number }] }, { ...project, budgetCents: null as unknown as number }, configuration, '需求', { 主题: '茶园' })).toBe('');
  });
  it('中断保留尝试费用和输入快照，不把运行中状态当完成', () => {
    const run = { id: 'run', workspaceId: 'a', projectId: 'p', workflowId: 'w', workflowName: '示例', snapshot: workflow, status: 'running', stepIndex: 0, attempts: [{ id: 'a1', stepId: 's1', stepName: '整理', modelLabel: '演示', status: 'running', costCents: 48, summary: '', input: '原需求', prompt: '已解析的需求', action: '初次生成' }], variables: {}, input: '原需求', createdAt: '', updatedAt: '' } as WorkflowRun;
    const recovered = recoverWorkflowRuns([run])[0];
    expect(recovered.status).toBe('interrupted'); expect(recovered.attempts[0].status).toBe('cancelled'); expect(recovered.attempts[0].costCents).toBe(48); expect(run.status).toBe('running');
  });
  it('上一步输入来自模型的完成结果，不拿人工等待文字替代内容', () => {
    const run = { snapshot: workflow, input: '需求', attempts: [{ stepId: 's1', status: 'complete', summary: '模型结果' }, { stepId: 's2', status: 'complete', summary: '等待人工确认' }] } as WorkflowRun;
    expect(stepInput(run, workflow.steps[1])).toBe('模型结果');
  });
  it('重试中间步骤只读取流程中前置步骤，不读取自身或后续旧输出', () => {
    const middle = { ...workflow.steps[0], id: 'middle', inputSource: 'previous' as const };
    const last = { ...workflow.steps[0], id: 'last' };
    const run = { snapshot: { ...workflow, steps: [workflow.steps[0], middle, last] }, input: '需求', attempts: [{ stepId: 's1', status: 'complete', summary: '前置结果' }, { stepId: 'middle', status: 'complete', summary: '中间旧结果' }, { stepId: 'last', status: 'complete', summary: '最后旧结果' }] } as WorkflowRun;
    expect(stepInput(run, middle)).toBe('前置结果');
  });
});
