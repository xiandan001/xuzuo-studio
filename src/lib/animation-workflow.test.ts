import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { Project } from '../types';
import type { NaturalAutomationPlan } from '../natural-automation-types';
import type { StudioConfiguration, WorkflowDefinition } from '../configuration-types';
import { ANIMATION_STYLES, newAnimationDocument, resizeAnimationEntries } from './animation-document';
import { animationRequestMode, checkedAnimationWorkflowSettings, defaultAnimationWorkflowSettings, makeAnimationWorkflow } from './animation-workflow';
import { compileNaturalAutomationPlan } from './natural-automation-plan';
import { workflowStepCost, workflowValidation } from './workflows';
import { workflowSelections } from './studio-run';
import { workflowConfigurationSummary } from './workflow-library';
import { readConfigurationResult } from './configuration';

const require = createRequire(import.meta.url), native = require('../../electron/animation-document.runtime.cjs');
type Configuration = Pick<StudioConfiguration, 'models' | 'connections' | 'credentials' | 'workflows'>;
const project: Project = { id: 'animation-project', workspaceId: 'workspace', name: '动画样片', kind: 'image', description: '', status: 'draft', version: 0, costCents: 0, updatedAt: '', accent: 'blue' };
function configuration(): Configuration { return { models: [{ id: 'image-model', name: '任意已适配PNG模型', modelId: 'synthetic-png-model', connectionId: 'image-connection', capabilities: ['image-generation','image-editing'], enabled: true, pricing: { unit: 'image', currency: 'CNY', input: '0', output: '0.02' } }], connections: [{ id: 'image-connection', name: '合成连接', providerId: 'custom', protocol: 'image', baseUrl: 'https://synthetic.invalid/v1', status: 'configured', enabled: true }], credentials: [{ id: 'image-key', name: '元数据', connectionId: 'image-connection', enabled: true, lastFour: 'none', updatedAt: '' }], workflows: [] }; }
function plan(objective = '制作一张挥手的GIF表情包'): NaturalAutomationPlan { return { version: 1, name: '角色GIF', objective, outputKind: 'image', trigger: { type: 'manual' }, steps: [{ kind: 'image-generation', name: '制作角色', instruction: objective }], illustrations: { mode: 'none', count: 0 }, acceptance: ['角色一致，实际动画可播放'], constraints: [], maxRepairs: 0, questions: [], unsupported: [] }; }

