import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { WordEditorDocument } from '../editor-types';
import { newWordBlock } from '../lib/editor-document';
import { WordEditor } from './WordEditor';
import { wordBlockViewPropsEqual } from './WordBlockView';
import type { WordBlockViewProps } from './WordBlockView';
import { DocumentArtifactPreview } from './DocumentArtifactPreview';

describe('Word 表格编辑与段落渲染边界', () => {
  it('原生表格有逐格字段、结构管理和表头边框开关，插入入口可见', () => {
    const block = newWordBlock('table'); block.table!.rows[1].cells[1].text = '末格原文-END';
    const document: WordEditorDocument = { schemaVersion: 1, kind: 'word', title: '可编辑表格', blocks: [block] };
    const html = renderToStaticMarkup(<WordEditor document={document} onChange={() => undefined} selectedId={block.id} onSelect={() => undefined} images={[]} previews={{}} onImportImage={() => undefined} />);
    for (const text of ['文档表格 1', '表格 1 第 2 行第 2 列', '末格原文-END', '增加行', '删除行', '增加列', '删除列', '首行为表头', '显示边框', '插入表格']) expect(html).toContain(text);
    expect(html.match(/<th /g)).toHaveLength(2); expect(html.match(/<textarea /g)).toHaveLength(4); expect(html).not.toContain('段落 1 内容');
  });
  it('只更新其它块或父级对象时未变段落命中 memo；选中、格式和自身内容变化更新', () => {
    const block = newWordBlock('paragraph', '稳定正文'), other = newWordBlock('paragraph', '另一段');
    const props: WordBlockViewProps = { block, blockIndex: 0, selected: false, onSelect: () => undefined, onUpdate: () => undefined, onTableChange: () => undefined };
    const blocks = [block, other].map(item => item.id === other.id ? { ...item, text: '仅修改另一段' } : item);
    expect(blocks[0]).toBe(block); expect(wordBlockViewPropsEqual(props, { ...props, block: blocks[0] })).toBe(true);
    expect(wordBlockViewPropsEqual(props, { ...props, selected: true })).toBe(false);
    expect(wordBlockViewPropsEqual(props, { ...props, block: { ...block, fontSize: 14 } })).toBe(false);
    expect(wordBlockViewPropsEqual(props, { ...props, block: { ...block, text: '变更正文' } })).toBe(false);
    expect(wordBlockViewPropsEqual(props, { ...props, disabled: true })).toBe(false);
  });
  it('生成产物预览展示真实表格单元格文字及边框，无需进入编辑器', () => {
    const block = newWordBlock('table'); block.table!.rows[1].cells[1].text = '预览末格-END';
    const document: WordEditorDocument = { schemaVersion: 1, kind: 'word', title: '预览表格', blocks: [block] };
    const html = renderToStaticMarkup(<DocumentArtifactPreview text={JSON.stringify(document)} title="备用" hint="word" />);
    expect(html).toContain('dap-word-table with-borders'); expect(html).toContain('预览末格-END'); expect(html.match(/<th /g)).toHaveLength(2); expect(html.match(/<td/g)).toHaveLength(2);
  });
});
