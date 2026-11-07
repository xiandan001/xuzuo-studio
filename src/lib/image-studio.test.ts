import { describe, expect, it } from 'vitest';
import type { WorkflowRun } from '../configuration-types';
import type { ArtifactMetadata } from '../live-types';
import { followGalleryImage, imageArtifactTarget, imageCapability, imageCreationDescription, imageReferenceIds, imageTaskRequest, importImageReferences, isGalleryImageBase, projectImageContent, readImageDraft, updateImageDraft, withAnimationReference } from './image-studio';
import { MAX_IMAGE_QUANTITY, validImageQuantity } from './image-quantity';

const file = (id: string, kind: ArtifactMetadata['kind'] = 'image'): ArtifactMetadata => ({ id, name: `${id}.${kind === 'image' ? 'png' : 'txt'}`, mimeType: kind === 'image' ? 'image/png' : 'text/plain', bytes: 20, path: `files/${id}`, kind, projectId: 'project', createdAt: '2026-10-30T01:00:00Z' });
function run(id: string, artifacts: ArtifactMetadata[], updatedAt: string, workflowId = id): WorkflowRun {
  return { id, mode: 'live', workspaceId: 'workspace', projectId: 'project', workflowId, workflowName: id, snapshot: { id: workflowId, name: id, workspaceId: 'workspace', description: '', outputKind: 'image', steps: [{ id: 'step', name: '步骤', kind: artifacts[0]?.kind === 'image' ? 'image-generation' : 'text', prompt: '', inputSource: 'project', enabled: true }], updatedAt }, status: 'complete', stepIndex: 1, attempts: [{ id: `${id}-attempt`, stepId: 'step', stepName: '步骤', modelLabel: '模型', status: 'complete', costCents: 23, summary: '', input: '', prompt: '', action: '初次生成', artifacts }], variables: {}, input: '', createdAt: updatedAt, updatedAt };
}

