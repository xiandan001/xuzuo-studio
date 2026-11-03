export interface TextDelta { beforeStart: number; beforeEnd: number; afterStart: number; afterEnd: number; before: string; after: string; }
export interface DiffBudget { cells: number; }
export const TEXT_DIFF_MAX_LENGTH = 32000;
const CELL_LIMIT = 600000;
const characters = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Character alignment is bounded; offsets returned to DOM controls use UTF-16. */
export function textDeltas(before: string, after: string, budget: DiffBudget = { cells: CELL_LIMIT }): TextDelta[] | undefined {
  if (before === after) return [];
  if (before.length > TEXT_DIFF_MAX_LENGTH || after.length > TEXT_DIFF_MAX_LENGTH) return undefined;
  const a = Array.from(characters.segment(before), item => item.segment), b = Array.from(characters.segment(after), item => item.segment);
  let prefix = 0, suffix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const old = a.slice(prefix, a.length - suffix), next = b.slice(prefix, b.length - suffix);
  const width = next.length + 1, cells = (old.length + 1) * width;
  if (old.length && next.length && (cells > CELL_LIMIT || cells > budget.cells)) return undefined;
  budget.cells -= old.length && next.length ? cells : 0;
  const scores = new Uint16Array(old.length && next.length ? cells : 0);
  for (let i = old.length - 1; i >= 0; i--) for (let j = next.length - 1; j >= 0; j--) scores[i * width + j] = old[i] === next[j] ? scores[(i + 1) * width + j + 1] + 1 : Math.max(scores[(i + 1) * width + j], scores[i * width + j + 1]);
  const prefixLength = a.slice(0, prefix).join('').length;
  const changes: TextDelta[] = [];
  let i = 0, j = 0, oldOffset = prefixLength, newOffset = prefixLength;
  let change: TextDelta | undefined;
  const flush = () => { if (change) { changes.push(change); change = undefined; } };
  while (i < old.length || j < next.length) {
    if (i < old.length && j < next.length && old[i] === next[j]) { flush(); oldOffset += old[i++].length; newOffset += next[j++].length; continue; }
    change ??= { beforeStart: oldOffset, beforeEnd: oldOffset, afterStart: newOffset, afterEnd: newOffset, before: '', after: '' };
    if (i < old.length && (j >= next.length || old.length && next.length && scores[(i + 1) * width + j] >= scores[i * width + j + 1])) { change.before += old[i]; oldOffset += old[i++].length; change.beforeEnd = oldOffset; }
    else { change.after += next[j]; newOffset += next[j++].length; change.afterEnd = newOffset; }
  }
  flush(); return changes;
}

export function textBoundary(value: string, offset: number): boolean {
  if (!Number.isInteger(offset) || offset < 0 || offset > value.length) return false;
  return offset === value.length || characters.segment(value).containing(offset)?.index === offset;
}
