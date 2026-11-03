import { describe, expect, it } from 'vitest';
import type { Project } from '../types';
import type { ArtifactMetadata } from '../live-types';
import { assetApplicationTarget, assertAssetImage, imageDraftWithAsset, insertDocumentAsset, insertWorkbenchAsset } from './asset-application';
import { emptyEditorDocument, newEditorSlide, newWordBlock } from './editor-document';
import { readImageDraft } from './image-studio';
import { emptyEditHistory, recordEdit, redoEdit, undoEdit } from './edit-history';
const project: Project = { id: 'project', workspaceId: 'one', kind: 'word', name: '文稿', description: '', status: 'draft', costCents: 17, version: 1, updatedAt: '', accent: 'blue' };
const file: ArtifactMetadata = { id: 'copied-image', projectId: project.id, name: '留白背景.png', mimeType: 'image/png', kind: 'image', bytes: 100, createdAt: '', path: 'files/copied-image.png' };
describe('真实复制素材的安全直用', () => {
  it('仅接受当前可见工作区项目与所属真实文件，拒绝跨区/跨项目/不可用元数据', () => {
    expect(assetApplicationTarget([project], 'one', project.id, file)).toBe(project);
    expect(() => assetApplicationTarget([project], 'two', project.id, file)).toThrow('不属于');
    expect(() => assetApplicationTarget([{ ...project, trashedAt: 'now' }], 'one', project.id, file)).toThrow('不属于');
    for (const changes of [{ projectId: 'other' }, { id: '../escape' }, { bytes: 0 }, { unavailable: true }, { trashedAt: 'now' }]) expect(() => assetApplicationTarget([project], 'one', project.id, { ...file, ...changes })).toThrow('不可用');
  });
  it('Word图片插入当前段之后，不覆盖文字、原图片或其他对象', () => {
    const first = newWordBlock('paragraph', '原首段-END'), second = newWordBlock('paragraph', '原第二段-END');
    const document = { ...emptyEditorDocument('word', '原文档'), kind: 'word' as const, blocks: [first, second] };
    const result = insertDocumentAsset(document, first.id, file);
    if (result.document.kind !== 'word') throw new Error('Expected Word');
    expect(result.document.blocks).toHaveLength(3); expect(result.document.blocks[0]).toBe(first); expect(result.document.blocks[2]).toBe(second);
    expect(result.document.blocks[1]).toMatchObject({ id: result.selectedId, type: 'image', imageId: file.id, align: 'center', text: '' });
    expect(document.blocks).toEqual([first, second]); expect(file.name).toBe('留白背景.png');
  });
  it('PPT新增独立图片页，保留原页文字、旧图、备注和主题', () => {
    const first = { ...newEditorSlide('原页面'), body: '原正文-END', imageId: 'old-image', notes: '原备注' }, second = newEditorSlide('后续页');
    const document = { schemaVersion: 1 as const, kind: 'ppt' as const, title: '原提案', theme: 'forest' as const, slides: [first, second] };
    const result = insertDocumentAsset(document, first.id, file);
    if (result.document.kind !== 'ppt') throw new Error('Expected PPT');
    expect(result.document.slides).toHaveLength(3); expect(result.document.slides[0]).toBe(first); expect(result.document.slides[2]).toBe(second);
    expect(result.document.slides[1]).toMatchObject({ id: result.selectedId, title: '留白背景', layout: 'image-full', imageId: file.id, body: '', notes: '' });
    expect(result.document.theme).toBe('forest'); expect(document.slides).toHaveLength(2);
  });
  it('块/页面数量和Office图片大小超限时保留原内容，不冒充成功插入', () => {
    const word = { schemaVersion: 1 as const, kind: 'word' as const, title: '满文档', blocks: Array.from({ length: 500 }, () => newWordBlock()) };
    const ppt = { schemaVersion: 1 as const, kind: 'ppt' as const, title: '满演示', theme: 'paper' as const, slides: Array.from({ length: 100 }, () => newEditorSlide()) };
    expect(() => insertDocumentAsset(word, word.blocks[0].id, file)).toThrow('500'); expect(() => insertDocumentAsset(ppt, ppt.slides[0].id, file)).toThrow('100');
    expect(() => assertAssetImage(project.id, { ...file, bytes: 20 * 1024 * 1024 + 1 }, true)).toThrow('20 MB');
    expect(() => assertAssetImage(project.id, { ...file, mimeType: 'text/plain' })).toThrow('PNG');
    expect(word.blocks).toHaveLength(500); expect(ppt.slides).toHaveLength(100);
  });
  it.each(['word', 'ppt'] as const)('%s已含20张独立图片时拒绝第21张，复用已有ID不额外占量', kind => {
    const document = kind === 'word' ? { schemaVersion: 1 as const, kind, title: '20图文稿', blocks: Array.from({ length: 20 }, (_, index) => ({ ...newWordBlock('image'), imageId: `picture-${index}` })) } : { schemaVersion: 1 as const, kind, title: '20图演示', theme: 'paper' as const, slides: Array.from({ length: 20 }, (_, index) => ({ ...newEditorSlide(), layout: 'image-full' as const, imageId: `picture-${index}` })) };
    const before = JSON.stringify(document);
    expect(() => insertDocumentAsset(document, '', file)).toThrow('20 张独立图片'); expect(JSON.stringify(document)).toBe(before);
    const reused = insertDocumentAsset(document, '', { ...file, id: 'picture-0' });
    expect((reused.document.kind === 'word' ? reused.document.blocks : reused.document.slides)).toHaveLength(21);
    expect(JSON.stringify(document)).toBe(before);
  });
  it('图片工作台带入固定精修参考，保留描述/参数，解除旧gallery跟随，不携带费用', () => {
    const previous = { ...readImageDraft(null, '保留创作描述'), mode: 'refine' as const, refinePrompt: '保留精修指令', size: '1536x1024', quantity: 2, references: [{ id: 'old-image', name: '原图.png' }], galleryBaseId: 'old-image' };
    const result = imageDraftWithAsset(previous, project.id, file);
    expect(result).toMatchObject({ prompt: previous.prompt, refinePrompt: previous.refinePrompt, size: previous.size, quantity: 2, mode: 'refine', references: [{ id: file.id, name: file.name }], galleryBaseId: undefined });
    expect(previous.references[0].id).toBe('old-image'); expect(result).not.toHaveProperty('costCents');
  });
  it('直用形成可撤销/重做的编辑动作，撤销不删除文件引用源或改变17分账本', () => {
    const original = emptyEditorDocument('word', '文档'), inserted = insertDocumentAsset(original, original.kind === 'word' ? original.blocks[0].id : '', file).document;
    const ledger = Object.freeze([{ id: 'fee', costCents: 17 }]), before = JSON.stringify(ledger);
    const history = recordEdit(emptyEditHistory(), original, inserted), undone = undoEdit(history, inserted);
    expect(undone.value).toEqual(original); expect(redoEdit(undone.history, original).value).toEqual(inserted);
    expect(file.id).toBe('copied-image'); expect(JSON.stringify(ledger)).toBe(before);
  });
});


