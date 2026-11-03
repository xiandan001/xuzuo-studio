import { useMemo, useState } from 'react';
import type { EditorKind, EditorDocument } from '../editor-types';
import type { SpreadsheetDocument } from '../spreadsheet-types';
import { documentPreview } from '../lib/document-preview';
import { EDITOR_THEMES } from '../lib/editor-document';
import { calculateSpreadsheet, columnLabel } from '../lib/spreadsheet-engine';
import { displaySpreadsheetCell } from '../lib/spreadsheet-ui';
import { Select } from './Select';
import './document-artifact-preview.css';

function DocumentPages({ document }: { document: EditorDocument }) {
  if (document.kind === 'word') return <article className="dap-word" aria-label="Word 正文预览"><h1>{document.title}</h1>{document.blocks.map(block => block.type === 'table' && block.table ? <div key={block.id} className="dap-word-table-scroll"><table className={`dap-word-table${block.table.borders ? ' with-borders' : ''}`} style={{ fontSize: `${block.fontSize * 4 / 3}px`, fontWeight: block.bold ? 700 : 400, fontStyle: block.italic ? 'italic' : 'normal', textAlign: block.align }}><tbody>{block.table.rows.map((row, rowIndex) => <tr key={row.id}>{row.cells.map(cell => block.table!.header && rowIndex === 0 ? <th key={cell.id} scope="col">{cell.text}</th> : <td key={cell.id}>{cell.text}</td>)}</tr>)}</tbody></table></div> : block.type === 'heading' ? <h2 key={block.id}>{block.text}</h2> : <p key={block.id} style={{ fontSize: `${block.fontSize * 4 / 3}px`, fontWeight: block.bold ? 700 : 400, fontStyle: block.italic ? 'italic' : 'normal', textAlign: block.align }}>{block.type === 'bullet' ? '• ' : ''}{block.type === 'image' ? `插图说明：${block.text || '图片在文档编辑器中查看'}` : block.text}</p>)}</article>;
  const theme = EDITOR_THEMES[document.theme];
  return <section className="dap-presentation" aria-label="PPT 逐页预览"><header><strong>{document.title}</strong><span>共 {document.slides.length} 页</span></header>{document.slides.map((slide, index) => <article key={slide.id}><div className="dap-slide" style={{ background: theme.background, color: theme.text }}><h2>{slide.title}</h2><p style={{ textAlign: slide.align }}>{slide.body}</p>{slide.imageId && <small>此页含插图，可进入编辑器查看。</small>}<span style={{ color: theme.accent }}>{index + 1} / {document.slides.length}</span></div>{slide.notes && <details><summary>讲解备注 · {slide.notes.length} 字</summary><p>{slide.notes}</p></details>}</article>)}</section>;
}

function WorkbookPages({ document }: { document: SpreadsheetDocument }) {
  const [sheetId, setSheetId] = useState(document.sheets[0].id);
  const [page, setPage] = useState(0);
  const sheet = document.sheets.find(item => item.id === sheetId) || document.sheets[0];
  const calculated = useMemo(() => { try { return { value: calculateSpreadsheet(document), error: '' }; } catch (cause) { return { value: undefined, error: cause instanceof Error ? cause.message : '公式暂未完成计算，原值仍保留。' }; } }, [document]);
  const pages = Math.ceil(sheet.rowCount / 50), start = Math.min(page, pages - 1) * 50;
  return <section className="dap-workbook" aria-label="Excel 表格预览"><header><strong>{document.title}</strong><Select aria-label="预览工作表" value={sheet.id} onValueChange={value => { setSheetId(value); setPage(0); }} options={document.sheets.map(item => ({ value: item.id, label: item.name }))} /></header><p>{sheet.rowCount} 行 × {sheet.columnCount} 列 · 多行单元格完整展开；所有行可翻页查看。</p>{calculated.error && <p role="alert">{calculated.error}</p>}<div className="dap-table-scroll"><table><thead><tr><th></th>{Array.from({ length: sheet.columnCount }, (_, index) => <th key={index}>{columnLabel(index + 1)}</th>)}</tr></thead><tbody>{Array.from({ length: Math.min(50, sheet.rowCount - start) }, (_, index) => start + index + 1).map(row => <tr key={row}><th>{row}</th>{Array.from({ length: sheet.columnCount }, (_, index) => { const address = `${columnLabel(index + 1)}${row}`, cell = sheet.cells[address]; return <td key={address} style={{ fontWeight: cell?.bold ? 700 : 400, textAlign: cell?.align }}>{displaySpreadsheetCell(cell, calculated.value?.cells[sheet.id]?.[address])}</td>; })}</tr>)}</tbody></table></div><footer><button disabled={page <= 0} onClick={() => setPage(value => value - 1)}>上一页</button><span>{Math.min(page, pages - 1) + 1} / {pages}</span><button disabled={page >= pages - 1} onClick={() => setPage(value => value + 1)}>下一页</button></footer></section>;
}

export function DocumentArtifactPreview({ text, title, hint }: { text: string; title: string; hint?: EditorKind | 'excel' }) {
  const [raw, setRaw] = useState(false);
  const parsed = useMemo(() => { try { return { preview: documentPreview(text, title, hint), error: '' }; } catch (cause) { return { preview: undefined, error: cause instanceof Error ? cause.message : '文档结构未通过检查，原始内容保留。' }; } }, [text, title, hint]);
  if (!parsed.preview && !parsed.error) return <pre className="ar-preview-text">{text}</pre>;
  return <section className="dap-preview"><div className="dap-view-options"><strong>{parsed.preview?.kind === 'word' ? 'Word 正文' : parsed.preview?.kind === 'ppt' ? 'PPT 页面' : parsed.preview ? 'Excel 表格' : '文档格式需要修正'}</strong><button aria-pressed={raw} onClick={() => setRaw(value => !value)}>{raw ? '返回文档视图' : '查看原始内容'}</button></div>{parsed.error && <p className="dap-error" role="alert">{parsed.error} 原文件已保留，可查看原始内容。</p>}{raw ? <pre className="ar-preview-text">{text}</pre> : parsed.preview?.kind === 'excel' ? <WorkbookPages document={parsed.preview.document} /> : parsed.preview ? <DocumentPages document={parsed.preview.document} /> : null}</section>;
}
