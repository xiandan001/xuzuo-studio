import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { WallpaperTarget } from '../wallpaper-types';
import type { StudioConfiguration, WorkflowRun, WorkflowStep } from '../configuration-types';
import type { NaturalAutomationPlan } from '../natural-automation-types';
import type { Project } from '../types';
import { imageArtifactTarget, imageTaskRequest, readImageDraft, selectImageUseTemplate, updateImageDraft } from './image-studio';
import { BUILTIN_IMAGE_USE_TEMPLATES } from './image-use-templates';
import { quickImageWorkflowSteps, quickWorkflowTail } from './quick-workflow';
import { createImageGroupBatch, imageGroupSettingsKey, imageGroupOutputIssue } from './image-group-batch';
import { compileNaturalAutomationPlan } from './natural-automation-plan';

const target: WallpaperTarget = { width: 1080, height: 2400, fit: 'cover', label: '自定义尺寸' };
const model = { id: 'image-model', name: '图片', modelId: 'gpt-image-2.6-sunburst', connectionId: 'connection', capabilities: ['image-generation' as const, 'image-editing' as const], enabled: true, pricing: { unit: 'image' as const, currency: 'CNY' as const, input: '', output: '1' } };
const project: Project = { id: 'project', workspaceId: 'workspace', name: '设备壁纸', kind: 'image', description: '', status: 'draft', version: 1, costCents: 0, updatedAt: '', accent: 'blue' };
function configuration() {
  return { models: [model, ...(['text', 'vision'] as const).map(kind => ({ ...model, id: kind, modelId: 'fixture', connectionId: 'conversation', capabilities: [kind] }))], connections: [{ id: 'connection', providerId: 'custom', protocol: 'image', name: '本地fixture', baseUrl: 'https://fixture.invalid/v1', enabled: true, status: 'configured' }, { id: 'conversation', providerId: 'custom', protocol: 'openai-chat', name: '文字fixture', baseUrl: 'https://fixture.invalid/v1', enabled: true, status: 'configured' }], credentials: ['connection', 'conversation'].map(connectionId => ({ id: connectionId === 'connection' ? 'key' : 'conversation-key', connectionId, name: '元数据fixture', enabled: true, lastFour: 'none', updatedAt: '' })), workflows: [] } as unknown as StudioConfiguration;
}
function draft() { return { ...readImageDraft(null, '自然山景'), wallpaperEnabled: true, wallpaperTarget: { ...target }, generationModelId: model.id, editingModelId: model.id }; }
function first(): WorkflowStep { return { id: 'producer', kind: 'image-generation', name: '初次生成', prompt: '自然山景', enabled: true, inputSource: 'project', imageOutputFormat: 'png', imageBackground: 'opaque', count: 2 }; }
function natural(objective = '制作1080×2400的自然山景手机壁纸'): NaturalAutomationPlan {
  return { version: 1, name: '手机壁纸', objective, outputKind: 'image', trigger: { type: 'manual' }, steps: [{ kind: 'image-generation', name: '绘制壁纸', instruction: objective }], illustrations: { mode: 'none', count: 0 }, acceptance: ['主体完整'], constraints: [], maxRepairs: 0, questions: [], unsupported: [] };
}

