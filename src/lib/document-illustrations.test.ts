import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { StudioConfiguration, WorkflowStep } from '../configuration-types';
import { DOCUMENT_IMAGE_LIMIT, illustratedDocumentSteps, validDocumentImageCount } from './document-illustrations';
import { readDocumentStudioForm } from './document-studio-state';
import { replaceDocumentImage, selectedDocumentImage } from './document-image-edit';
import { editorFromText } from './editor-generated';
const require = createRequire(import.meta.url);
const { composeDocumentImages, illustrationAssets } = require('../../electron/document-illustrations.cjs');
const pictures = [1, 2].map(index => ({ id: `image-${index}`, kind: 'image', mimeType: 'image/png', projectId: 'project' }));
const rawWord = JSON.stringify({ title: '完整图文', sections: [{ heading: '目标', paragraphs: ['完整第一段', '完整第二段'] }, { heading: '执行', paragraphs: ['执行说明-END'] }] });
const rawPpt = JSON.stringify({ title: '完整图文', slides: [{ title: '封面', bullets: ['完整开场'], notes: '开场备注' }, { title: '方案', bullets: ['完整方案-END'], notes: '备注-END' }] });

describe('实际图片确定性图文排版', () => {
  it('Word保留完整文字，插图是独立图片块，复读规范编辑源完全相同', () => {
    const document = composeDocumentImages('word', '标题', rawWord, pictures);
    expect(document.blocks.filter((block: { type: string }) => block.type === 'image').map((block: { imageId: string }) => block.imageId)).toEqual(pictures.map(image => image.id));
    expect(document.blocks.map((block: { text: string }) => block.text).join('\n')).toContain('执行说明-END');
    expect(editorFromText('word', '标题', JSON.stringify({ editorDocument: document }))).toEqual(document);
  });
  it('PPT仅改变所需版式，不增删页或正文及备注；页面不足时报明确错误', () => {
    const document = composeDocumentImages('ppt', '标题', rawPpt, pictures);
    expect(document.slides).toHaveLength(2); expect(document.slides.map((slide: { layout: string }) => slide.layout)).toEqual(['image-right', 'image-right']);
    expect(document.slides[1]).toMatchObject({ title: '方案', body: '完整方案-END', notes: '备注-END', imageId: 'image-2' });
    expect(() => composeDocumentImages('ppt', '标题', JSON.stringify({ title: '单页', slides: [{ title: '单页', bullets: ['内容'] }] }), pictures)).toThrow('减少配图');
  });
  it('拒绝跨项目图、未选择图片编号及没有真实配图的要求', () => {
    expect(() => illustrationAssets({ run: { projectId: 'other' } }, { documentImageSource: 'references' }, undefined, pictures)).toThrow('当前项目');
    expect(() => illustrationAssets({ run: { projectId: 'project' } }, { documentImageSource: 'previous' }, undefined, [])).toThrow('实际图片');
    const document = composeDocumentImages('word', '标题', rawWord, pictures);
    document.blocks.find((block: { type: string }) => block.type === 'image').imageId = 'invented-id';
    expect(() => composeDocumentImages('word', '标题', JSON.stringify(document), pictures)).toThrow('未选择的图片');
  });
  it('替换只影响绑定图片位置，保留后来文字编辑且拒绝已改图片的旧结果', () => {
    const original = composeDocumentImages('word', '标题', rawWord, pictures), source = structuredClone(original);
    const target = selectedDocumentImage(original, original.blocks.find((block: { type: string }) => block.type === 'image').id)!;
    original.blocks.find((block: { type: string }) => block.type === 'paragraph').text = '精修期间手工修改-END';
    const replaced = replaceDocumentImage(original, target, 'new-picture');
    expect(JSON.stringify(replaced)).toContain('精修期间手工修改-END'); expect(JSON.stringify(source)).not.toContain('new-picture');
    expect(() => replaceDocumentImage(replaced, target, 'another-picture')).toThrow('原图片位置已更改');
    if (replaced.kind !== 'word') throw new Error('Expected Word');
    expect(replaced.blocks.filter(block => block.type === 'image').map(block => block.imageId)).toEqual(['new-picture', 'image-2']);
  });
});

