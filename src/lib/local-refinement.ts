import { editorFromText } from './editor-generated';
import type { EditorDocument } from '../editor-types';
import type { SpreadsheetDocument, SpreadsheetValue } from '../spreadsheet-types';

export const LOCAL_REFINEMENT_PREFIX = 'local-refine-';
export interface RefinementTarget { id: string; label: string; value: SpreadsheetValue; formula?: boolean; }
export interface RefinementContext { version: 1; kind: 'word' | 'ppt' | 'excel'; targets: RefinementTarget[]; instruction: string; }
export interface RefinementChange { id: string; value: SpreadsheetValue; }
export interface RefinementDiff extends RefinementChange { label: string; before: SpreadsheetValue; formula?: boolean; }

export function documentRefinementTargets(document: EditorDocument, selectedId?: string, cellId?: string): RefinementTarget[] {
  const targets: RefinementTarget[] = [];
  if (document.kind === 'ppt') {
    document.slides.forEach((slide, index) => {
      if (selectedId && slide.id !== selectedId) return;
      for (const field of ['title', 'body', 'notes'] as const) targets.push({ id: `${slide.id}/${field}`, label: `第 ${index + 1} 页 · ${field === 'title' ? '标题' : field === 'body' ? '正文' : '讲稿'}`, value: slide[field] });
    });
  } else document.blocks.forEach((block, index) => {
    if (selectedId && block.id !== selectedId || block.type === 'image') return;
    if (block.type === 'table') {
      block.table?.rows.forEach((row, r) => row.cells.forEach((cell, c) => {
        if (!cellId || cell.id === cellId) targets.push({ id: `${block.id}/cell/${cell.id}`, label: `表格 ${index + 1} · ${r + 1} 行 ${c + 1} 列`, value: cell.text });
      }));
    } else targets.push({ id: `${block.id}/text`, label: `第 ${index + 1} 段`, value: block.text });
  });
  return targets;
}
const coordinates = (address: string): [number, number] => {
  const match = /^([A-Z]{1,3})([1-9]\d{0,4})$/.exec(address.trim().toUpperCase());
  if (!match) throw new Error('区域请使用 A1 或 A1:D20 格式。');
  return [Number(match[2]), [...match[1]].reduce((column, letter) => column * 26 + letter.charCodeAt(0) - 64, 0)];
};
export function spreadsheetRefinementTargets(document: SpreadsheetDocument, sheetId: string, range: string, formulas = false): RefinementTarget[] {
  const sheet = document.sheets.find(item => item.id === sheetId);
  if (!sheet) throw new Error('请选择一个现有工作表。');
  const ends = range.split(':'); if (ends.length > 2) throw new Error('区域请使用 A1:D20 格式。');
  const [r1, c1] = coordinates(ends[0]), [r2, c2] = coordinates(ends[1] || ends[0]);
  const targets = Object.entries(sheet.cells).filter(([address, cell]) => { const [r, c] = coordinates(address); return r >= Math.min(r1, r2) && r <= Math.max(r1, r2) && c >= Math.min(c1, c2) && c <= Math.max(c1, c2) && (formulas || cell.formula === undefined); }).map(([address, cell]) => ({ id: `${sheet.id}/${address}`, label: `${sheet.name}!${address}`, value: cell.formula ?? cell.value, ...(cell.formula === undefined ? {} : { formula: true }) }));
  if (targets.length > 2000) throw new Error('一次局部精修最多选择 2,000 个已用单元格，请缩小区域。');
  return targets;
}
export function refinementDiff(context: RefinementContext, text: string): RefinementDiff[] {
  let parsed: { changes?: unknown }; try { parsed = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); } catch { throw new Error('模型未返回有效的修改 JSON。原稿已保留，可在任务中查看返回内容。'); }
  if (!parsed || !Array.isArray(parsed.changes) || parsed.changes.length > context.targets.length) throw new Error('修改数量或结构不符合所选范围。原稿未更改。');
  const allowed = new Map(context.targets.map(target => [target.id, target])), seen = new Set<string>();
  return parsed.changes.map((change: unknown) => {
    if (!change || typeof change !== 'object') throw new Error('修改条目无效。');
    const { id, value } = change as RefinementChange, target = allowed.get(id);
    if (!target || seen.has(id) || !['string', 'number', 'boolean'].includes(typeof value) && value !== null || typeof value === 'number' && !Number.isFinite(value) || typeof value === 'string' && value.length > 20000 || (context.kind !== 'excel' || target.formula) && typeof value !== 'string') throw new Error('模型试图修改范围外内容或返回了无效数据，原稿未更改。');
    if (target.formula && (typeof value !== 'string' || !value.trim() || value.startsWith('='))) throw new Error('公式修改必须是省略等号的公式内容。');
    seen.add(id); return { id, value, before: target.value, label: target.label, formula: target.formula };
  }).filter(change => change.value !== change.before);
}
function validateResult(document: EditorDocument): EditorDocument { editorFromText(document.kind, document.title, JSON.stringify({ editorDocument: document })); return document; }
export function applyDocumentRefinement(document: EditorDocument, changes: RefinementDiff[]): EditorDocument {
  assertRefinementCurrent(documentRefinementTargets(document), changes);
  const updates = new Map(changes.map(change => [change.id, change.value as string]));
  if (document.kind === 'ppt') return validateResult({ ...document, slides: document.slides.map(slide => !changes.some(change => change.id.startsWith(`${slide.id}/`)) ? slide : ({ ...slide, ...Object.fromEntries((['title', 'body', 'notes'] as const).filter(field => updates.has(`${slide.id}/${field}`)).map(field => [field, updates.get(`${slide.id}/${field}`)])) })) });
  return validateResult({ ...document, blocks: document.blocks.map(block => !changes.some(change => change.id.startsWith(`${block.id}/`)) ? block : block.type === 'table' && block.table ? { ...block, table: { ...block.table, rows: block.table.rows.map(row => ({ ...row, cells: row.cells.map(cell => updates.has(`${block.id}/cell/${cell.id}`) ? { ...cell, text: updates.get(`${block.id}/cell/${cell.id}`)! } : cell) })) } } : updates.has(`${block.id}/text`) ? { ...block, text: updates.get(`${block.id}/text`)! } : block) });
}
export function assertRefinementCurrent(targets: RefinementTarget[], changes: RefinementDiff[]) {
  const current = new Map(targets.map(target => [target.id, target]));
  if (changes.some(change => !current.has(change.id) || current.get(change.id)!.value !== change.before || !!current.get(change.id)!.formula !== !!change.formula)) throw new Error('所选内容在生成后已有变化，请重新精修；本次修改未应用。');
}
export function applySpreadsheetRefinement(document: SpreadsheetDocument, changes: RefinementDiff[]): SpreadsheetDocument {
  const all = document.sheets.flatMap(sheet => Object.entries(sheet.cells).map(([address, cell]) => ({ id: `${sheet.id}/${address}`, label: address, value: cell.formula ?? cell.value, formula: cell.formula !== undefined })));
  assertRefinementCurrent(all, changes); const updates = new Map(changes.map(change => [change.id, change]));
  return { ...document, sheets: document.sheets.map(sheet => !changes.some(change => change.id.startsWith(`${sheet.id}/`)) ? sheet : ({ ...sheet, cells: Object.fromEntries(Object.entries(sheet.cells).map(([address, cell]) => { const patch = updates.get(`${sheet.id}/${address}`); return [address, patch ? { ...cell, ...(patch.formula ? { formula: patch.value as string } : { value: patch.value }) } : cell]; })) })) };
}
