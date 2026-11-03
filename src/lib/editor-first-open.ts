import type { EditorDocument, EditorRecord } from '../editor-types';

export function isPristineEditorDocument(document: EditorDocument, projectTitle: string): boolean {
  if (document.title !== projectTitle) return false;
  if (document.kind === 'word') {
    const item = document.blocks[0];
    return document.blocks.length === 1 && !!item && item.type === 'paragraph' && item.text === '' && item.fontSize === 12 && item.align === 'left' && !item.bold && !item.italic && !item.imageId;
  }
  const item = document.slides[0];
  return document.theme === 'paper' && document.slides.length === 1 && !!item && item.title === projectTitle && item.body === '' && item.notes === '' && item.layout === 'title-body' && item.fontSize === 20 && item.align === 'left' && !item.imageId;
}
export function canAutoLoadEditorSource(document: EditorDocument, projectTitle: string, record: EditorRecord | null, sourceArtifactIds: string[], manualEdits: number): boolean {
  return manualEdits === 0 && !sourceArtifactIds.length && (!record || record.revision === 1) && isPristineEditorDocument(document, projectTitle) && (!record || isPristineEditorDocument(record.document, projectTitle));
}
