import type { EditorDocument, EditorKind } from '../editor-types';
import type { SpreadsheetDocument } from '../spreadsheet-types';
import { editorFromText } from './editor-document';
import { spreadsheetFromText } from './spreadsheet-ui';
export type DocumentPreview = { kind: EditorKind; document: EditorDocument } | { kind: 'excel'; document: SpreadsheetDocument };
export function documentPreview(text: string, title: string, hint?: EditorKind | 'excel'): DocumentPreview | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let value: Record<string, unknown> | undefined;
  try { const parsed = JSON.parse(fenced ? fenced[1] : text); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) value = parsed; } catch { /* The strict document parser handles malformed document input below. */ }
  if ((value?.type || value?.status) && !value?.sections && !value?.slides && !value?.sheets && !value?.editorDocument && !value?.document) return undefined;
  const nested = value?.editorDocument || value?.document;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) value = nested as Record<string, unknown>;
  const kind = Array.isArray(value?.slides) ? 'ppt' : Array.isArray(value?.sections) || value?.kind === 'word' && Array.isArray(value?.blocks) ? 'word' : Array.isArray(value?.sheets) || Array.isArray(value?.rows) ? 'excel' : hint;
  if (!kind) return undefined;
  return kind === 'excel' ? { kind, document: spreadsheetFromText(text, title) } : { kind, document: editorFromText(kind, title, text) };
}
