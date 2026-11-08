// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { businessDocumentFocus, businessSpreadsheetFocus, clearBusinessEditorFocus, readBusinessEditorFocus, saveBusinessEditorFocus } from './business-editor-focus';
import type { EditorDocument } from '../editor-types';
import type { SpreadsheetDocument } from '../spreadsheet-types';

describe('客户返修精确定位', () => {
  const word = { kind: 'word', blocks: [{ id: 'a', type: 'paragraph', text: '原价129元，保留产品参数。' }, { id: 'b', type: 'paragraph', text: '保留产品参数。' }] } as EditorDocument;
  it('使用真实段落ID或一基序号，不把重复选中文字定位到错误段落', () => {
    expect(businessDocumentFocus(word, { projectId: 'p', blockId: 'b' })).toBe('b');
    expect(businessDocumentFocus(word, { projectId: 'p', blockId: '2' })).toBe('b');
    expect(businessDocumentFocus(word, { projectId: 'p', selectedText: '129元' })).toBe('a');
    expect(businessDocumentFocus(word, { projectId: 'p', selectedText: '保留产品参数' })).toBeUndefined();
    expect(businessDocumentFocus(word, { projectId: 'p', blockId: '99' })).toBeUndefined();
  });
  it('Excel只接受当前工作表范围内地址', () => {
    const document = { kind: 'excel', sheets: [{ id: 's', name: '商品', rowCount: 10, columnCount: 5 }] } as SpreadsheetDocument;
    expect(businessSpreadsheetFocus(document, { projectId: 'p', blockId: '商品!B3' })).toEqual({ sheetId: 's', address: 'B3' });
    expect(businessSpreadsheetFocus(document, { projectId: 'p', blockId: '商品!B99' })).toBeUndefined();
    expect(businessSpreadsheetFocus(document, { projectId: 'p', blockId: '不存在!A1' })).toBeUndefined();
  });
  it('待处理定位仅在正确项目读取，消费后清除且不修改文档或费用', () => {
    sessionStorage.clear(); const before = JSON.stringify(word);
    saveBusinessEditorFocus(sessionStorage, { feedbackId: 'f', target: { projectId: 'p', blockId: 'a', selectedText: '129元' }, text: '改成99元' });
    expect(readBusinessEditorFocus(sessionStorage, 'other')).toBeUndefined();
    expect(readBusinessEditorFocus(sessionStorage, 'p')?.target.selectedText).toBe('129元');
    clearBusinessEditorFocus(sessionStorage, 'p'); expect(readBusinessEditorFocus(sessionStorage, 'p')).toBeUndefined(); expect(JSON.stringify(word)).toBe(before);
  });
});
