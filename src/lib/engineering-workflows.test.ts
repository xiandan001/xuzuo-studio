import { describe, expect, it } from 'vitest';
import type { WorkflowRun, WorkflowStep } from '../configuration-types';
import { imageArtifactTarget, imageCreationDescription, imageMissingReferences, imageTaskRequest, readImageDraft, selectImageUseTemplate } from './image-studio';
import { BUILTIN_IMAGE_USE_TEMPLATES } from './image-use-templates';
import { quickImageWorkflowSteps, quickWorkflowTail } from './quick-workflow';

const template = BUILTIN_IMAGE_USE_TEMPLATES.find(item => item.id === '工程P图')!;
function draft() { return selectImageUseTemplate(readImageDraft(null, '只把指定管道改为蓝色，其余不变'), template); }
describe('engineering image primary reference and exact export', () => {
  it('requires a primary original and includes specialised photo and drawing instructions', () => {
    expect(template.minReferences).toBe(1); expect(template.prompt).toContain('图纸'); expect(template.prompt).toContain('工程照片');
    const value = draft(); expect(imageMissingReferences(value, 'old-result')).toBe(1);
    expect(value).toMatchObject({ prompt: '只把指定管道改为蓝色，其余不变', imageOptions: { imageOutputFormat: 'png', imageQuality: 'high' } });
  });
  it('does not replace a removed original with the currently selected result in refinement mode', () => {
    const value = { ...draft(), mode: 'refine' as const, references: [], refinePrompt: '仅修改管道颜色' };
    const task = imageTaskRequest(value, 'current-result', 'gpt-image-2.6-sunburst');
    expect(task.parameters.attachmentIds).toEqual([]); expect(task.parameters.engineeringReferenceId).toBeUndefined();
    expect(task.parameters.engineeringEnabled).toBe(true); expect(imageMissingReferences(value, 'current-result')).toBe(1);
  });
  it('keeps the first explicit reference fixed while auxiliary references and result selection change', () => {
    const value = { ...draft(), editingModelId: 'editing', generationModelId: 'generation', references: [{ id: 'primary', name: '主图.png' }, { id: 'auxiliary', name: '辅助图.jpg' }], imageOptions: { imageOutputFormat: 'gif' as const, imageFrameCount: 9 } };
    const task = imageTaskRequest(value, 'new-result', 'gpt-image-2.6-sunburst');
    expect(task.parameters).toMatchObject({ capability: 'image-editing', modelConfigId: 'editing', engineeringReferenceId: 'primary', attachmentIds: ['primary', 'auxiliary'], imageOutputFormat: 'png', imageSize: 'auto' });
    expect(task.parameters.imageFrameCount).toBeUndefined(); expect(imageMissingReferences(value)).toBe(0);
    expect(imageCreationDescription(task.parameters.prompt)).toBe(value.prompt);
  });
  it('clears gallery-following when entering engineering from an existing ordinary refine draft', () => {
    const value = selectImageUseTemplate({ ...readImageDraft(null, ''), mode: 'refine', references: [{ id: 'primary', name: '主图.png' }], galleryBaseId: 'primary' }, template);
    expect(value.references[0].id).toBe('primary'); expect(value.galleryBaseId).toBeUndefined();
  });
  it('creates independent paid edits followed by one local source-sized export, with no wallpaper marker', () => {
    const first: WorkflowStep = { id: 'edit', kind: 'image-editing', name: '工程P图', enabled: true, inputSource: 'project', prompt: '仅修改管道颜色', count: 2, imageOutputFormat: 'png' };
    const tail = quickWorkflowTail('image', 'image-editing', 'AI 精修');
    const steps = quickImageWorkflowSteps(first, tail, undefined, 'primary');
    expect(steps.map(step => step.kind)).toEqual(['image-editing', 'image-editing', 'export', 'manual-review']);
    expect(steps[2]).toMatchObject({ engineeringReferenceId: 'primary', contentSourceStepIds: steps.slice(0, 2).map(step => step.id) });
    expect(steps.every(step => !step.wallpaperTarget)).toBe(true);
    expect(() => quickImageWorkflowSteps({ ...first, kind: 'image-generation' }, tail, undefined, 'primary')).toThrow('原图');
  });
  it('labels a saved historical engineering result using its own source snapshot', () => {
    const image = { id: 'output', projectId: 'project', runId: 'run', name: '工程图.png', path: 'managed', bytes: 100, mimeType: 'image/png', kind: 'image' as const, createdAt: '' };
    const run = { id: 'run', mode: 'live', projectId: 'project', workflowId: 'quick-engineering', updatedAt: '', snapshot: { steps: [{ id: 'export', kind: 'export', engineeringReferenceId: 'primary' }] }, attempts: [{ stepId: 'export', status: 'complete', engineeringSource: { referenceId: 'primary', width: 1724, height: 1280, sha256: 'a'.repeat(64) }, artifacts: [image] }] } as unknown as WorkflowRun;
    expect(imageArtifactTarget([run], 'project', image)).toEqual({ engineeringReferenceId: 'primary', size: '1724x1280', background: 'auto' });
    expect(imageArtifactTarget([run], 'other', image)).toEqual({});
    run.attempts[0].engineeringSource!.referenceId = 'different'; expect(imageArtifactTarget([run], 'project', image)).toEqual({});
  });
});
