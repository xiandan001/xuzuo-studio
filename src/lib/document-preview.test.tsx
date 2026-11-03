import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { documentPreview } from './document-preview';
import { DocumentArtifactPreview } from '../components/DocumentArtifactPreview';
describe('对应格式的完整文档预览', () => {
  it('Word完整章节与长段末尾都显示，原始JSON是辅助入口', () => {
    const text = JSON.stringify({ title: '客户执行方案', sections: [{ heading: '阶段安排', paragraphs: ['完整正文'.repeat(600) + 'END-WORD'] }] });
    const html = renderToStaticMarkup(<DocumentArtifactPreview text={text} title="result.txt" />);
    expect(html).toContain('Word 正文预览'); expect(html).toContain('END-WORD'); expect(html).toContain('查看原始内容'); expect(html).not.toContain('&quot;paragraphs&quot;');
  });
  it('PPT保留页数、末页和全部备注，Excel保留0/false/完整多行内容', () => {
    const text = JSON.stringify({ title: '计划', slides: [{ title: '第一页', bullets: ['具体执行'], notes: '讲解全文' }, { title: '末页', bullets: ['END-PPT'], notes: 'END-NOTES' }] });
    const html = renderToStaticMarkup(<DocumentArtifactPreview text={text} title="result.txt" />);
    expect(html).toContain('END-PPT'); expect(html).toContain('END-NOTES'); expect(documentPreview(text, '计划')?.kind).toBe('ppt');
    const excel = renderToStaticMarkup(<DocumentArtifactPreview text={JSON.stringify({ title: '清单', sheets: [{ name: '明细', columns: ['数量', '状态', '说明'], rows: [[0, false, '完整多行\nEND-XLSX']] }] })} title="result.txt" />);
    expect(excel).toContain('Excel 表格预览'); expect(excel).toContain('FALSE'); expect(excel).toContain('END-XLSX'); expect(excel).toContain('>0<');
  });
  it('报告JSON不被误认为成品，格式错误明确提示而不是空稿', () => {
    expect(documentPreview('{"type":"check-report","status":"ok"}', '检查报告', 'word')).toBeUndefined();
    const html = renderToStaticMarkup(<DocumentArtifactPreview text={'{"title":"未完成","sections":['} title="result.txt" hint="word" />);
    expect(html).toContain('role="alert"'); expect(html).toContain('原文件已保留');
  });
});
