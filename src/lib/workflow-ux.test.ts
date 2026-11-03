import { describe, expect, it } from 'vitest';
import type { CredentialMetadata, ModelConfiguration, ModelConnection, WorkflowDraft, WorkflowStep } from '../configuration-types';
import type { LivePreflight } from '../live-types';
import { studioCredential, studioModel, workflowSelections, workflowStepSelection, workflowPublicError, WORKFLOW_OUTPUT_MIN, WORKFLOW_OUTPUT_MAX } from './studio-run';
import { currentPreflightAccepted, workflowIssues } from './workflow-preflight';
import { documentStudioFormKey, readDocumentStudioForm } from './document-studio-state';
const connection: ModelConnection = { id: 'primary', name: '本机假连接', providerId: 'custom', protocol: 'openai-chat', baseUrl: 'http://127.0.0.1:9999', enabled: true, status: 'configured' };
const model = (id: string, connectionId = 'primary', enabled = true): ModelConfiguration => ({ id, name: id, modelId: `fixture-${id}`, connectionId, enabled, capabilities: ['text', 'vision'], pricing: { unit: 'million-tokens', currency: 'CNY', input: '1', output: '1' } });
const credential = (id: string, connectionId = 'primary', enabled = true): CredentialMetadata => ({ id, name: id, connectionId, enabled, lastFour: 'TEST', updatedAt: '' });
const step: WorkflowStep = { id: 'write', name: '生成正文', kind: 'text', prompt: '保留{{主题}}事实', inputSource: 'project', enabled: true, maxOutputTokens: 4096, budgetCents: 123 };
describe('少重复选择、不猜测模型和 Key', () => {
  it('仅唯一可用模型自动填入，多个时保留明确选择或保持未选', () => {
    expect(studioModel([model('one')])?.id).toBe('one');
    expect(studioModel([model('one'), model('two')])).toBeUndefined();
    expect(studioModel([model('one'), model('two')], 'two')?.id).toBe('two');
    expect(studioModel([model('off', 'primary', false), model('one')], 'off')?.id).toBe('one');
    expect(studioModel([{ ...model('demo'), demo: true }])).toBeUndefined();
  });
  it('图片的文字优化与视觉检查仅在唯一能力模型时自动选，不覆盖已有quick选择', () => {
    const models: ModelConfiguration[] = [model('text-one'), model('text-two'), { ...model('vision-one'), capabilities: ['vision'] }];
    const text = models.filter(item => item.capabilities.includes('text'));
    const vision = models.filter(item => item.capabilities.includes('vision'));
    expect(studioModel(text)).toBeUndefined(); expect(studioModel(text, 'text-two')?.id).toBe('text-two');
    expect(studioModel(vision)).toBeUndefined();
    expect(studioModel([model('only-text')])?.id).toBe('only-text');
  });
  it('同连接换模型保留明确 Key，切连接不沿用旧Key且多把不猜', () => {
    const configuration = { models: [model('one'), model('two'), model('other-model', 'other')], connections: [connection, { ...connection, id: 'other' }], credentials: [credential('first'), credential('chosen'), credential('other', 'other')] };
    expect(workflowStepSelection({ ...step, modelConfigId: 'two', credentialId: 'chosen' }, configuration).credentialId).toBe('chosen');
    expect(workflowStepSelection({ ...step, modelConfigId: 'other-model', credentialId: 'chosen' }, configuration).credentialId).toBe('other');
    expect(workflowStepSelection({ ...step, modelConfigId: 'one' }, configuration).credentialId).toBeUndefined();
    expect(studioCredential(configuration.credentials, 'primary', 'chosen')).toBe('chosen');
  });
  it('模板补全保持提示词、预算、人工步骤及原对象不变，停用引用不复用', () => {
    const workflow: WorkflowDraft = { name: '可复用流程', description: '', outputKind: 'word', steps: [step, { ...step, id: 'check', kind: 'manual-review' }] };
    const original = JSON.stringify(workflow);
    const next = workflowSelections(workflow, { models: [model('one')], connections: [connection], credentials: [credential('valid'), credential('off', 'primary', false)] });
    expect(next.steps[0]).toMatchObject({ modelConfigId: 'one', credentialId: 'valid', prompt: step.prompt, budgetCents: 123, maxOutputTokens: 4096 });
    expect(next.steps[1]).toEqual(workflow.steps[1]); expect(JSON.stringify(workflow)).toBe(original);
    expect(WORKFLOW_OUTPUT_MIN).toBe(16); expect(WORKFLOW_OUTPUT_MAX).toBe(16384);
  });
});
describe('本次确认和错误定位', () => {
  const ready: LivePreflight = { ok: true, errors: [], warnings: [], steps: [{ id: 'write', name: '生成正文', kind: 'text' }], unknownCost: true };
  it('一次明确确认覆盖当前预检，用量待返回无需第二次勾选；新参数/旧结果均不能开始', () => {
    expect(currentPreflightAccepted(ready, 'same', 'same', true)).toBe(true);
    expect(currentPreflightAccepted(ready, 'same', 'same', false)).toBe(false);
    expect(currentPreflightAccepted(ready, 'old', 'new', true)).toBe(false);
    expect(currentPreflightAccepted(null, 'same', 'same', true)).toBe(false);
    expect(currentPreflightAccepted({ ...ready, ok: false }, 'same', 'same', true)).toBe(false);
  });
  it('保留后端stepId/field；老错误仅唯一命中步骤名时定位', () => {
    const structured: LivePreflight = { ...ready, ok: false, errors: ['缺 Key'], issues: [{ message: '缺 Key', stepId: 'third', field: 'credentialId' }] };
    expect(workflowIssues(structured)).toEqual(structured.issues);
    expect(workflowIssues({ ...ready, errors: ['“生成正文”需要凭证'] })[0].stepId).toBe('write');
    expect(workflowIssues({ ...ready, errors: ['“生成正文”需要凭证'], steps: [...ready.steps, { id: 'duplicate', name: '生成正文', kind: 'text' }] })[0].stepId).toBeUndefined();
  });
  it('错误保留真实底层原因，不替换成泛化toast', () => {
    expect(workflowPublicError(new Error("Error invoking remote method 'runtime:preflight': Error: 项目目录不可写"), '预检失败')).toBe('项目目录不可写');
    expect(workflowPublicError(undefined, '预检失败')).toBe('预检失败');
  });
});
describe('文档工作台项目表单恢复', () => {
  it('需求、精修指令、模型和面板分项目保存，仅复制允许的元数据字段', () => {
    const form = readDocumentStudioForm(JSON.stringify({ version: 1, brief: '不能丢的需求', instruction: '保留数字', modelId: 'selected-model', inspector: 'refine', secret: 'must-not-copy' }));
    expect(form).toEqual({ version: 1, brief: '不能丢的需求', instruction: '保留数字', modelId: 'selected-model', inspector: 'refine', imageMode: 'none', imageModelId: '', imageCredentialId: '', imageCount: 1, imageIds: [] });
    expect(form).not.toHaveProperty('secret');
    expect(documentStudioFormKey('project-one')).not.toBe(documentStudioFormKey('project-two'));
    expect(readDocumentStudioForm('{broken', '项目说明').brief).toBe('项目说明');
    expect(readDocumentStudioForm(JSON.stringify({ version: 1, inspector: 'invalid' })).inspector).toBe('create');
  });
  it('图文选择只恢复允许元数据，图片编号去重与限量，不恢复任意参数或密钥', () => {
    const form = readDocumentStudioForm(JSON.stringify({ version: 1, imageMode: 'generate', imageModelId: 'image-model', imageCredentialId: 'credential-id', imageCount: 4, imageIds: ['a', 'a', '../escape', 'b', 'c', 'd', 'e'], apiKey: 'not-a-real-key' }));
    expect(form).toMatchObject({ imageMode: 'generate', imageModelId: 'image-model', imageCredentialId: 'credential-id', imageCount: 4, imageIds: ['a', 'b', 'c', 'd', 'e'] });
    expect(form).not.toHaveProperty('apiKey');
    const invalid = readDocumentStudioForm(JSON.stringify({ version: 1, imageMode: 'unsupported', imageCount: 100 }));
    expect(invalid.imageMode).toBe('none'); expect(invalid.imageCount).toBe(1);
  });
});
