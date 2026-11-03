import type { EditorDocument } from '../editor-types';

export interface DocumentFieldChange { key: string; before: string; after: string; }
export const documentFieldKey = (...parts: string[]) => JSON.stringify(parts);
export function documentFieldValue(document: EditorDocument, key: string): { value: string; label: string; image: boolean } | undefined {
  let parts: string[]; try { parts = JSON.parse(key); } catch { return; }
  if (!Array.isArray(parts) || parts.some(part => typeof part !== 'string')) return;
  if (parts[0] === 'title' && parts.length === 1) return { value: document.title, label: '文档标题', image: false };
  if (document.kind === 'word' && parts[0] === 'word' && parts.length === 3) {
    const index = document.blocks.findIndex(block => block.id === parts[1]), block = document.blocks[index]; if (!block) return;
    if (parts[2] === 'text') return { value: block.text, label: `第 ${index + 1} 段${block.type === 'image' ? '图片说明' : '文字'}`, image: false };
    if (parts[2] === 'imageId' && block.type === 'image') return { value: block.imageId || '', label: `第 ${index + 1} 段插图`, image: true };
  }
  if (document.kind === 'word' && parts[0] === 'cell' && parts.length === 3) {
    const block = document.blocks.find(block => block.id === parts[1]);
    const cell = block?.table?.rows.flatMap(row => row.cells).find(cell => cell.id === parts[2]);
    if (cell) return { value: cell.text, label: '当前表格单元格文字', image: false };
  }
  if (document.kind === 'ppt' && parts[0] === 'ppt' && parts.length === 3) {
    const index = document.slides.findIndex(slide => slide.id === parts[1]), slide = document.slides[index]; if (!slide) return;
    if (['title', 'body', 'notes', 'imageId'].includes(parts[2])) {
      const field = parts[2] as 'title' | 'body' | 'notes' | 'imageId';
      return { value: slide[field] || '', label: `第 ${index + 1} 页${{ title: '标题', body: '正文', notes: '备注', imageId: '插图' }[field]}`, image: field === 'imageId' };
    }
  }
}
export function updateDocumentField(document: EditorDocument, key: string, value: string): EditorDocument {
  const current = documentFieldValue(document, key); if (!current) throw new Error('原编辑位置已移除，请重新选择内容。');
  if (current.image && value && !/^[A-Za-z0-9._:-]{1,160}$/.test(value)) throw new Error('图片历史编号无效。');
  const parts = JSON.parse(key) as string[];
  if (parts[0] === 'title') return { ...document, title: value };
  if (document.kind === 'word' && parts[0] === 'cell') return { ...document, blocks: document.blocks.map(block => block.id === parts[1] && block.table ? { ...block, table: { ...block.table, rows: block.table.rows.map(row => row.cells.some(cell => cell.id === parts[2]) ? { ...row, cells: row.cells.map(cell => cell.id === parts[2] ? { ...cell, text: value } : cell) } : row) } } : block) };
  if (document.kind === 'word') return { ...document, blocks: document.blocks.map(block => block.id === parts[1] ? { ...block, [parts[2]]: value || parts[2] !== 'imageId' ? value : undefined } : block) };
  return { ...document, slides: document.slides.map(slide => slide.id === parts[1] ? { ...slide, [parts[2]]: value || parts[2] !== 'imageId' ? value : undefined } : slide) };
}
export function documentFieldChanges(before: EditorDocument, after: EditorDocument): DocumentFieldChange[] {
  if (before.kind !== after.kind) return [];
  const changes: DocumentFieldChange[] = [];
  const add = (key: string, previous: string | undefined, next: string | undefined) => { if ((previous || '') !== (next || '')) changes.push({ key, before: previous || '', after: next || '' }); };
  add(documentFieldKey('title'), before.title, after.title);
  if (before.kind === 'word' && after.kind === 'word' && before.blocks !== after.blocks) {
    const old = new Map(before.blocks.map(block => [block.id, block]));
    for (const block of after.blocks) {
      const previous = old.get(block.id); if (!previous || previous === block) continue;
      add(documentFieldKey('word', block.id, 'text'), previous.text, block.text);
      if (previous.type === 'image' && block.type === 'image') add(documentFieldKey('word', block.id, 'imageId'), previous.imageId, block.imageId);
      if (block.table && previous.table && block.table !== previous.table) {
        const cells = new Map(previous.table.rows.flatMap(row => row.cells).map(cell => [cell.id, cell.text]));
        for (const cell of block.table.rows.flatMap(row => row.cells)) if (cells.has(cell.id)) add(documentFieldKey('cell', block.id, cell.id), cells.get(cell.id), cell.text);
      }
    }
  }
  if (before.kind === 'ppt' && after.kind === 'ppt' && before.slides !== after.slides) {
    const old = new Map(before.slides.map(slide => [slide.id, slide]));
    for (const slide of after.slides) { const previous = old.get(slide.id); if (!previous || previous === slide) continue; for (const field of ['title', 'body', 'notes', 'imageId'] as const) add(documentFieldKey('ppt', slide.id, field), previous[field], slide[field]); }
  }
  return changes;
}