describe('wallpaper draft, model request and local delivery workflow', () => {
  it('persists an independent target, model choice and fit through remount without changing old defaults', () => {
    const value = draft(), restored = readImageDraft(JSON.stringify(value), '');
    expect(restored.wallpaperTarget).toEqual(target); expect(restored.generationModelId).toBe(model.id);
    expect(readImageDraft(null, '').wallpaperEnabled).toBeUndefined();
    expect(readImageDraft(JSON.stringify({ ...value, wallpaperTarget: { ...target, width: 99999 } }), '').wallpaperTarget).toBeUndefined();
    const changed = updateImageDraft(value, { wallpaperTarget: { ...target, width: 2400, height: 1080, fit: 'contain' } });
    expect(value.wallpaperTarget).toEqual(target); expect(changed.wallpaperTarget?.fit).toBe('contain');
  });
  it('selects the builtin wallpaper purpose without replacing the user description or keeping stale animation output', () => {
    const value = { ...readImageDraft(null, '保留用户写的风格'), imageOptions: { imageOutputFormat: 'gif' as const, imageFrameCount: 9 } };
    const selected = selectImageUseTemplate(value, BUILTIN_IMAGE_USE_TEMPLATES.find(item => item.id === '壁纸')!);
    expect(selected).toMatchObject({ wallpaperEnabled: true, prompt: '保留用户写的风格', background: 'opaque', imageOptions: { imageOutputFormat: 'png' } });
    expect(selected.imageOptions?.imageFrameCount).toBeUndefined();
  });
  it('separates the precise target from the supported model dimensions and keeps the actual user instruction', () => {
    const task = imageTaskRequest(draft(), undefined, model.modelId);
    expect(task.parameters.wallpaperTarget).toEqual(target); expect(task.parameters.imageSize).not.toBe('1080x2400');
    expect(task.parameters).toMatchObject({ imageOutputFormat: 'png', imageBackground: 'opaque', modelConfigId: model.id });
    expect(task.parameters.prompt).toContain('自然山景');
    expect(imageTaskRequest({ ...draft(), wallpaperEnabled: false }, undefined, model.modelId).parameters.wallpaperTarget).toBeUndefined();
  });
  it('refines a selected static original while preserving the target and discarding stale GIF-only parameters', () => {
    const value = { ...draft(), mode: 'refine' as const, refinePrompt: '仅把天空改为晚霞', references: [{ id: 'original', name: '原图.png' }], imageOptions: { imageOutputFormat: 'gif' as const, imageFrameCount: 9 } };
    const task = imageTaskRequest(value, 'original', model.modelId);
    expect(task.parameters).toMatchObject({ capability: 'image-editing', attachmentIds: ['original'], wallpaperTarget: target, imageOutputFormat: 'png' });
    expect(task.parameters.imageFrameCount).toBeUndefined(); expect(task.parameters.prompt).toContain(value.refinePrompt);
  });
  it('places a free exact export before review, binds all variants, and snapshots the target independently', () => {
    const steps = quickImageWorkflowSteps(first(), quickWorkflowTail('image', 'image-generation', '初次生成'), target);
    expect(steps.map(step => step.kind)).toEqual(['image-generation', 'image-generation', 'export', 'manual-review']);
    expect(steps[2].contentSourceStepIds).toEqual(steps.slice(0, 2).map(step => step.id)); expect(steps[2].wallpaperTarget).toEqual(target);
    expect(steps[2].wallpaperTarget).not.toBe(target); expect(steps.filter(step => step.kind.startsWith('image-'))).toHaveLength(2);
    const plain = quickImageWorkflowSteps(first(), quickWorkflowTail('image', 'image-generation', '初次生成'));
    expect(plain.slice(-2).map(step => step.kind)).toEqual(['manual-review', 'export']); expect(plain.every(step => !step.wallpaperTarget)).toBe(true);
  });
  it('rejects incompatible or invalid wallpaper requests before any workflow execution', () => {
    const tail = quickWorkflowTail('image', 'image-generation', '初次生成');
    expect(() => quickImageWorkflowSteps({ ...first(), imageOutputFormat: 'gif' }, tail, target)).toThrow('PNG');
    expect(() => quickImageWorkflowSteps(first(), tail, { ...target, height: 99999 })).toThrow();
  });
  it('reads a historical image target from its successful export snapshot, with project and MIME ownership', () => {
    const image = { id: 'fitted', projectId: project.id, runId: 'run', mimeType: 'image/png', kind: 'image' as const, bytes: 100, createdAt: '', name: '壁纸.png', path: 'managed' };
    const run = { id: 'run', mode: 'live', projectId: project.id, workflowId: 'quick-wallpaper', updatedAt: '', snapshot: { steps: [{ id: 'export', kind: 'export', wallpaperTarget: target }] }, attempts: [{ stepId: 'export', status: 'complete', artifacts: [image] }] } as unknown as WorkflowRun;
    expect(imageArtifactTarget([run], project.id, image)).toMatchObject({ size: '1080x2400', wallpaperTarget: target, background: 'opaque' });
    expect(imageArtifactTarget([run], 'other', image)).toEqual({}); expect(imageArtifactTarget([run], project.id, { ...image, mimeType: 'image/gif' })).toEqual({});
  });
});