describe('角色图集/GIF的受限自动化编译与费用分类', () => {
  it('九种风格都生成PNG→本地合成→人工检查，一个样片而非把图集冒充GIF', () => {
    for (const style of ANIMATION_STYLES) { const document = { ...resizeAnimationEntries(newAnimationDocument(project.id), 3), style: style.id, ...style.defaults, columns: style.grid[0], rows: style.grid[1] }, workflow = makeAnimationWorkflow(document, configuration());
      expect(workflow.steps.map(step => step.kind)).toEqual(['image-generation','animation-compose','manual-review']); expect(workflow.steps[0]).toMatchObject({ imageOutputFormat: 'png', count: 1, modelConfigId: 'image-model', credentialId: 'image-key' }); expect(workflow.steps[1].imageSourceStepId).toBe(workflow.steps[0].id); expect(workflow.steps[1].animation?.entries).toHaveLength(1); expect(workflow.steps.some(step => step.kind === 'export')).toBe(false); expect(workflow.steps[1].modelConfigId).toBeUndefined(); expect(workflow.steps[1].credentialId).toBeUndefined();
      expect(native.makeAnimationWorkflow(document, configuration())).toEqual(workflow);
    }
  });
  it('真实参考图选择image-editing，PNG模型不需要能直接输出GIF', () => {
    const doc = { ...newAnimationDocument(project.id), referenceArtifactIds: ['reference-one'], modelConfigId: 'image-model', credentialId: 'image-key' }, result = makeAnimationWorkflow(doc, configuration()); expect(result.steps[0]).toMatchObject({ kind: 'image-editing', referenceArtifactIds: ['reference-one'], imageOutputFormat: 'png' }); expect(result.steps[1].animation?.mode).toBe('gif'); expect(result.steps[0].imageOutputFormat).not.toBe('gif');
  });
  it('本地参数拒绝自由命令、坏尺寸、超16条目、缺格和多条目连续动作', () => {
    const defaults = defaultAnimationWorkflowSettings();
    for (const value of [{ ...defaults, command: 'run arbitrary code' }, { ...defaults, fps: NaN }, { ...defaults, width: 4096 }, { ...defaults, entries: [{ caption: 'A' }, { caption: 'B' }] }, { ...defaults, columns: 1, rows: 1 }, { ...defaults, mode: 'atlas', columns: 8, rows: 8, entries: Array.from({ length: 17 }, () => ({ caption: 'A' })) }]) expect(() => checkedAnimationWorkflowSettings(value)).toThrow();
    expect(checkedAnimationWorkflowSettings({ ...defaults, mode: 'atlas', columns: 4, rows: 4, entries: Array.from({ length: 16 }, () => ({ caption: 'A' })) }).entries).toHaveLength(16);
  });
  it('自然语言GIF只需图片模型，无额外文字规划模型，不依赖某个原生GIF供应商', () => {
    const result = compileNaturalAutomationPlan(plan(), project, configuration()); expect(result.missing).toEqual([]); expect(result.workflow.steps.map(step => step.kind)).toEqual(['image-generation','animation-compose','manual-review']); expect(result.workflow.name).toContain('单个样片'); expect(result.stepsSummary[1]).toContain('本地，不调用模型');
    const compiled = require('../../electron/natural-automation-plan.runtime.cjs').compileNaturalAutomationPlan(plan(), project, configuration()); expect(compiled).toEqual(result);
  });
  it('角色图集独立编译成PNG拆分，否定GIF不抹掉明确图集用途', () => {
    expect(animationRequestMode('不要GIF，只做角色图集')).toBe('atlas'); expect(animationRequestMode('不需要GIF，只做角色图集')).toBe('atlas'); expect(animationRequestMode('将角色图集做成GIF')).toBe('gif'); expect(animationRequestMode('普通海报，不要GIF')).toBeUndefined();
    const result = compileNaturalAutomationPlan(plan('制作一张角色图集PNG，包含多个表情'), project, configuration()); expect(result.workflow.steps[1].animation?.mode).toBe('atlas'); expect(result.workflow.steps[1].name).toContain('PNG');
  });
  it('明确图片精修轮次保留PNG检查与精修，最后本地合成准确采用精修源图', () => {
    const config = configuration(); config.models.push({ id: 'vision-model', name: '看图fixture', modelId: 'vision', connectionId: 'vision-connection', capabilities: ['vision'], enabled: true, pricing: { unit: 'million-tokens', currency: 'CNY', input: '1', output: '1' } }); config.connections.push({ id: 'vision-connection', name: '看图', providerId: 'custom', protocol: 'openai-chat', baseUrl: 'https://synthetic.invalid/v1', enabled: true, status: 'configured' }); config.credentials.push({ id: 'vision-key', name: '元数据', connectionId: 'vision-connection', enabled: true, lastFour: '', updatedAt: '' });
    const result = compileNaturalAutomationPlan({ ...plan(), maxRepairs: 1 }, project, config); expect(result.missing).toEqual([]); expect(result.workflow.steps.map(step => step.kind)).toEqual(['image-generation','vision','image-editing','animation-compose','manual-review']); expect(result.workflow.steps[3].imageSourceStepId).toBe(result.workflow.steps[2].id); expect(result.workflow.steps[2].imageOutputFormat).toBe('png'); expect(result.workflow.steps[1].prompt).toContain('不要声称看过尚未合成的GIF');
  });
  it('SVG/GIF原图和超过12参考不悄悄丢弃后重新纯文字生图', () => {
    const reference = { id: 'reference', name: '原图.gif', mimeType: 'image/gif', kind: 'image' as const, bytes: 100 }; expect(() => compileNaturalAutomationPlan(plan(), { ...project, referenceFiles: [reference] }, configuration())).toThrow('静态参考图'); expect(() => compileNaturalAutomationPlan(plan(), { ...project, referenceFiles: Array.from({ length: 13 }, (_, index) => ({ ...reference, id: 'reference-' + index, mimeType: 'image/png' })) }, configuration())).toThrow('最多12张');
  });
  it('本地步骤不需要模型Key、不计模拟费用，序列化后保留全部白名单合成参数', () => {
    const config = configuration(), draft = makeAnimationWorkflow(newAnimationDocument(project.id), config), workflow: WorkflowDefinition = { ...draft, id: 'workflow', workspaceId: project.workspaceId, updatedAt: '' };
    expect(workflowStepCost(workflow.steps[1])).toBe(0); expect(workflowSelections(workflow, config).steps[1]).toEqual(workflow.steps[1]); expect(workflowConfigurationSummary(workflow, config).issues).toEqual([]); expect(workflowValidation(workflow, project, config as StudioConfiguration, '制作样片', {})).toBe('');
    const read = readConfigurationResult(JSON.stringify({ categories: [], workflows: [workflow], connections: config.connections, models: config.models, studioActions: [], useTemplates: [] })); expect(read.issue).toBeUndefined(); expect(read.state.workflows[0].steps[1].animation).toEqual(workflow.steps[1].animation);
    expect(workflowValidation({ ...workflow, steps: [{ ...workflow.steps[1], inputSource: 'project', animation: undefined }] }, project, config as StudioConfiguration, '制作样片', {})).toContain('参数无效');
  });
});
