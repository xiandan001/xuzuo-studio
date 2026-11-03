import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PresentationEditorDocument, WordEditorDocument } from '../editor-types';
import { PresentationEditor } from '../components/PresentationEditor';
import { documentFieldChanges, documentFieldKey, documentFieldValue, updateDocumentField } from './document-fields';
const word: WordEditorDocument = { schemaVersion: 1, kind: 'word', title: '文档', blocks: [{ id: 'paragraph:a', type: 'paragraph', text: '甲段', fontSize: 12, bold: false, italic: false, align: 'left' }, { id: 'picture', type: 'image', text: '', imageId: 'image-one', fontSize: 12, bold: false, italic: false, align: 'center' }] };
const ppt: PresentationEditorDocument = { schemaVersion: 1, kind: 'ppt', title: '演示', theme: 'paper', slides: [{ id: 'slide:a', title: '标题', body: '\n右栏文字', notes: '备注', layout: 'two-columns', fontSize: 20, align: 'left' }] };
describe('文档局部字段定位', () => {
  it('稳定编号可含冒号，仅修改指定段落，保留其他对象引用', () => {
    const key = documentFieldKey('word', 'paragraph:a', 'text'), result = updateDocumentField(word, key, '精修后的甲段');
    expect(documentFieldValue(result, key)?.value).toBe('精修后的甲段');
    if (result.kind !== 'word') throw new Error('Expected Word');
    expect(result.blocks[1]).toBe(word.blocks[1]); expect(word.blocks[0].text).toBe('甲段');
    expect(documentFieldChanges(word, result)).toEqual([{ key, before: '甲段', after: '精修后的甲段' }]);
  });
  it('图片空值不写入无效空串，普通字段不能伪造或修改其他属性', () => {
    const empty = updateDocumentField(word, documentFieldKey('word', 'picture', 'imageId'), '');
    if (empty.kind !== 'word') throw new Error('Expected Word');
    expect(empty.blocks[1].imageId).toBeUndefined();
    expect(() => updateDocumentField(word, documentFieldKey('word', 'picture', '__proto__'), 'x')).toThrow('原编辑位置');
  });
  it('PPT右栏保留隐式换行偏移，空左栏仍定位正确；双栏正文不会复制进其他页面', () => {
    const html = renderToStaticMarkup(createElement(PresentationEditor, { document: ppt, onChange: () => {}, selectedId: 'slide:a', onSelect: () => {}, images: [], previews: {}, onImportImage: () => {} }));
    expect(html).toMatch(/data-edit-offset="1" aria-label="当前幻灯片右栏正文"/);
    const result = updateDocumentField(ppt, documentFieldKey('ppt', 'slide:a', 'notes'), '仅修改备注');
    if (result.kind !== 'ppt') throw new Error('Expected PPT');
    expect(result.slides[0].body).toBe('\n右栏文字'); expect(result.slides[0].notes).toBe('仅修改备注');
  });
});
