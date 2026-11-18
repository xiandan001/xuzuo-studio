import { RememberedDetails } from './RememberedDetails';
import { useMemo, useRef, useState } from 'react';
import type { DocumentPreviewImageContext } from '../document-preview-types';
import { useDocumentPreviewImages } from '../hooks/useDocumentPreviewImages';
import type { EditorKind, EditorDocument } from '../editor-types';
import type { SpreadsheetDocument } from '../spreadsheet-types';
import { documentPreview } from '../lib/document-preview';
import { EDITOR_THEMES } from '../lib/editor-document';
import { calculateSpreadsheet, columnLabel } from '../lib/spreadsheet-engine';
import { displaySpreadsheetCell } from '../lib/spreadsheet-ui';
import { Select } from './Select';
import './document-artifact-preview.css';

function DocumentPages({ document, imageContext }: { document: EditorDocument; imageContext?: DocumentPreviewImageContext }) {
  const root = useRef<HTMLElement>(null), images = useDocumentPreviewImages(document, root, imageContext);
  function image(unitId: string, imageId: string, caption: string) {
    const url = images.previews[imageId], error = images.previewErrors[imageId] || images.indexError || (images.indexReady && !images.allowed.has(imageId) ? '此插图已移除或暂不可用，请在编辑器中检查。' : '');
    const picture = url ? <img src={url} alt={caption || '文档插图'} loading="lazy" decoding="async" /> : null;
    return <figure className="dap-document-image" data-artifact-id={imageId} key={unitId}>
      {picture ? imageContext?.onEditUnit ? <button type="button" className="dap-image-open" aria-label={document.kind === 'ppt' ? '编辑此页插图' : '编辑此段插图'} onClick={() => imageContext.onEditUnit?.(unitId)}>{picture}<span>点击定位编辑</span></button> : picture : <div className="dap-image-placeholder" role={error ? 'alert' : 'status'}>{!imageContext ? '此预览未关联项目，插图可在原文件中查看。' : error || '正在读取实际插图…'}{imageContext && (error || !imageContext.runner.listProjectArtifacts) && <button type="button" className="text-button" onClick={images.retry}>重新读取</button>}</div>}
      {caption && <figcaption>{caption}</figcaption>}
    </figure>;
  }
  if (document.kind === 'word') return <article ref={root} className="dap-word" aria-label="Word 正文预览"><h1>{document.title}</h1>{document.blocks.map(block => {
    if (block.type === 'image' && block.imageId) return image(block.id, block.imageId, block.text);
    if (block.type === 'table' && block.table) return <div key={block.id} className="dap-word-table-scroll"><table className={`dap-word-table${block.table.borders ? ' with-borders' : ''}`} style={{ fontSize: `${block.fontSize * 4 / 3}px`, fontWeight: block.bold ? 700 : 400, fontStyle: block.italic ? 'italic' : 'normal', textAlign: block.align }}><tbody>{block.table.rows.map((row, rowIndex) => <tr key={row.id}>{row.cells.map(cell => block.table!.header && rowIndex === 0 ? <th key={cell.id} scope="col">{cell.text}</th> : <td key={cell.id}>{cell.text}</td>)}</tr>)}</tbody></table></div>;
    if (block.type === 'heading') return <h2 key={block.id}>{block.text}</h2>;
    return <p key={block.id} style={{ fontSize: `${block.fontSize * 4 / 3}px`, fontWeight: block.bold ? 700 : 400, fontStyle: block.italic ? 'italic' : 'normal', textAlign: block.align }}>{block.type === 'bullet' ? '• ' : ''}{block.text}</p>;
  })}</article>;
  const theme = EDITOR_THEMES[document.theme];
  return <section ref={root} className="dap-presentation" aria-label="PPT 逐页预览"><header><strong>{document.title}</strong><span>共 {document.slides.length} 页</span></header>{document.slides.map((slide, index) => <article key={slide.id}><div className={`dap-slide${slide.imageId ? ' has-image' : ''} layout-${slide.layout}`} style={{ background: theme.background, color: theme.text }}><div className="dap-slide-text"><h2>{slide.title}</h2><p style={{ textAlign: slide.align }}>{slide.body}</p></div>{slide.imageId && image(slide.id, slide.imageId, '')}<span style={{ color: theme.accent }}>{index + 1} / {document.slides.length}</span></div>{slide.notes && <RememberedDetails rememberKey={`document-preview:${slide.id}:notes`}><summary>讲解备注 · {slide.notes.length} 字</summary><p>{slide.notes}</p></RememberedDetails>}</article>)}</section>;
}

