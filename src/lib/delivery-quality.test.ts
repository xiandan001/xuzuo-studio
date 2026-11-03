import { describe, expect, it } from 'vitest';
import type { EditorDocument } from '../editor-types';
import { editorFromText } from './editor-document';
import { generationQualityInstructions } from './creation-quality';
import { deliveryFingerprint, editorDeliveryChecks, imageDeliveryChecks } from './delivery-quality';
const word: EditorDocument = { schemaVersion: 1, kind: 'word', title: '客户项目说明', blocks: [{ id: 'b', type: 'paragraph', text: '本项目包含内容整理、页面设计和最终文件交付。', fontSize: 12, bold: false, italic: false, align: 'left' }] };
describe('生成要求与当前版本交付检查', () => {
  it('生产格式与实际编辑器解析合同一致，复核任务不被改为重写成品', () => {
    expect(generationQualityInstructions('ppt')).toContain('slides'); expect(generationQualityInstructions('word')).toContain('paragraphs');
    expect(generationQualityInstructions('ppt', 'vision')).not.toContain('slides');
    const parsed = editorFromText('ppt', '标题', JSON.stringify({ title: '真实内容', slides: [{ title: '计划', bullets: ['完整执行内容'], notes: '说明' }] }));
    expect(parsed.kind === 'ppt' && parsed.slides[0].body).toBe('完整执行内容');
    const image = generationQualityInstructions('image', 'image-generation', { imageBackground: 'transparent', hasReferences: true });
    expect(image).toContain('Alpha'); expect(image).toContain('包装');
  });
  it('未保存和明显占位不能成为可交付，技术通过仍需要人工验收', () => {
    expect(editorDeliveryChecks(word, { saved: false }).find(check => check.id === 'saved')?.status).toBe('failed');
    const valid = editorDeliveryChecks(word, { saved: true, exported: true }); expect(valid.filter(check => check.status !== 'manual').every(check => check.status === 'passed')).toBe(true); expect(valid.filter(check => check.status === 'manual').length).toBeGreaterThanOrEqual(3);
    expect(editorDeliveryChecks(word, { saved: true, exported: false }).find(check => check.id === 'exported')?.status).toBe('failed');
    expect(editorDeliveryChecks(word, { saved: true }).find(check => check.id === 'exported')?.status).toBe('unknown');
    expect(editorDeliveryChecks(word, { saved: false, exported: true }).find(check => check.id === 'exported')?.status).toBe('failed');
    const bad = { ...word, title: 'XXX 项目' }; expect(editorDeliveryChecks(bad, { saved: true }).find(check => check.id === 'placeholders')?.status).toBe('failed');
  });
  it('空PPT页和要求页数不符有明确原因，长页要求成品排版人工检查', () => {
    const document: EditorDocument = { schemaVersion: 1, kind: 'ppt', title: '提案', theme: 'paper', slides: [{ id: 's', title: '页面', body: '', notes: '', layout: 'title-body', fontSize: 20, align: 'left' }] };
    expect(editorDeliveryChecks(document, { saved: true, expectedPageCount: 3 }).filter(check => check.status === 'failed').map(check => check.id)).toEqual(['title', 'pages']);
    document.slides[0].body = '具体内容'.repeat(200); expect(editorDeliveryChecks(document, { saved: true }).find(check => check.id === 'crowded')?.status).toBe('manual');
  });
  it('图片仅以实际像素和实测Alpha判断，未知透明/规格不冒充通过', () => {
    expect(imageDeliveryChecks({ artifactAvailable: true, expectedSize: '1024x1024', requiresTransparency: true }).find(check => check.id === 'dimensions')?.status).toBe('unknown');
    expect(imageDeliveryChecks({ artifactAvailable: true, width: 1024, height: 1024 }).find(check => check.id === 'dimensions')?.status).toBe('unknown');
    expect(imageDeliveryChecks({ width: 512, height: 512, expectedSize: '1024x1024', requiresTransparency: true, transparency: 'opaque' }).filter(check => check.status === 'failed').map(check => check.id)).toEqual(['dimensions', 'alpha']);
    const valid = imageDeliveryChecks({ artifactAvailable: true, mimeType: 'image/png', width: 1024, height: 1024, expectedSize: '1024x1024', requiresTransparency: true, transparency: 'present' });
    expect(valid.filter(check => check.status !== 'manual').every(check => check.status === 'passed')).toBe(true);
  });
  it('验收标识绑定来源且不会把正文存成key', () => {
    expect(deliveryFingerprint('project:version1:修改A')).not.toBe(deliveryFingerprint('project:version1:修改B'));
    expect(deliveryFingerprint('正文'.repeat(100000)).length).toBeLessThan(40);
  });
  it('生成时明确缺失的关键资料不能被勾选人工项目冒充已补齐', () => {
    const document = editorFromText('word', '方案', JSON.stringify({ title: '方案', sections: [{ heading: '范围', paragraphs: ['先交付已确认部分。'] }], meta: { missingInputs: ['客户尚未确认验收范围'] } }));
    expect(editorDeliveryChecks(document, { saved: true }).find(check => check.id === 'missing-inputs')?.status).toBe('unknown');
  });
});
