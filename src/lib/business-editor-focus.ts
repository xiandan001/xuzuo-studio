import type { BusinessFeedback } from '../business-types';
import type { EditorDocument } from '../editor-types';
import type { SpreadsheetDocument } from '../spreadsheet-types';
import { parseCellAddress } from './spreadsheet-engine';

export interface BusinessEditorFocus { feedbackId: string; target: BusinessFeedback['target']; text: string; }
const key = (projectId: string) => `xuzuo-business-editor-focus-v1:${projectId}`;
export function saveBusinessEditorFocus(storage: Pick<Storage, 'setItem'>, value: BusinessEditorFocus) { storage.setItem(key(value.target.projectId), JSON.stringify(value)); }
export function readBusinessEditorFocus(storage: Pick<Storage, 'getItem'>, projectId: string): BusinessEditorFocus | undefined {
  const raw = storage.getItem(key(projectId)); if (!raw) return;
  if (raw.length > 20000) throw Error('返修定位资料过长，请在制作单中重新选择位置。');
  const value = JSON.parse(raw) as BusinessEditorFocus;
  if (!value || value.target?.projectId !== projectId || typeof value.feedbackId !== 'string' || typeof value.text !== 'string') throw Error('返修定位不属于当前项目，请重新打开对应制作单。');
  return value;
}
export function clearBusinessEditorFocus(storage: Pick<Storage, 'removeItem'>, projectId: string) { storage.removeItem(key(projectId)); }
export function businessDocumentFocus(document: EditorDocument, target: BusinessFeedback['target']): string | undefined {
  const parts = document.kind === 'word' ? document.blocks : document.slides, requested = target.blockId || target.pageId;
  if (requested) { const direct = parts.find(part => part.id === requested); if (direct) return direct.id; if (/^[1-9]\d{0,3}$/.test(requested)) return parts[Number(requested) - 1]?.id; return; }
  if (target.selectedText) { const found = parts.filter(part => ('text' in part ? part.text : `${part.title}\n${part.body}`).includes(target.selectedText!)); if (found.length === 1) return found[0].id; return; }
  return parts[0]?.id;
}
export function businessSpreadsheetFocus(document: SpreadsheetDocument, target: BusinessFeedback['target']): { sheetId: string; address: string } | undefined {
  const value = target.blockId || target.pageId || 'A1', parts = value.split('!'), address = parts.at(-1)!.toUpperCase();
  const sheet = parts.length > 1 ? document.sheets.find(sheet => sheet.id === parts[0] || sheet.name === parts[0]) : document.sheets[0];
  try { const cell = parseCellAddress(address); if (!sheet || cell.row > sheet.rowCount || cell.column > sheet.columnCount) return; return { sheetId: sheet.id, address: cell.address }; } catch { return; }
}
export function focusBusinessDocumentField(root: HTMLElement | null, id: string, text?: string) {
  if (!root) return;
  const block = Array.from(root.querySelectorAll<HTMLElement>('[data-word-block]')).find(element => element.dataset.wordBlock === id);
  block?.scrollIntoView({ block: 'center', behavior: 'auto' });
  const fields = Array.from((block || root).querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-edit-field]')).filter(element => { try { return (JSON.parse(element.dataset.editField || '[]') as unknown[]).includes(id); } catch { return false; } });
  const field = text ? fields.find(element => element.value.includes(text)) || fields[0] : fields[0];
  if (!field) return;
  const details = field.closest('details'); if (details && !details.open) details.open = true;
  field.focus(); if (text) { const start = field.value.indexOf(text); if (start >= 0) { field.setSelectionRange(start, start + text.length); field.dispatchEvent(new Event('select', { bubbles: true })); } }
}