function WorkbookPages({ document }: { document: SpreadsheetDocument }) {
  const [sheetId, setSheetId] = useState(document.sheets[0].id);
  const [page, setPage] = useState(0);
  const sheet = document.sheets.find(item => item.id === sheetId) || document.sheets[0];
  const calculated = useMemo(() => { try { return { value: calculateSpreadsheet(document), error: '' }; } catch (cause) { return { value: undefined, error: cause instanceof Error ? cause.message : '公式暂未完成计算，原值仍保留。' }; } }, [document]);
  const pages = Math.ceil(sheet.rowCount / 50), start = Math.min(page, pages - 1) * 50;
  return <section className="dap-workbook" aria-label="Excel 表格预览"><header><strong>{document.title}</strong><Select aria-label="预览工作表" value={sheet.id} onValueChange={value => { setSheetId(value); setPage(0); }} options={document.sheets.map(item => ({ value: item.id, label: item.name }))} /></header><p>{sheet.rowCount} 行 × {sheet.columnCount} 列 · 多行单元格完整展开；所有行可翻页查看。</p>{calculated.error && <p role="alert">{calculated.error}</p>}<div className="dap-table-scroll"><table><thead><tr><th></th>{Array.from({ length: sheet.columnCount }, (_, index) => <th key={index}>{columnLabel(index + 1)}</th>)}</tr></thead><tbody>{Array.from({ length: Math.min(50, sheet.rowCount - start) }, (_, index) => start + index + 1).map(row => <tr key={row}><th>{row}</th>{Array.from({ length: sheet.columnCount }, (_, index) => { const address = `${columnLabel(index + 1)}${row}`, cell = sheet.cells[address]; return <td key={address} style={{ fontWeight: cell?.bold ? 700 : 400, textAlign: cell?.align }}>{displaySpreadsheetCell(cell, calculated.value?.cells[sheet.id]?.[address])}</td>; })}</tr>)}</tbody></table></div><footer><button disabled={page <= 0} onClick={() => setPage(value => value - 1)}>上一页</button><span>{Math.min(page, pages - 1) + 1} / {pages}</span><button disabled={page >= pages - 1} onClick={() => setPage(value => value + 1)}>下一页</button></footer></section>;
}

export function DocumentArtifactPreview({ text, title, hint, imageContext }: { text: string; title: string; hint?: EditorKind | 'excel'; imageContext?: DocumentPreviewImageContext }) {
  const [raw, setRaw] = useState(false);
  const parsed = useMemo(() => { try { return { preview: documentPreview(text, title, hint), error: '' }; } catch (cause) { return { preview: undefined, error: cause instanceof Error ? cause.message : '文档结构未通过检查，原始内容保留。' }; } }, [text, title, hint]);
  if (!parsed.preview && !parsed.error) return <pre className="ar-preview-text">{text}</pre>;
  return <section className="dap-preview"><div className="dap-view-options"><strong>{parsed.preview?.kind === 'word' ? 'Word 正文' : parsed.preview?.kind === 'ppt' ? 'PPT 页面' : parsed.preview ? 'Excel 表格' : '文档格式需要修正'}</strong><button aria-pressed={raw} onClick={() => setRaw(value => !value)}>{raw ? '返回文档视图' : '查看原始内容'}</button></div>{parsed.error && <p className="dap-error" role="alert">{parsed.error} 原文件已保留，可查看原始内容。</p>}{raw ? <pre className="ar-preview-text">{text}</pre> : parsed.preview?.kind === 'excel' ? <WorkbookPages document={parsed.preview.document} /> : parsed.preview ? <DocumentPages document={parsed.preview.document} imageContext={imageContext} /> : null}</section>;
}
