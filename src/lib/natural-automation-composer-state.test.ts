import { describe, expect, it } from 'vitest';
import type { StudioConfiguration, WorkflowDefinition } from '../configuration-types';
import type { Project } from '../types';
import type { NaturalAutomationPlan } from '../natural-automation-types';
import { naturalBoundWorkflow, naturalEffectiveBindings, naturalPreparationMissing, naturalRuleInput, naturalTargetProject } from './natural-automation-composer-state';

const model = (id: string, connectionId: string, capabilities: string[]) => ({ id, name: id, modelId: id, connectionId, capabilities, pricing: { unit: 'request', currency: 'CNY', input: '', output: '0.1' }, enabled: true });
const configuration = { models: [model('text', 'text-connection', ['text', 'vision']), model('pictures', 'image-connection', ['image-generation', 'image-editing'])], connections: [{ id: 'text-connection', enabled: true, protocol: 'openai-chat' }, { id: 'image-connection', enabled: true, protocol: 'image' }], credentials: [{ id: 'text-key', connectionId: 'text-connection', enabled: true }, { id: 'image-key', connectionId: 'image-connection', enabled: true }] } as StudioConfiguration;
describe('自动化创建和运行准备分开', () => {
  it('只自动复用已经选择或唯一可用的兼容模型，不改写原偏好', () => {
    const preferred = { text: { modelConfigId: 'text', credentialId: 'text-key' } }, before = JSON.stringify(preferred);
    const resolved = naturalEffectiveBindings(configuration, preferred, preferred.text);
    expect(resolved.vision).toEqual(preferred.text);
    expect(resolved['image-editing']).toEqual({ modelConfigId: 'pictures', credentialId: 'image-key' });
    expect(JSON.stringify(preferred)).toBe(before);
  });
  it('独立选过的看图或精修模型不会因默认复用而被替换', () => {
    const explicit = { vision: { modelConfigId: 'disabled-model', credentialId: 'original-key' }, 'image-editing': { modelConfigId: 'my-editor', credentialId: 'my-key' } };
    const resolved = naturalEffectiveBindings(configuration, explicit, { modelConfigId: 'text', credentialId: 'text-key' });
    expect(resolved.vision).toEqual(explicit.vision); expect(resolved['image-editing']).toEqual(explicit['image-editing']);
  });
  it('只有唯一匹配项目才自动修复目标类型，不随机挑多个同类项目', () => {
    const projects = [{ id: 'image-project', kind: 'image' }, { id: 'word-project', kind: 'word' }] as Project[];
    expect(naturalTargetProject(projects, 'image-project', 'word')).toBe('word-project');
    expect(naturalTargetProject([...projects, { id: 'second-word', kind: 'word' } as Project], 'image-project', 'word')).toBe('image-project');
    expect(naturalTargetProject([...projects, { id: 'second-word', kind: 'word' } as Project], 'word-project', 'word')).toBe('word-project');
  });
  it('制作问答能本地追加和更新，不重复堆叠旧答案', () => {
    const plan = { questions: ['商品叫什么？', '风格？'] } as NaturalAutomationPlan;
    expect(naturalPreparationMissing(plan, {})).toHaveLength(2);
    expect(naturalPreparationMissing(plan, { '商品叫什么？': '绿茶', '风格？': ' ' })).toEqual(['制作资料：风格？']);
    const first = naturalRuleInput(plan, '制作产品海报', { '商品叫什么？': '绿茶' });
    const second = naturalRuleInput(plan, first, { '商品叫什么？': '乌龙茶', '风格？': '自然' });
    expect(second).toContain('乌龙茶'); expect(second).not.toContain('用户补充：绿茶'); expect(second.match(/【用户补充的制作资料】/g)).toHaveLength(1);
  });
  it('AI问题即使与对象原型属性同名，也只当资料文字，不当已填写答案', () => {
    const plan = { questions: ['toString', 'constructor', '__proto__'] } as NaturalAutomationPlan;
    expect(naturalPreparationMissing(plan, {})).toHaveLength(3);
    expect(naturalRuleInput(plan, '制作海报', {})).toBe('制作海报');
    expect(naturalPreparationMissing(plan, Object.fromEntries([['constructor', '这是用户实际填的答案']]))).toHaveLength(2);
  });
  it('保存运行模型绑定保留原步骤ID、真实原图引用和未改的其他能力', () => {
    const workflow = { id: 'flow', steps: [{ id: 'draft', kind: 'image-generation', enabled: true }, { id: 'edit', kind: 'image-editing', enabled: true, imageSourceStepId: 'draft' }, { id: 'audio', kind: 'speech', enabled: true, modelConfigId: 'existing-audio', credentialId: 'existing-audio-key' }] } as WorkflowDefinition;
    const before = JSON.stringify(workflow);
    const bound = naturalBoundWorkflow(workflow, configuration, { 'image-generation': { modelConfigId: 'pictures', credentialId: 'image-key' }, 'image-editing': { modelConfigId: 'pictures', credentialId: 'image-key' } });
    expect(bound.steps[1]).toMatchObject({ id: 'edit', imageSourceStepId: 'draft', modelConfigId: 'pictures', credentialId: 'image-key' });
    expect(bound.steps[2]).toEqual(workflow.steps[2]); expect(JSON.stringify(workflow)).toBe(before);
  });
  it('只补制作资料不会覆盖高级流程已经分别选择的模型或Key', () => {
    const workflow = { id: 'custom-flow', steps: [{ id: 'write', kind: 'text', enabled: true, modelConfigId: 'writer-a', credentialId: 'writer-key' }, { id: 'review', kind: 'text', enabled: true, modelConfigId: 'reviewer-b', credentialId: 'reviewer-key' }] } as WorkflowDefinition;
    const unchanged = naturalBoundWorkflow(workflow, configuration, { text: { modelConfigId: 'text', credentialId: 'text-key' } }, []);
    expect(unchanged.steps).toEqual(workflow.steps);
    const confirmed = naturalBoundWorkflow(workflow, configuration, { text: { modelConfigId: 'text', credentialId: 'text-key' } }, ['text']);
    expect(confirmed.steps.map(step => [step.id, step.modelConfigId, step.credentialId])).toEqual([['write', 'text', 'text-key'], ['review', 'text', 'text-key']]);
  });
});
