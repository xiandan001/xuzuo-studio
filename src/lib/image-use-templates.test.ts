import { describe, expect, it } from 'vitest';
import type { ImageUseTemplate, ImageUseTemplateDraft } from '../configuration-types';
import { availableImageUseTemplates, BUILTIN_IMAGE_USE_TEMPLATES, imageUseTemplateSnapshot, readImageUseTemplates, useTemplateError } from './image-use-templates';
import { imageDraftPurpose, imageMissingReferences, imageTaskRequest, readImageDraft, selectImageUseTemplate } from './image-studio';
import { readConfiguration } from './configuration';

const local: ImageUseTemplate = { id: 'custom-use-a', workspaceId: 'workspace-a', name: '商品白底图', prompt: '保留参考商品，背景干净。', size: '1536x1024', background: 'opaque', minReferences: 2, enabled: true };
const foreign: ImageUseTemplate = { ...local, id: 'custom-use-b', workspaceId: 'workspace-b', name: '别区用途' };
const draft: ImageUseTemplateDraft = { name: '我的上新图', prompt: '突出新品主体。', size: '1024x1024', background: 'auto', minReferences: 0, enabled: true };

describe('工作区用途模板与原项目保留', () => {
  it('旧配置迁移新增空用途集合，原模型与分类不受影响', () => {
    const legacy = readConfiguration(null); const { useTemplates: _templates, ...withoutTemplates } = legacy;
    expect(readConfiguration(JSON.stringify(withoutTemplates))).toMatchObject({ useTemplates: [], categories: legacy.categories, models: legacy.models });
  });
  it('用途只在本工作区显示，停用项仅管理时出现，内置七项兼容旧名称', () => {
    const templates = [local, foreign, { ...local, id: 'disabled-use', name: '已停用用途', enabled: false }];
    expect(availableImageUseTemplates(templates, 'workspace-a').map(item => item.id)).toEqual([...BUILTIN_IMAGE_USE_TEMPLATES.map(item => item.id), local.id]);
    expect(availableImageUseTemplates(templates, 'workspace-a', true).at(-1)?.id).toBe('disabled-use');
    expect(BUILTIN_IMAGE_USE_TEMPLATES.find(item => item.id === '试衣图')?.minReferences).toBe(2);
    expect(BUILTIN_IMAGE_USE_TEMPLATES.find(item => item.id === '透明 PNG')?.background).toBe('transparent');
  });
  it('创建或重命名检查本区名称与归属，其他工作区同名不冲突', () => {
    expect(useTemplateError([local, foreign], 'workspace-a', draft)).toBe('');
    expect(useTemplateError([local, foreign], 'workspace-a', { ...draft, name: foreign.name })).toBe('');
    expect(useTemplateError([local], 'workspace-a', { ...draft, name: local.name })).not.toBe('');
    expect(useTemplateError([local], 'workspace-a', { ...draft, name: '宣传图' })).not.toBe('');
    expect(useTemplateError([local, foreign], 'workspace-a', draft, foreign.id)).not.toBe('');
    expect(useTemplateError([local], 'workspace-a', { ...draft, name: local.name }, local.id)).toBe('');
  });
  it.each([{ name: '' }, { name: '长'.repeat(31) }, { prompt: '' }, { size: 'bad' }, { background: 'blue' }, { minReferences: -1 }, { minReferences: 13 }, { minReferences: 1.5 }, { enabled: 'true' }])('非法用途字段不能作为新配置保存：%j', change => {
    expect(useTemplateError([], 'workspace-a', { ...draft, ...change } as ImageUseTemplateDraft)).not.toBe('');
  });
  it('读取配置白名单保留合法模板，拒绝坏记录且不传播扩展字段', () => {
    expect(readImageUseTemplates([local, null, { ...local, id: '../bad' }, { ...local, id: 'with-secret', secret: 'DO_NOT_COPY' }])).toEqual([local, { ...local, id: 'with-secret' }]);
    expect(JSON.stringify(readImageUseTemplates([{ ...local, secret: 'DO_NOT_COPY' }]))).not.toContain('DO_NOT_COPY');
  });
  it('选择用途应用默认设置但保留已写描述和参考图，名称可独立变化', () => {
    const original = { ...readImageDraft(null, '客户确认的原描述'), references: [{ id: 'reference-one', name: '人物.png' }], generationModelId: 'old-generation-model' };
    const selected = selectImageUseTemplate(original, local);
    expect(selected).toMatchObject({ preset: local.id, prompt: original.prompt, references: original.references, generationModelId: 'old-generation-model', size: local.size, background: local.background, presetSnapshot: imageUseTemplateSnapshot(local) });
    expect(original.preset).toBe('宣传图'); expect(original.size).toBe('1024x1024');
    expect(selectImageUseTemplate(selected, { ...local, name: '改名后的用途' }).preset).toBe(local.id);
  });
  it('删除模板后重开草稿仍保留原描述、参考图和必要参考数量', () => {
    const selected = selectImageUseTemplate({ ...readImageDraft(null, '项目自己写的描述'), references: [{ id: 'reference-one', name: '商品.png' }] }, local);
    const saved = readImageDraft(JSON.stringify(selected), '不同的项目说明');
    expect(availableImageUseTemplates([], 'workspace-a').some(item => item.id === saved.preset)).toBe(false);
    expect(saved).toMatchObject({ prompt: '项目自己写的描述', preset: local.id, references: selected.references, presetSnapshot: imageUseTemplateSnapshot(local) });
    expect(imageMissingReferences(saved)).toBe(1);
    expect(imageDraftPurpose(saved)?.name).toBe(local.name);
  });
  it('试衣两张图和透明PNG约束保留，自定义用途也能要求更多参考图', () => {
    const tryOn = { ...readImageDraft(null, '我的试衣需求'), preset: '试衣图' };
    expect(imageMissingReferences(tryOn)).toBe(2);
    expect(imageMissingReferences({ ...tryOn, references: [{ id: 'person', name: '人物.png' }] })).toBe(1);
    expect(imageMissingReferences({ ...tryOn, mode: 'refine' }, 'selected-try-on-image')).toBe(0);
    const transparent = selectImageUseTemplate(readImageDraft(null, '透明素材'), { ...local, background: 'transparent' });
    expect(imageTaskRequest({ ...transparent, background: 'opaque' }).parameters.imageBackground).toBe('transparent');
    expect(imageTaskRequest({ ...readImageDraft(null, ''), preset: '透明 PNG', background: 'opaque' }).parameters.imageBackground).toBe('transparent');
    expect(imageMissingReferences(selectImageUseTemplate(readImageDraft(null, ''), { ...local, minReferences: 4 }))).toBe(4);
  });
  it('损坏的用途快照不覆盖合法草稿，内置用途不能借快照降低必需参考数', () => {
    const invalid = readImageDraft(JSON.stringify({ preset: local.id, presetSnapshot: { ...local, minReferences: 99 }, prompt: '已有描述', references: [{ id: 'reference', name: '原图.png' }] }), '');
    expect(invalid.presetSnapshot).toBeUndefined(); expect(invalid.prompt).toBe('已有描述'); expect(invalid.references).toHaveLength(1);
    expect(imageMissingReferences({ ...readImageDraft(null, ''), preset: '试衣图', presetSnapshot: { ...imageUseTemplateSnapshot(local), id: '试衣图', minReferences: 0 } })).toBe(2);
  });
});