describe('图片工作台的真实结果与描述', () => {
  it('动画绑定只持久化来源元数据，真实任务仅用PNG且新选动画不能借用旧参考', () => {
    const creation = updateImageDraft(readImageDraft(null, '原生成描述'), { references: [{ id: 'create-a', name: '生成参考.png' }], refinePrompt: '最新要求：改成蓝色', imageOptions: { imageOutputFormat: 'gif', imageFrameCount: 6, imageFrameDurationMs: 300 } });
    const draft = withAnimationReference(updateImageDraft(creation, { mode: 'refine' }), { sourceArtifactId: 'gif-one', sourceSha256: 'a'.repeat(64), prompt: '原动画中的星星缓慢升起', imageOptions: { imageOutputFormat: 'gif', imageFrameCount: 2, imageFrameDurationMs: 200 }, mimeType: 'image/gif', width: 1, height: 1, reference: file('frame-png'), sourceBytes: new Uint8Array([71, 73, 70]) });
    const payload = imageTaskRequest(draft, 'gif-one').parameters;
    expect(payload).toMatchObject({ attachmentIds: ['frame-png'], imageOutputFormat: 'gif', imageFrameCount: 6, imageFrameDurationMs: 300 });
    expect(payload.prompt).toContain('原动画中的星星缓慢升起'); expect(payload.prompt.endsWith('最新要求：改成蓝色')).toBe(true); expect(draft.refinePrompt).toBe('最新要求：改成蓝色');
    expect(imageTaskRequest(draft, 'gif-two').parameters.attachmentIds).toEqual([]);
    const serialized = JSON.stringify(draft); expect(serialized).not.toContain('sourceBytes'); expect(serialized).not.toContain('pngBytes');
    expect(readImageDraft(serialized, '').animationReference).toEqual(draft.animationReference);
    const manual = updateImageDraft(draft, { references: [{ id: 'manual', name: '手动原图.png' }], galleryBaseId: undefined });
    expect(manual.animationReference).toBeUndefined(); expect(imageTaskRequest(manual, 'gif-two').parameters.attachmentIds).toEqual(['manual']);
    expect(updateImageDraft(draft, { mode: 'create' }).references.map(reference => reference.id)).toEqual(['create-a']);
  });
  it('非GIF表单隐藏的旧帧参数不覆盖动画来源默认值', () => {
    const current = updateImageDraft(readImageDraft(null, '描述'), { mode: 'refine', imageOptions: { imageOutputFormat: 'png', imageFrameCount: 16, imageFrameDurationMs: 2000 } });
    const draft = withAnimationReference(current, { sourceArtifactId: 'gif-one', sourceSha256: 'a'.repeat(64), prompt: '原动画描述', imageOptions: { imageOutputFormat: 'gif', imageFrameCount: 9, imageFrameDurationMs: 120 }, mimeType: 'image/gif', width: 1, height: 1, reference: file('frame-png') });
    expect(imageTaskRequest(draft, 'gif-one').parameters).toMatchObject({ imageFrameCount: 9, imageFrameDurationMs: 120, imageOutputFormat: 'gif' });
  });
  it('生成参考A与精修B/C分别保留，切换和JSON重载后的真实任务附件不串用', () => {
    const a = { id: 'create-a', name: '生成参考A.png' }, b = { id: 'result-b', name: '产物B.png' }, b2 = { id: 'result-b2', name: '新产物B2.png' }, c = { id: 'refine-c', name: '精修参考C.png' };
    const creation = updateImageDraft(readImageDraft(null, '生成描述'), { references: [a] });
    expect(imageTaskRequest(creation, b.id).parameters.attachmentIds).toEqual([a.id]);
    const refinement = updateImageDraft(creation, { mode: 'refine' });
    expect(refinement.references).toEqual([]); expect(imageTaskRequest(refinement, b.id).parameters.attachmentIds).toEqual([b.id]);
    const extra = importImageReferences(refinement, [c], b);
    expect(imageTaskRequest(extra, b.id).parameters.attachmentIds).toEqual([b.id, c.id]);
    expect(isGalleryImageBase(extra)).toBe(true);
    expect(readImageDraft(JSON.stringify(extra), '').galleryBaseId).toBe(b.id);
    expect(importImageReferences(extra, [c], b).galleryBaseId).toBe(b.id);
    const removedExtra = updateImageDraft(extra, { references: [b] });
    expect(imageTaskRequest(followGalleryImage(removedExtra, b2), b2.id).parameters.attachmentIds).toEqual([b2.id]);
    const back = updateImageDraft(extra, { mode: 'create' });
    expect(back.references).toEqual([a]); expect(imageTaskRequest(back, b.id).parameters.attachmentIds).toEqual([a.id]);
    const restored = readImageDraft(JSON.stringify(back), '');
    const followed = followGalleryImage(updateImageDraft(restored, { mode: 'refine' }), b2);
    expect(imageTaskRequest(followed, b2.id).parameters.attachmentIds).toEqual([b2.id, c.id]);
    expect(followGalleryImage(followed, b2)).toBe(followed);
    expect(followGalleryImage(extra, c).references).toEqual([c]);
    expect(followGalleryImage({ ...extra, references: [b, c, c] }, b2).references).toEqual([b2, c]);
    expect(creation.references).toEqual([a]); expect(creation.refinePrompt).toBe(restored.refinePrompt);
  });
  it('明确替换精修基底和Gallery跟随仍有效，生成参考不被替换', () => {
    const a = { id: 'create-a', name: '生成参考A.png' }, base = { id: 'explicit-base', name: '明确基底.png' }, next = { id: 'next-result', name: '新产物.png' };
    const creation = updateImageDraft(readImageDraft(null, '描述'), { references: [a] });
    const explicit = updateImageDraft(creation, { mode: 'refine', references: [base], galleryBaseId: base.id });
    expect(followGalleryImage(explicit, next).references).toEqual([next]);
    const extra = { id: 'manual-extra', name: '手动额外参考.png' };
    const manual = updateImageDraft(explicit, { references: [base, extra], galleryBaseId: undefined });
    expect(followGalleryImage(manual, next)).toBe(manual);
    expect(imageTaskRequest(readImageDraft(JSON.stringify(manual), ''), next.id).parameters.attachmentIds).toEqual([base.id, extra.id]);
    const back = updateImageDraft(manual, { mode: 'create' });
    expect(back.references).toEqual([a]); expect(updateImageDraft(back, { mode: 'refine' }).references).toEqual([base, extra]);
  });
  it('精修额外参考去重并把原图计入12张上限，拒绝时不改变草稿', () => {
    const b = { id: 'base', name: '原图.png' }, draft = updateImageDraft(readImageDraft(null, '描述'), { mode: 'refine' });
    const added = Array.from({ length: 11 }, (_, index) => ({ id: `extra-${index}`, name: `${index}.png` }));
    expect(importImageReferences(draft, [b, ...added], b).references).toHaveLength(12);
    const before = JSON.stringify(draft);
    expect(() => importImageReferences(draft, [...added, { id: 'too-many', name: '超限.png' }], b)).toThrow('合计最多 12 张');
    expect(JSON.stringify(draft)).toBe(before);
  });
  it('旧草稿仅保留其当前模式参考，不猜测迁移到另一模式；非当前bank仍严格清洗', () => {
    const legacy = readImageDraft(JSON.stringify({ mode: 'refine', references: [{ id: 'legacy-base', name: '旧手动基底.png' }] }), '');
    expect(legacy.references[0].id).toBe('legacy-base');
    expect(updateImageDraft(legacy, { mode: 'create' }).references).toEqual([]);
    const saved = readImageDraft(JSON.stringify({ mode: 'create', references: [], referenceDrafts: { refine: { references: [{ id: 'valid', name: '参考.png', preview: 'not-secret-storage' }, { id: '../outside', name: '坏路径' }] } } }), '');
    expect(updateImageDraft(saved, { mode: 'refine' }).references).toEqual([{ id: 'valid', name: '参考.png' }]);
  });
  it('自定义整数张数在创建、精修、草稿重载后保持一致，不再限于1/2/4', () => {
    for (let quantity = 1; quantity <= MAX_IMAGE_QUANTITY; quantity++) {
      const draft = readImageDraft(JSON.stringify({ quantity, prompt: '制作表情包', refinePrompt: '清理边缘' }), '');
      expect(validImageQuantity(quantity)).toBe(true);
      expect(draft.quantity).toBe(quantity);
      expect(imageTaskRequest(draft).count).toBe(quantity);
      expect(imageTaskRequest({ ...draft, mode: 'refine' }, 'original').parameters.attachmentIds).toEqual(['original']);
      expect(imageTaskRequest({ ...draft, mode: 'refine' }, 'original').count).toBe(quantity);
    }
  });
  it.each([undefined, null, '', '3', 0, -1, 1.5, 21, 90, Number.NaN, Number.POSITIVE_INFINITY])('拒绝非法张数 %s，持久化数据安全回退到1张', quantity => {
    expect(validImageQuantity(quantity)).toBe(false);
    expect(readImageDraft(JSON.stringify({ quantity }), '').quantity).toBe(1);
  });
  it('参考图仅保留在项目文件，不因导出引用进入生成结果；真实partial和可核实legacy仍保留', () => {
    const generated = file('new-result'), person = file('person'), clothes = file('clothes');
    const actual = run('generation', [generated], '2026-10-30T01:00:00Z');
    const exported = run('export-copy', [generated, person, clothes], '2026-10-30T02:00:00Z'); exported.snapshot.steps[0].kind = 'export';
    const partial = run('partial', [file('partial-result')], '2026-10-30T03:00:00Z'); partial.attempts[0].status = 'failed';
    const legacy = run('legacy', [{ ...file('legacy-result'), runId: 'legacy' }, file('unknown-origin')], '2026-10-30T04:00:00Z'); legacy.snapshot.steps = [];
    const content = projectImageContent([exported, actual, partial, legacy], 'project');
    expect(content.images.map(item => item.id)).toEqual(['legacy-result', 'partial-result', 'new-result']);
    expect(content.artifacts.map(item => item.id)).toEqual(expect.arrayContaining(['person', 'clothes', 'unknown-origin']));
  });
  it('仅标记的Gallery自动基底跟随选中结果，手动多参考与旧草稿不被换掉', () => {
    const reference = { id: 'original', name: '原图.png' }, next = { id: 'new-result', name: '新结果.png' };
    const auto = { ...readImageDraft(null, '需求'), mode: 'refine' as const, references: [reference], galleryBaseId: reference.id };
    expect(isGalleryImageBase(auto)).toBe(true);
    expect(followGalleryImage(auto, next)).toMatchObject({ references: [next], galleryBaseId: next.id });
    expect(readImageDraft(JSON.stringify(auto), '').galleryBaseId).toBe(reference.id);
    for (const references of [[reference], [reference, { id: 'clothes', name: '服装.png' }]]) {
      const manual = { ...auto, references, galleryBaseId: undefined };
      expect(followGalleryImage(manual, next)).toBe(manual);
      expect(readImageDraft(JSON.stringify(manual), '').galleryBaseId).toBeUndefined();
    }
    const manual = updateImageDraft(auto, { references: [{ id: 'person', name: '人物.png' }, { id: 'clothes', name: '服装.png' }] });
    expect(manual.galleryBaseId).toBeUndefined(); expect(followGalleryImage(manual, next).references).toEqual(manual.references);
    expect(updateImageDraft(auto, { mode: 'create' }).galleryBaseId).toBeUndefined();
  });
  it('图片验收目标来自实际生成步骤快照，跳过导出引用、外项目和失败尝试', () => {
    const image = { ...file('actual-image'), runId: 'origin' }, origin = run('origin', [image], '2026-10-30T01:00:00Z');
    origin.snapshot.steps[0].imageSize = '1024x1536'; origin.snapshot.steps[0].imageBackground = 'transparent';
    const exported = run('export-copy', [image], '2026-10-30T03:00:00Z'); exported.snapshot.steps[0].kind = 'export'; exported.snapshot.steps[0].imageSize = '1536x1024';
    expect(imageArtifactTarget([exported, origin], 'project', image)).toEqual({ size: '1024x1536', background: 'transparent' });
    expect(imageArtifactTarget([{ ...origin, projectId: 'other' }], 'project', image)).toEqual({});
    expect(imageArtifactTarget([{ ...origin, attempts: [{ ...origin.attempts[0], status: 'failed' }] }], 'project', image)).toEqual({});
    expect(imageArtifactTarget([run('legacy', [image], '')], 'project', image)).toEqual({});
  });
  it('结果描述只展示用户要求，兼容旧提示词且不截掉用户自己的后续文字', () => {
    expect(imageCreationDescription('【序作内置创作规范 · 基础】\n内部要求\n\n【用户本次要求】\n只清理边缘\n保留主体')).toBe('只清理边缘\n保留主体');
    expect(imageCreationDescription('原描述\n\n【成品与交付要求】\n旧内部规范')).toBe('原描述');
    expect(imageCreationDescription('完整用户描述')).toBe('完整用户描述');
  });
  it('文字优化和检查不会顶掉历史图片，保留同项目各次真实图片', () => {
    const history = [run('old-image', [file('image-one')], '2026-10-30T01:00:00Z'), run('new-image', [file('image-two')], '2026-10-30T02:00:00Z'), run('review', [file('report', 'text')], '2026-10-30T03:00:00Z')];
    expect(projectImageContent(history, 'project').images.map(item => item.id)).toEqual(['image-two', 'image-one']);
    expect(projectImageContent(history, 'project').reports.map(item => item.id)).toEqual(['report']);
    expect(history[0].attempts[0].costCents).toBe(23);
  });

  it('已回收图片隐藏，根回收列表恢复后覆盖旧元数据，其他项目不混入', () => {
    const original = file('image'); const stale = { ...original, trashedAt: '2026-10-30T02:00:00Z' };
    const history = [run('owned', [stale, { ...file('foreign'), projectId: 'other-project' }], '2026-10-30T02:00:00Z'), { ...run('foreign-run', [file('other-run')], '2026-10-30T03:00:00Z'), projectId: 'other-project' }];
    expect(projectImageContent(history, 'project').images).toEqual([]);
    expect(projectImageContent(history, 'project', [stale]).images).toEqual([]);
    expect(projectImageContent(history, 'project', []).images).toEqual([{ ...stale, trashedAt: undefined }]);
  });

  it('同一文件不会因导出引用重复出现，只有成功的描述优化可应用', () => {
    const image = file('image'); const optimized = file('optimized', 'text');
    const history = [run('create', [image], '2026-10-30T01:00:00Z'), run('export', [image], '2026-10-30T02:00:00Z'), run('optimize', [optimized], '2026-10-30T03:00:00Z', 'quick-project-text-refine')];
    expect(projectImageContent(history, 'project').images).toHaveLength(1);
    expect(projectImageContent(history, 'project').optimizedPrompt?.id).toBe('optimized');
    history[2].attempts[0].status = 'failed';
    expect(projectImageContent(history, 'project').optimizedPrompt).toBeUndefined();
    expect(projectImageContent(history, 'project', [optimized]).reports).toEqual([]);
  });

  it('普通生成不会携带上一次结果，精修明确用选中图，上传参考图优先', () => {
    expect(imageReferenceIds('create', [], 'selected-image')).toEqual([]);
    expect(imageReferenceIds('refine', [], 'selected-image')).toEqual(['selected-image']);
    expect(imageReferenceIds('refine', [{ id: 'person', name: '人物图' }, { id: 'garment', name: '服装图' }], 'selected-image')).toEqual(['person', 'garment']);
    expect(imageCapability('create', [])).toBe('image-generation');
    expect(imageCapability('create', ['reference'])).toBe('image-editing');
    expect(imageCapability('refine', [])).toBe('image-editing');
  });

  it('项目草稿保留原描述、参数和参考ID，非法草稿回退时不写入示例图', () => {
    const saved = readImageDraft(JSON.stringify({ prompt: '已编辑的描述', refinePrompt: '保留主体', mode: 'refine', size: '1536x1024', quantity: 2, background: 'transparent', references: [{ id: 'reference-id', name: '人物.png', preview: 'should-not-persist' }] }), '项目需求');
    expect(saved).toMatchObject({ prompt: '已编辑的描述', refinePrompt: '保留主体', mode: 'refine', quantity: 2, background: 'transparent', references: [{ id: 'reference-id', name: '人物.png' }] });
    expect(readImageDraft('invalid json', '项目需求').prompt).toBe('项目需求');
    expect(readImageDraft(JSON.stringify({ references: [{ id: '../outside', name: '越界' }], quantity: 90, size: 'bad' }), '').references).toEqual([]);
    const tooMany = Array.from({ length: 16 }, (_, index) => ({ id: `image-${index}`, name: `参考${index + 1}.png` }));
    expect(readImageDraft(JSON.stringify({ references: tooMany }), '').references).toEqual(tooMany.slice(0, 12));
    expect(readImageDraft(null, '').prompt).toBe('');
  });

  it('真实请求采用当前模式显示的模型、图片参数及明确参考源，不重复描述', () => {
    const draft = { ...readImageDraft(null, '生成描述'), generationModelId: 'generation-model', editingModelId: 'editing-model', quantity: 2, refinePrompt: '只清理边缘' };
    expect(imageTaskRequest(draft, 'previous-image')).toMatchObject({ count: 2, parameters: { prompt: '生成描述', input: '', modelConfigId: 'generation-model', capability: 'image-generation', attachmentIds: [] } });
    expect(imageTaskRequest({ ...draft, mode: 'refine' }, 'selected-image').parameters).toMatchObject({ prompt: '只清理边缘', modelConfigId: 'editing-model', capability: 'image-editing', attachmentIds: ['selected-image'] });
    expect(imageTaskRequest({ ...draft, references: [{ id: 'person', name: '人物.png' }], background: 'transparent' }).parameters).toMatchObject({ modelConfigId: 'editing-model', capability: 'image-editing', attachmentIds: ['person'], imageBackground: 'transparent' });
  });
});
