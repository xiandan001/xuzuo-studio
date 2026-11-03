import type { EditorDocument, EditorKind, EditorSlide, WordBlock } from '../editor-types';
import { editorFromText } from './editor-generated';
import { newWordTable, wordTableText } from './word-table';

export const EDITOR_THEMES = { paper: { background: '#F7F8FC', text: '#243047', accent: '#6354CF' }, violet: { background: '#F0ECFC', text: '#30264F', accent: '#6D53CE' }, forest: { background: '#EDF3ED', text: '#294934', accent: '#547B58' }, night: { background: '#202A3E', text: '#F4F6FC', accent: '#BEB4FF' } };
export function newWordBlock(type: WordBlock['type'] = 'paragraph', text = ''): WordBlock {
  return { id: crypto.randomUUID(), type, text: type === 'table' ? '' : text, fontSize: type === 'heading' ? 18 : 12, bold: type === 'heading', italic: false, align: 'left', ...(type === 'table' ? { table: newWordTable() } : {}) };
}
export function newEditorSlide(title = '新页面'): EditorSlide {
  return { id: crypto.randomUUID(), title, body: '', notes: '', layout: 'title-body', fontSize: 20, align: 'left' };
}
export function slideColumns(body: string): [string, string] {
  const explicit = body.indexOf('\n---\n');
  if (explicit >= 0) return [body.slice(0, explicit), body.slice(explicit + 5)];
  const lines = body.split('\n'), middle = Math.ceil(lines.length / 2);
  return [lines.slice(0, middle).join('\n'), lines.slice(middle).join('\n')];
}
export function withSlideLayout(slide: EditorSlide, layout: EditorSlide['layout']): EditorSlide {
  return { ...slide, layout, body: slide.layout === 'two-columns' && layout !== 'two-columns' ? slideColumns(slide.body).join('\n\n') : slide.body };
}
export function emptyEditorDocument(kind: EditorKind, title: string): EditorDocument {
  return kind === 'word' ? { schemaVersion: 1, kind, title, blocks: [newWordBlock()] } : { schemaVersion: 1, kind, title, theme: 'paper', slides: [newEditorSlide(title)] };
}
export function editorPlainText(document: EditorDocument): string {
  return document.kind === 'word' ? [document.title, ...document.blocks.map(block => block.type === 'table' && block.table ? wordTableText(block.table) : block.text)].join('\n\n') : [document.title, ...document.slides.map(slide => `${slide.title}\n${slide.body}${slide.notes ? `\n备注：${slide.notes}` : ''}`)].join('\n\n');
}
export { editorFromText, editorMissingInputs } from './editor-generated';
export function legacyEditorDocument(projectId: string, kind: EditorKind, title: string): EditorDocument | undefined {
  try {
    const raw = localStorage.getItem(`xuzuo.document.${projectId}`); if (!raw) return undefined;
    const old = JSON.parse(raw);
    if (kind === 'word' && typeof old.body === 'string') return editorFromText(kind, old.title || title, old.body);
    if (kind === 'ppt' && Array.isArray(old.slides)) return editorFromText(kind, old.title || title, JSON.stringify({ slides: old.slides }));
  } catch { /* An invalid old browser draft never replaces the project source. */ }
  return undefined;
}
