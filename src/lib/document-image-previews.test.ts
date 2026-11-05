import { describe, expect, it } from 'vitest';
import { createDocumentImagePreviewCache, documentPreviewIds } from './document-image-previews';
import type { EditorDocument } from '../editor-types';
import { emptyEditorDocument, newEditorSlide, newWordBlock } from './editor-document';
describe('按需文档插图预览', () => {
  it('PPT只请求当前页和明确所选工具图片，其他页面不触发原图预览', () => {
    const doc = { ...emptyEditorDocument('ppt', '演示'), slides: Array.from({ length: 25 }, (_, index) => ({ ...newEditorSlide(), id: 'page-' + index, imageId: 'image-' + index })) } as EditorDocument;
    expect(documentPreviewIds(doc, 'page-7', ['image-1', 'image-24'])).toEqual(['image-7']);
    expect(documentPreviewIds(doc, 'page-7', [], 'tool-image')).toEqual(['image-7', 'tool-image']);
  });
  it('Word选中的插图优先，其后只取实际邻近候选，最多四张', () => {
    const doc = emptyEditorDocument('word', '稿'); if (doc.kind !== 'word') throw Error('Word');
    doc.blocks = ['near-1', 'near-2', 'near-3', 'near-4', 'near-5'].map(imageId => ({ ...newWordBlock('image'), imageId }));
    expect(documentPreviewIds(doc, '', ['removed-old-id', 'near-1', 'near-2', 'near-3', 'near-4', 'near-5'], 'selected')).toEqual(['selected', 'near-1', 'near-2', 'near-3']);
  });
  it('缓存按数量和UTF16内存上限淘汰，输出中不携带未请求页面的dataURL', () => {
    const cache = createDocumentImagePreviewCache({ maxEntries: 2, maxBytes: 40 });
    cache.put('one', '1111111111', ['one']); cache.put('two', '2222222222', ['two']); cache.put('three', '3333333333', ['three']);
    expect(cache.has('one')).toBe(false); expect(cache.stats()).toEqual({ entries: 2, bytes: 40 }); expect(cache.snapshot(['three'])).toEqual({ three: '3333333333' }); cache.clear(); expect(cache.stats().bytes).toBe(0);
  });
  it('超大当前图或邻近图都明确拒绝，原缓存和严格内存上限保持', () => {
    const cache = createDocumentImagePreviewCache({ maxBytes: 10 }); expect(cache.put('small', '12345', ['small'])).toBe(true);
    expect(cache.put('current', 'large-image', ['current'])).toBe(false); expect(cache.put('prefetch', 'other-large', ['current', 'prefetch'])).toBe(false);
    expect(cache.snapshot(['small'])).toEqual({ small: '12345' }); expect(cache.stats()).toEqual({ entries: 1, bytes: 10 });
  });
  it('最近读取项被保留，失去可视优先级的项先淘汰；重复写入不累计内存', () => {
    const cache = createDocumentImagePreviewCache({ maxEntries: 3, maxBytes: 24 });
    cache.put('one', '1111', []); cache.put('two', '2222', []); cache.put('three', '3333', []); cache.snapshot(['one']);
    cache.put('four', '4444', []); expect(cache.has('two')).toBe(false); expect(cache.has('one')).toBe(true);
    cache.put('four', '44', ['three']); expect(cache.stats()).toEqual({ entries: 3, bytes: 20 });
    cache.put('five', '5555', ['one', 'three']); expect(cache.has('four')).toBe(false); expect(cache.stats()).toEqual({ entries: 3, bytes: 24 });
  });
});
