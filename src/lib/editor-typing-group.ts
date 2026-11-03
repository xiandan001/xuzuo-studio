import type { EditorDocument, WordBlock, WordTable } from '../editor-types';

function changedTableCell(before: WordTable, after: WordTable): string | undefined {
  if (before.columns !== after.columns || before.header !== after.header || before.borders !== after.borders || before.rows.length !== after.rows.length) return;
  let changed: string | undefined;
  for (let rowIndex = 0; rowIndex < before.rows.length; rowIndex++) {
    const row = before.rows[rowIndex], next = after.rows[rowIndex];
    if (row === next) continue;
    if (row.id !== next.id || row.cells.length !== next.cells.length) return;
    for (let index = 0; index < row.cells.length; index++) {
      const cell = row.cells[index], nextCell = next.cells[index];
      if (cell === nextCell) continue;
      if (cell.id !== nextCell.id || cell.text === nextCell.text || changed) return;
      changed = cell.id;
    }
  }
  return changed;
}
function blockTypingGroup(before: WordBlock, after: WordBlock): string | undefined {
  if (before.id !== after.id || before.type !== after.type || before.fontSize !== after.fontSize || before.align !== after.align || before.bold !== after.bold || before.italic !== after.italic || before.imageId !== after.imageId) return;
  if (before.type === 'table') {
    const cell = before.table && after.table && changedTableCell(before.table, after.table);
    return cell ? `word:${before.id}:${cell}` : undefined;
  }
  return before.text !== after.text ? `word:${before.id}:text` : undefined;
}
export function editorTypingGroup(before: EditorDocument, after: EditorDocument): string | undefined {
  if (before.kind !== after.kind) return;
  if (before.kind === 'word' && after.kind === 'word') {
    if (before.blocks === after.blocks && before.title !== after.title) return 'word:title';
    if (before.title !== after.title || before.blocks.length !== after.blocks.length) return;
    const changed = before.blocks.flatMap((block, index) => block === after.blocks[index] ? [] : [index]);
    return changed.length === 1 ? blockTypingGroup(before.blocks[changed[0]], after.blocks[changed[0]]) : undefined;
  }
  if (before.kind === 'ppt' && after.kind === 'ppt') {
    if (before.slides === after.slides && before.title !== after.title) return 'ppt:title';
    if (before.title !== after.title || before.theme !== after.theme || before.slides.length !== after.slides.length) return;
    const changed = before.slides.flatMap((slide, index) => slide === after.slides[index] ? [] : [index]);
    if (changed.length !== 1) return;
    const first = before.slides[changed[0]], next = after.slides[changed[0]];
    if (first.id !== next.id || first.layout !== next.layout || first.fontSize !== next.fontSize || first.align !== next.align || first.imageId !== next.imageId) return;
    const fields = (['title', 'body', 'notes'] as const).filter(key => first[key] !== next[key]);
    return fields.length === 1 ? `ppt:${first.id}:${fields[0]}` : undefined;
  }
}
