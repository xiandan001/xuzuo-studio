import { textBoundary, textDeltas } from './text-delta';
import type { DiffBudget, TextDelta } from './text-delta';

export type ScopedTextDirection = 'undo' | 'redo';
interface TextTransaction { id: number; fieldKey: string; before: string; after: string; changes: TextDelta[]; }
export interface ScopedTextHistory { past: TextTransaction[]; future: TextTransaction[]; sequence: number; barriers: Record<string, { id: number; reason: string }>; }
export interface ScopedTextResult { available: boolean; reason?: string; value?: string; selectionStart?: number; selectionEnd?: number; }
export const SCOPED_TEXT_HISTORY_LIMIT = 40;
export const SCOPED_TEXT_HISTORY_CHARACTERS = 256000;
const budgetMessage = '这次文字变化超出局部对比范围，请使用整篇撤销；当前文字未修改。';
const conflictMessage = '选中文字与后续修改重叠，无法安全定位原变化；请使用整篇撤销或重新选择。';
const partialMessage = '选区只覆盖一次文字替换的一部分，请选中完整替换内容后再试。';
export const emptyScopedTextHistory = (): ScopedTextHistory => ({ past: [], future: [], sequence: 0, barriers: {} });
function bounded(history: ScopedTextHistory): ScopedTextHistory {
  let past = [...history.past], future = [...history.future];
  const weight = (items: TextTransaction[]) => items.reduce((sum, item) => sum + item.before.length + item.after.length + item.changes.reduce((total, delta) => total + delta.before.length + delta.after.length, 0), 0);
  while (past.length + future.length > SCOPED_TEXT_HISTORY_LIMIT || weight(past) + weight(future) > SCOPED_TEXT_HISTORY_CHARACTERS) {
    if (!past.length && !future.length) break;
    if (past.length && (!future.length || past[0].id < future[0].id)) past = past.slice(1); else future = future.slice(1);
  }
  const retainedFields = new Set([...past, ...future].map(item => item.fieldKey));
  return { ...history, past, future, barriers: Object.fromEntries(Object.entries(history.barriers).sort((a, b) => b[1].id - a[1].id).filter(([key], index) => index < SCOPED_TEXT_HISTORY_LIMIT || retainedFields.has(key))) };
}
export function recordScopedText(history: ScopedTextHistory, fieldKey: string, before: string, after: string): ScopedTextHistory {
  if (!fieldKey || before === after) return history;
  const changes = textDeltas(before, after), id = history.sequence + 1;
  if (!changes) return bounded({ ...history, sequence: id, future: [], barriers: { ...history.barriers, [fieldKey]: { id, reason: budgetMessage } } });
  return bounded({ ...history, sequence: id, future: [], past: [...history.past, { id, fieldKey, before, after, changes }] });
}
interface LocatedChange { index: number; start: number; end: number; expected: string; replacement: string; relativeStart?: number; }
function locate(change: TextDelta, direction: ScopedTextDirection, snapshot: string, current: string, intervening: TextDelta[]): Omit<LocatedChange, 'index'> | undefined {
  let start = direction === 'undo' ? change.afterStart : change.beforeStart, end = direction === 'undo' ? change.afterEnd : change.beforeEnd;
  const originalStart = start, originalEnd = end;
  for (const delta of intervening) {
    const zeroTarget = originalStart === originalEnd;
    if (zeroTarget && delta.beforeStart === originalStart && delta.beforeEnd === originalStart) return undefined;
    if (delta.beforeEnd <= originalStart) { start += delta.after.length - delta.before.length; end += delta.after.length - delta.before.length; }
    else if (delta.beforeStart < originalEnd) return undefined;
  }
  const expected = direction === 'undo' ? change.after : change.before, replacement = direction === 'undo' ? change.before : change.after;
  if (current.slice(start, end) !== expected) return undefined;
  if (snapshot !== current) {
    const context = snapshot.slice(Math.max(0, originalStart - 24), Math.min(snapshot.length, originalEnd + 24));
    const first = context ? current.indexOf(context) : -1;
    if (first >= 0 && current.indexOf(context, first + 1) >= 0) return undefined;
  }
  return { start, end, expected, replacement };
}
interface Prepared { result: ScopedTextResult; transaction?: TextTransaction; operations?: LocatedChange[]; }
function prepare(history: ScopedTextHistory, direction: ScopedTextDirection, fieldKey: string, current: string, selectionStart: number, selectionEnd: number): Prepared {
  if (!textBoundary(current, selectionStart) || !textBoundary(current, selectionEnd) || selectionStart > selectionEnd) return { result: { available: false, reason: '请重新选择完整文字，不能拆开一个字符。' } };
  const items = direction === 'undo' ? history.past : history.future, budget: DiffBudget = { cells: 1200000 };
  let conflict = false;
  for (const transaction of [...items].reverse()) {
    if (transaction.fieldKey !== fieldKey) continue;
    const barrier = history.barriers[fieldKey];
    if (direction === 'undo' && barrier && transaction.id <= barrier.id) return { result: { available: false, reason: barrier.reason } };
    const snapshot = direction === 'undo' ? transaction.after : transaction.before;
    const outsideStablePrefix = transaction.changes.every(change => {
      const start = direction === 'undo' ? change.afterStart : change.beforeStart, end = direction === 'undo' ? change.afterEnd : change.beforeEnd;
      return start === end ? start > selectionEnd : start >= selectionEnd;
    });
    if (outsideStablePrefix && snapshot.length >= selectionEnd && current.startsWith(snapshot.slice(0, selectionEnd))) continue;
    const intervening = textDeltas(snapshot, current, budget);
    if (!intervening) return { result: { available: false, reason: budgetMessage } };
    const operations: LocatedChange[] = [];
    for (let index = 0; index < transaction.changes.length; index++) {
      const original = transaction.changes[index], mapped = locate(original, direction, snapshot, current, intervening);
      if (!mapped) { conflict = true; continue; }
      const overlaps = mapped.start === mapped.end ? mapped.start >= selectionStart && mapped.start <= selectionEnd : mapped.start < selectionEnd && mapped.end > selectionStart;
      if (!overlaps) continue;
      if (mapped.start < selectionStart || mapped.end > selectionEnd) {
        if (mapped.replacement) return { result: { available: false, reason: partialMessage } };
        const start = Math.max(mapped.start, selectionStart), end = Math.min(mapped.end, selectionEnd);
        operations.push({ ...mapped, start, end, expected: current.slice(start, end), index, relativeStart: start - mapped.start });
      } else operations.push({ ...mapped, index });
    }
    if (operations.length) return { result: { available: true }, transaction, operations };
  }
  return { result: { available: false, reason: direction === 'undo' && history.barriers[fieldKey] ? history.barriers[fieldKey].reason : conflict ? conflictMessage : selectionStart === selectionEnd ? '请先用鼠标选中需要操作的文字。' : `选中文字没有可${direction === 'undo' ? '撤销' : '重做'}的变化。` } };
}
export function inspectScopedText(history: ScopedTextHistory, direction: ScopedTextDirection, fieldKey: string, current: string, selectionStart: number, selectionEnd: number): ScopedTextResult {
  return prepare(history, direction, fieldKey, current, selectionStart, selectionEnd).result;
}
function remainingChanges(transaction: TextTransaction, operations: LocatedChange[], direction: ScopedTextDirection): TextDelta[] {
  return transaction.changes.flatMap((change, index) => {
    const operation = operations.find(item => item.index === index);
    if (!operation) return [change];
    const expected = direction === 'undo' ? change.after : change.before;
    // A partial pure insertion is split in its original snapshot coordinates.
    if (operation.expected.length === expected.length) return [];
    const start = operation.relativeStart || 0, end = start + operation.expected.length;
    const left = expected.slice(0, start), right = expected.slice(end), result: TextDelta[] = [];
    if (direction === 'undo') {
      if (left) result.push({ ...change, after: left, afterEnd: change.afterStart + left.length });
      if (right) result.push({ ...change, after: right, afterStart: change.afterStart + end });
    } else {
      if (left) result.push({ ...change, before: left, beforeEnd: change.beforeStart + left.length });
      if (right) result.push({ ...change, before: right, beforeStart: change.beforeStart + end });
    }
    return result;
  });
}
export function applyScopedText(history: ScopedTextHistory, direction: ScopedTextDirection, fieldKey: string, current: string, selectionStart: number, selectionEnd: number): { history: ScopedTextHistory; result: ScopedTextResult } {
  const prepared = prepare(history, direction, fieldKey, current, selectionStart, selectionEnd);
  if (!prepared.result.available || !prepared.transaction || !prepared.operations) return { history, result: prepared.result };
  const operations = [...prepared.operations].sort((a, b) => a.start - b.start), changes: TextDelta[] = [];
  let value = current, shift = 0;
  for (const operation of [...operations].reverse()) value = value.slice(0, operation.start) + operation.replacement + value.slice(operation.end);
  for (const operation of operations) {
    const beforeStart = operation.start + shift, afterStart = operation.start;
    changes.push({ beforeStart, beforeEnd: beforeStart + operation.replacement.length, before: operation.replacement, afterStart, afterEnd: operation.end, after: operation.expected });
    shift += operation.replacement.length - operation.expected.length;
  }
  const remaining = remainingChanges(prepared.transaction, operations, direction);
  const update = (items: TextTransaction[]) => items.flatMap(item => item.id === prepared.transaction!.id ? remaining.length ? [{ ...item, changes: remaining }] : [] : [item]);
  const id = history.sequence + 1;
  const inverse: TextTransaction = direction === 'undo' ? { id, fieldKey, before: value, after: current, changes } : { id, fieldKey, before: current, after: value, changes: changes.map(change => ({ beforeStart: change.afterStart, beforeEnd: change.afterEnd, before: change.after, afterStart: change.beforeStart, afterEnd: change.beforeEnd, after: change.before })) };
  const next = direction === 'undo' ? { ...history, sequence: id, past: update(history.past), future: [...history.future, inverse] } : { ...history, sequence: id, future: update(history.future), past: [...history.past, inverse] };
  return { history: bounded(next), result: { available: true, value, selectionStart, selectionEnd: selectionEnd + shift } };
}