describe('wallpaper batch and conversation entry points', () => {
  it('uses the same default horizontal iPad target in renderer and generated native conversation workflows', () => {
    const request = natural('制作一张适合 iPad Pro 11 M5 的月夜壁纸');
    const native = createRequire(import.meta.url)('../../electron/natural-automation-plan.runtime.cjs');
    for (const compiled of [compileNaturalAutomationPlan(request, project, configuration()), native.compileNaturalAutomationPlan(request, project, configuration())]) {
      expect(compiled.missing).toEqual([]);
      const image = compiled.workflow.steps.find((step: WorkflowStep) => step.kind === 'image-generation');
      const output = compiled.workflow.steps.find((step: WorkflowStep) => step.kind === 'export');
      expect(output?.wallpaperTarget).toMatchObject({ width: 2420, height: 1668, deviceId: 'ipad-pro-11-m5' });
      const [width, height] = image!.imageSize!.split('x').map(Number);
      expect(width).toBeGreaterThan(height);
      expect(compiled.workflow.steps.filter((step: WorkflowStep) => step.kind === 'image-generation')).toHaveLength(1);
    }
  });
  it('inherits exact targets per group and rewrites all native variant source IDs without adding image calls', () => {
    const settings = { model, credentialId: 'key', size: '1024x1024', background: 'auto' as const, wallpaperEnabled: true, wallpaperTarget: target };
    const batch = createImageGroupBatch({ version: 1, revision: 0, name: '两组壁纸', groups: [{ id: 'one', name: '山景', brief: '山景', count: '2' }, { id: 'two', name: '海景', brief: '海景', count: '3' }] }, settings, { workspaceId: project.workspaceId, configuration: configuration() });
    expect(batch.request.workflow.steps[1].wallpaperTarget).toEqual(target); expect(batch.request.workflow.steps[0].imageOutputFormat).toBe('png');
    const require = createRequire(import.meta.url), { imageGroupRequest } = require('../../electron/image-group-batch.cjs');
    const items = [2, 3].map((imageCount, index) => ({ id: `item-${index}`, imageCount, project }));
    const request = imageGroupRequest({ kind: 'image-groups', request: batch.request, items }, items[0], batch.request);
    expect(request.workflow.steps).toHaveLength(3); expect(request.workflow.steps[2].contentSourceStepIds).toEqual(['group-image-1', 'group-image-2']);
    expect(request.workflow.steps[2].wallpaperTarget).toEqual(target);
    expect(imageGroupSettingsKey(settings)).not.toBe(imageGroupSettingsKey({ ...settings, wallpaperTarget: { ...target, fit: 'contain' } }));
    expect(imageGroupOutputIssue({ ...settings, wallpaperTarget: undefined })).toBeTruthy();
  });
  it('compiles explicit conversation pixels into local exact output before independent final checking', () => {
    const compiled = compileNaturalAutomationPlan(natural(), project, configuration());
    expect(compiled.missing).toEqual([]);
    const exported = compiled.workflow.steps.find(step => step.wallpaperTarget);
    expect(exported?.wallpaperTarget).toMatchObject({ width: 1080, height: 2400 });
    const index = compiled.workflow.steps.indexOf(exported!);
    expect(compiled.workflow.steps[index + 1].role).toBe('reviewer'); expect(compiled.workflow.steps.at(-1)?.kind).toBe('manual-review');
    expect(compiled.workflow.steps.filter(step => step.kind === 'image-generation')).toHaveLength(1);
  });
  it('keeps an unresolved conversation wallpaper target explicitly incomplete, never an ordinary image draft', () => {
    const compiled = compileNaturalAutomationPlan(natural('制作一张6.7英寸手机壁纸'), project, configuration());
    expect(compiled.missing.some(issue => issue.startsWith('壁纸尺寸'))).toBe(true);
    expect(compiled.workflow.steps.find(step => step.kind === 'export')?.wallpaperTarget).toBeNull();
  });
  it('keeps the generated native conversation compiler aligned with the renderer target semantics', () => {
    const require = createRequire(import.meta.url), native = require('../../electron/natural-automation-plan.runtime.cjs');
    const compiled = native.compileNaturalAutomationPlan(natural(), project, configuration());
    expect(compiled.workflow.steps.find((step: WorkflowStep) => step.wallpaperTarget)?.wallpaperTarget).toMatchObject({ width: 1080, height: 2400 });
    expect(compiled.missing).toEqual([]);
  });
});