describe('工作台当前页素材放置', () => {
  it('PPT空图页保留双栏全文、备注与其他页，放图无需新增页', () => {
    const first = { ...newEditorSlide('当前页'), body: '左栏未保存文字\n---\n右栏未保存文字', notes: '保留备注', layout: 'two-columns' as const }, second = newEditorSlide('其他页');
    const document = { schemaVersion: 1 as const, kind: 'ppt' as const, title: '当前演示', theme: 'forest' as const, slides: [first, second] };
    const result = insertWorkbenchAsset(document, first.id, file);
    if (result.document.kind !== 'ppt') throw Error('Expected PPT');
    expect(result.selectedId).toBe(first.id); expect(result.document.slides).toHaveLength(2);
    expect(result.document.slides[0]).toMatchObject({ imageId: file.id, layout: 'image-right', body: '左栏未保存文字\n\n右栏未保存文字', notes: '保留备注' });
    expect(result.document.slides[1]).toBe(second); expect(first.body).toBe('左栏未保存文字\n---\n右栏未保存文字');
  });
  it('已有插图时新增图片页，不覆盖当前页；原位置丢失时不擅自换位置', () => {
    const first = { ...newEditorSlide('有图页'), imageId: 'old-image', body: '原文', layout: 'image-right' as const };
    const document = { schemaVersion: 1 as const, kind: 'ppt' as const, title: '演示', theme: 'paper' as const, slides: [first] };
    const result = insertWorkbenchAsset(document, first.id, file);
    if (result.document.kind !== 'ppt') throw Error('Expected PPT');
    expect(result.document.slides).toHaveLength(2); expect(result.document.slides[0]).toBe(first);
    expect(result.document.slides[1].imageId).toBe(file.id);
    expect(() => insertWorkbenchAsset(document, 'gone', file)).toThrow('原页面已更改');
  });
  it('第21张独立图被拒绝，但满100页且当前页空图时仍可放置已有图', () => {
    const slides = Array.from({ length: 100 }, (_, i) => ({ ...newEditorSlide(String(i)), ...(i < 20 ? { imageId: i === 0 ? file.id : `image-${i}` } : {}) }));
    const document = { schemaVersion: 1 as const, kind: 'ppt' as const, title: '演示', theme: 'paper' as const, slides };
    expect(() => insertWorkbenchAsset(document, slides[21].id, { ...file, id: 'new-image' })).toThrow('20');
    const result = insertWorkbenchAsset(document, slides[21].id, file);
    if (result.document.kind !== 'ppt') throw Error('Expected PPT');
    expect(result.document.slides).toHaveLength(100); expect(result.document.slides[21].imageId).toBe(file.id);
  });
});