describe('图文模式配置', () => {
  const first: WorkflowStep = { id: 'body', kind: 'text', name: '正文', prompt: '完整正文', inputSource: 'project', enabled: true, modelConfigId: 'text' };
  const configuration = { connections: [{ id: 'connection', enabled: true }], models: [{ id: 'image', connectionId: 'connection', capabilities: ['image-generation'], enabled: true }], credentials: [{ id: 'key', connectionId: 'connection', enabled: true }] } as unknown as StudioConfiguration;
  it('参考图只增加本地排版标志，AI配图有独立真实模型调用并支持指定Key', () => {
    expect(illustratedDocumentSteps(first, [], { mode: 'references', count: 1 }, configuration, '需求')).toEqual([{ ...first, documentImageSource: 'references' }]);
    const workflow = illustratedDocumentSteps(first, [], { mode: 'generate', count: 4 }, configuration, '图文需求');
    expect(workflow.map(step => step.kind)).toEqual(['image-generation', 'image-generation', 'image-generation', 'image-generation', 'text']); expect(workflow.slice(0, 4).every(step => step.count === 1)).toBe(true); expect(workflow[0]).toMatchObject({ count: 1, modelConfigId: 'image', credentialId: 'key' }); expect(workflow[0].prompt).toContain('不要把整页文档');
    expect(workflow[4]).toMatchObject({ id: 'body', documentImageSource: 'previous', inputSource: 'project', documentImageStepIds: workflow.slice(0, 4).map(step => step.id) });
  });
  it.each([3, 5, 7, 10, DOCUMENT_IMAGE_LIMIT])('%i张自定义数量拆成独立单张请求，来源有序且所有编号唯一', count => {
    const steps = illustratedDocumentSteps(first, [], { mode: 'generate', count }, configuration, '需求');
    const pictures = steps.slice(0, count), body = steps[count];
    expect(pictures).toHaveLength(count); expect(pictures.every(step => step.count === 1 && step.inputSource === 'project')).toBe(true);
    expect(new Set(pictures.map(step => step.id)).size).toBe(count);
    expect(body.documentImageStepIds).toEqual(pictures.map(step => step.id));
    expect(readDocumentStudioForm(JSON.stringify({ version: 1, imageCount: count })).imageCount).toBe(count);
  });
  it('非法、空白、分数与过大数量不创建任何生成步骤', () => {
    for (const count of [0, -1, 1.5, 21, Number.NaN, Infinity]) {
      expect(validDocumentImageCount(count)).toBe(false);
      expect(() => illustratedDocumentSteps(first, [], { mode: 'generate', count }, configuration, '需求')).toThrow('整数');
    }
  });
  it('从无效AI数量切换到已有图片时不被隐藏的数量字段阻挡', () => {
    expect(illustratedDocumentSteps(first, [], { mode: 'references', count: Number.NaN }, configuration, '需求')).toEqual([{ ...first, documentImageSource: 'references' }]);
  });
  it('只汇总指定步骤最后成功图片，避免重复旧尝试或无关图片', () => {
    const snapshot = { steps: [{ id: 'one', kind: 'image-generation', enabled: true, count: 1 }, { id: 'two', kind: 'image-generation', enabled: true, count: 1 }, { id: 'body', kind: 'text', enabled: true }] };
    const record = { run: { projectId: 'project', snapshot, attempts: [{ stepId: 'one', status: 'complete', artifacts: [pictures[0]] }, { stepId: 'two', status: 'failed', artifacts: [{ ...pictures[1], id: 'failed-image' }] }, { stepId: 'two', status: 'complete', artifacts: [pictures[1]] }] } };
    const step = { id: 'body', documentImageSource: 'previous', documentImageStepIds: ['one', 'two'] };
    expect(illustrationAssets(record, step, { artifacts: [] }, [])).toEqual(pictures);
    record.run.attempts.pop();
    expect(() => illustrationAssets(record, step, undefined, [])).toThrow('约定数量');
  });
  it('旧表单默认为纯文字，自定义配图按项目保存并校验非法数量', () => {
    expect(readDocumentStudioForm('{"version":1,"brief":"保留旧需求"}')).toMatchObject({ brief: '保留旧需求', imageMode: 'none', imageCount: 1 });
    expect(readDocumentStudioForm(JSON.stringify({ version: 1, imageMode: 'generate', imageCount: 99, imageIds: ['abc', 'abc', '../no'] }))).toMatchObject({ imageMode: 'generate', imageCount: 1, imageIds: ['abc'] });
  });
});
