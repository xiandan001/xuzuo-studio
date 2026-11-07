import type { BeadPattern, BeadProcurement, BeadUsageRow } from '../bead-types';
import { beadPatternIssue, beadProcurementIssue } from './bead-validation';

function colorCounts(pattern: BeadPattern): Uint32Array {
  const issue = beadPatternIssue(pattern); if (issue) throw Error(issue);
  const counts = new Uint32Array(pattern.palette.colors.length + 1);
  for (const cell of pattern.cells) counts[cell]++;
  return counts;
}
export function beadTotals(pattern: BeadPattern): { totalCells: number; beads: number; emptyCells: number; colorsUsed: number } {
  const counts = colorCounts(pattern), totalCells = pattern.cells.length;
  return { totalCells, beads: totalCells - counts[0], emptyCells: counts[0], colorsUsed: [...counts].slice(1).filter(count => count > 0).length };
}
export function beadUsage(pattern: BeadPattern, procurement: BeadProcurement): BeadUsageRow[] {
  const issue = beadProcurementIssue(procurement); if (issue) throw Error(issue);
  const counts = colorCounts(pattern), basisPoints = Math.round(procurement.lossPercent * 100);
  return pattern.palette.colors.flatMap((color, index) => {
    const cells = counts[index + 1]; if (!cells) return [];
    const required = cells * procurement.copies, reserve = Math.floor((required * basisPoints + 9999) / 10000);
    const stock = procurement.stock[color.code] ?? 0, shortage = Math.max(0, required + reserve - stock), packSize = procurement.packSizes[color.code] ?? procurement.defaultPackSize;
    return [{ code: color.code, name: color.name, hex: color.hex, kind: color.kind, cells, required, reserve, stock, shortage, packSize, bags: Math.ceil(shortage / packSize) }];
  }).sort((first, second) => second.cells - first.cells || first.code.localeCompare(second.code, 'en', { numeric: true }));
}
export function editBeadCells(pattern: BeadPattern, edits: readonly { index: number; value: number }[]): BeadPattern {
  const issue = beadPatternIssue(pattern); if (issue) throw Error(issue);
  if (!Array.isArray(edits) || edits.length > pattern.cells.length * 2) throw Error('需要修改的格子或色号无效。');
  for (const edit of edits) if (!edit || !Number.isSafeInteger(edit.index) || edit.index < 0 || edit.index >= pattern.cells.length || !Number.isSafeInteger(edit.value) || edit.value < 0 || edit.value > pattern.palette.colors.length) throw Error('需要修改的格子或色号无效。');
  if (!edits.length) return pattern;
  const cells = [...pattern.cells]; for (const edit of edits) cells[edit.index] = edit.value;
  return { ...pattern, cells };
}
export function replaceBeadColor(pattern: BeadPattern, from: number, to: number): BeadPattern {
  const issue = beadPatternIssue(pattern); if (issue) throw Error(issue);
  if (![from, to].every(value => Number.isInteger(value) && value >= 0 && value <= pattern.palette.colors.length)) throw Error('请选择有效的原色和替换色，0 表示空格。');
  return from === to ? pattern : { ...pattern, cells: pattern.cells.map(value => value === from ? to : value) };
}
