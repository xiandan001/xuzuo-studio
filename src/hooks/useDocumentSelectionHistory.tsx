import { useEffect, useRef, useState } from 'react';
import type { SyntheticEvent } from 'react';
import type { EditorDocument } from '../editor-types';
import { documentFieldChanges, documentFieldKey, documentFieldValue, updateDocumentField } from '../lib/document-fields';
import { useScopedTextHistory } from './useScopedTextHistory';
import { SelectionHistoryToolbar } from '../components/SelectionHistoryToolbar';

interface Selection { key: string; start: number; end: number; exact: boolean; text?: string; element?: HTMLInputElement | HTMLTextAreaElement; }
interface Props { document: EditorDocument; selectedId: string; selectedCellId: string; enabled: boolean; onApply: (document: EditorDocument, expected: EditorDocument) => void | Promise<void>; }
function fallbackField(document: EditorDocument, selectedId: string, selectedCellId: string) {
  if (document.kind === 'ppt') return documentFieldKey('ppt', selectedId || document.slides[0]?.id || '', 'body');
  const block = document.blocks.find(block => block.id === selectedId) || document.blocks[0];
  return selectedCellId && block?.type === 'table' ? documentFieldKey('cell', block.id, selectedCellId) : documentFieldKey('word', block?.id || '', block?.type === 'image' ? 'imageId' : 'text');
}
export function useDocumentSelectionHistory({ document, selectedId, selectedCellId, enabled, onApply }: Props) {
  const history = useScopedTextHistory(), [selection, setSelection] = useState<Selection>(), [feedback, setFeedback] = useState(''), [applying, setApplying] = useState(false);
  const current = useRef({ document, selectedId, selectedCellId, enabled, onApply }); current.current = { document, selectedId, selectedCellId, enabled, onApply };
  const restoring = useRef(false), frame = useRef<number | undefined>(undefined);
  useEffect(() => () => { if (frame.current !== undefined) cancelAnimationFrame(frame.current); }, []);
  function reset() { history.reset(); setSelection(undefined); setFeedback(''); }
  function capture(event: SyntheticEvent) {
    if (restoring.current) return;
    const element = event.target;
    if (!(element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) || !element.dataset.editField || element.disabled) return;
    const field = documentFieldValue(current.current.document, element.dataset.editField); if (!field || field.image) return;
    const offset = Number(element.dataset.editOffset || 0), start = (element.selectionStart || 0) + offset, end = (element.selectionEnd || 0) + offset;
    const next: Selection = { key: element.dataset.editField, start, end, exact: end > start, text: field.value.slice(start, end), element };
    setSelection(previous => {
      const same = previous?.key === next.key && previous.start === start && previous.end === end && previous.element === element && previous.text === next.text;
      return same && (previous.exact === next.exact || previous.exact && start === end) ? previous : next;
    }); setFeedback('');
  }
  const key = selection?.key || fallbackField(document, selectedId, selectedCellId);
  const field = documentFieldValue(document, key);
  const exact = !!selection?.exact && !field?.image;
  const start = exact ? selection!.start : 0, end = exact ? selection!.end : field?.value.length || 0;
  const stale = exact && (!field || start < 0 || end > field.value.length || field.value.slice(start, end) !== selection?.text);
  const conflict = { available: false, reason: '原选中文字已经变化，请重新用鼠标选择；当前内容未修改。' };
  const undo = stale ? conflict : history.inspect('undo', key, field?.value || '', start, end), redo = stale ? conflict : history.inspect('redo', key, field?.value || '', start, end);
  async function move(direction: 'undo' | 'redo') {
    const snapshot = current.current, activeKey = selection?.key || fallbackField(snapshot.document, snapshot.selectedId, snapshot.selectedCellId), active = documentFieldValue(snapshot.document, activeKey);
    if (!snapshot.enabled || !active || applying) return;
    if (selection?.exact && (selection.end > active.value.length || active.value.slice(selection.start, selection.end) !== selection.text)) { setFeedback(conflict.reason); return; }
    const range = selection?.exact && !active.image ? [selection.start, selection.end] : [0, active.value.length];
    const result = history.preview(direction, activeKey, active.value, range[0], range[1]);
    if (!result.available || result.value === undefined) { setFeedback(result.reason || '该位置没有可恢复的局部修改。'); return; }
    try {
      setApplying(true);
      await snapshot.onApply(updateDocumentField(snapshot.document, activeKey, result.value), snapshot.document);
      history[direction](activeKey, active.value, range[0], range[1]);
      const next = { key: activeKey, start: result.selectionStart ?? 0, end: result.selectionEnd ?? result.value.length, exact: !!selection?.exact && !active.image, text: result.value.slice(result.selectionStart ?? 0, result.selectionEnd ?? result.value.length), element: selection?.element };
      setSelection(next); setFeedback(`已${direction === 'undo' ? '撤销' : '重做'}${next.exact ? '选中内容' : active.image ? '所选图片' : '当前字段'}，其余内容保留。`);
      if (next.element?.isConnected) {
        restoring.current = true;
        if (frame.current !== undefined) cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() => {
          const element = next.element!; if (element.isConnected && element.dataset.editField === activeKey) {
            const offset = Number(element.dataset.editOffset || 0); element.focus({ preventScroll: true }); element.setSelectionRange(Math.max(0, next.start - offset), Math.min(element.value.length, Math.max(0, next.end - offset)));
          }
          frame.current = requestAnimationFrame(() => { restoring.current = false; frame.current = undefined; });
        });
      }
    } catch (cause) { setFeedback(cause instanceof Error ? cause.message : '局部修改未应用。'); }
    finally { setApplying(false); }
  }
  function recordChanges(previous: EditorDocument, next: EditorDocument) { for (const change of documentFieldChanges(previous, next)) history.record(change.key, change.before, change.after); }
  function chooseContent(id: string, image = false) {
    if (image) setSelection({ key: documentFieldKey(current.current.document.kind, id, 'imageId'), start: 0, end: 0, exact: false });
    else if (id !== current.current.selectedId) setSelection(undefined);
    setFeedback('');
  }
  const toolbar = (field || selection) && (exact || undo.available || redo.available || feedback) && <SelectionHistoryToolbar label={field?.label || '原选区不可用'} image={field?.image} exactSelection={exact} selectedCount={exact ? Array.from(selection?.text || '').length : 0} selectionPreview={exact ? selection?.text : undefined} canUndo={undo.available} canRedo={redo.available} disabled={!enabled || applying} reason={feedback || (!undo.available && !redo.available ? undo.reason || redo.reason : undefined)} onUndo={() => { void move('undo'); }} onRedo={() => { void move('redo'); }} onClearSelection={() => { setSelection(previous => previous ? { ...previous, exact: false } : previous); setFeedback(''); }} />;
  return { reset, capture, recordChanges, chooseContent, toolbar };
}
