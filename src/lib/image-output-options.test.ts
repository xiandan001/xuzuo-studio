import { describe, expect, it } from 'vitest';
import { effectiveImageOptions, imageFormatModelDisabled, imageFormatOptions, imageOutputIssue, pickImageOutputOptions, readImageOutputOptions } from './image-output-options';
import { imageTaskRequest, readImageDraft } from './image-studio';
import { quickImageWorkflowSteps } from './quick-workflow';
import type { WorkflowStep } from '../configuration-types';
describe('2.6格式入口与实际请求保持一致', () => {
  it.each(['svg', 'gif'] as const)('选择%s后其他模型置灰，切回PNG恢复选择', format => {
    expect(imageFormatModelDisabled(format, 'gpt-image-2.6-sunburst')).toBe(false);
    expect(imageFormatModelDisabled(format, 'gpt-image-2.6-flare')).toBe(false);
    for (const id of ['gpt-image-2.5-sunburst', 'gpt-image-2.6', 'custom-image']) expect(imageFormatModelDisabled(format, id)).toBe(true);
    expect(imageFormatModelDisabled('png', 'gpt-image-2.5-sunburst')).toBe(false);
    expect(imageFormatModelDisabled(undefined, 'custom-image')).toBe(false);
  });
  it.each(['gpt-image-2.6-sunburst', 'gpt-image-2.6-flare'])('%s仅生成开放SVG/GIF，精修置灰且说明原因', model => {
    expect(imageFormatOptions(model, 'image-generation').filter(option => ['svg', 'gif'].includes(option.value)).every(option => !option.disabled)).toBe(true);
    expect(imageFormatOptions(model, 'image-editing').filter(option => ['svg', 'gif'].includes(option.value)).every(option => option.disabled && option.description.includes('仅文字生成'))).toBe(true);
  });
  it.each(['gpt-image-2.5-sunburst', 'gpt-image-2', 'gpt-image-2.6', 'imagen-latest', 'custom-image'])('%s不能误启SVG或GIF', model => {
    expect(imageFormatOptions(model, 'image-generation').filter(option => ['svg', 'gif'].includes(option.value)).every(option => option.disabled && option.description.includes('2.6'))).toBe(true);
    expect(imageOutputIssue({ imageOutputFormat: 'svg' }, model)).toContain('仅支持');
  });
  it('切格式不发送旧动画、压缩、作者或标注字段；不支持的复杂度不会拦住普通PNG', () => {
    const stored = { imageOutputFormat: 'png' as const, imageFrameCount: 9, imageCompression: 30, imageComplexity: 'high' as const, imageSvgModel: 'gpt-6.1-terra', imageMarkupId: 'markup' };
    expect(effectiveImageOptions(stored, 'gpt-image-2.5-sunburst', 'image-generation')).toEqual({ imageOutputFormat: 'png' });
    expect(stored.imageFrameCount).toBe(9);
    expect(effectiveImageOptions({ ...stored, imageOutputFormat: 'gif', imageFrameDurationMs: 205 }, 'gpt-image-2.6-flare')).toMatchObject({ imageFrameCount: 9, imageFrameDurationMs: 210, imageComplexity: 'high' });
  });
  it('草稿重开保留新功能；GIF真实尺寸为auto，多SVG数量拆为独立n1步骤', () => {
    const draft = readImageDraft(JSON.stringify({ quantity: 3, imageOptions: { imageOutputFormat: 'gif', imageFrameCount: 2, imageFrameDurationMs: 100 } }), '动画');
    expect(imageTaskRequest(draft, undefined, 'gpt-image-2.6-flare')).toMatchObject({ count: 3, parameters: { imageOutputFormat: 'gif', imageFrameCount: 2, imageFrameDurationMs: 100, imageSize: 'auto' } });
    const first: WorkflowStep = { id: 'first', name: 'SVG', kind: 'image-generation', prompt: '矢量', inputSource: 'project', enabled: true, count: 3, imageOutputFormat: 'svg' };
    expect(quickImageWorkflowSteps(first, []).map(step => [step.count, step.imageOutputFormat])).toEqual([[1, 'svg'], [1, 'svg'], [1, 'svg']]);
    expect(readImageOutputOptions({ imageOutputFormat: 'executable', imageMarkupId: '../outside' })).toEqual({});
    expect(pickImageOutputOptions({ imageOutputFormat: 'svg', ignored: 'not forwarded' } as never)).toEqual({ imageOutputFormat: 'svg' });
  });
  it('无效帧数/时长/压缩在界面拦住，不能把透明JPEG提交', () => {
    for (const value of [0, 1, 17, 2.5, NaN]) expect(imageOutputIssue({ imageOutputFormat: 'gif', imageFrameCount: value }, 'gpt-image-2.6-flare')).toContain('帧数');
    for (const value of [0, 19, 2001, NaN]) expect(imageOutputIssue({ imageOutputFormat: 'gif', imageFrameDurationMs: value }, 'gpt-image-2.6-flare')).toContain('时长');
    expect(imageOutputIssue({ imageOutputFormat: 'jpeg' }, 'gpt-image-2.6-flare', 'image-generation', 'transparent')).toContain('不支持透明');
  });
});
