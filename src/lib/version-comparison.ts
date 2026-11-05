import type { EditorDocument } from '../editor-types';
import type { SpreadsheetDocument } from '../spreadsheet-types';
import { cellToInput } from './spreadsheet-engine';
import { columnLabel } from './spreadsheet-engine';

export type ComparableDocument = EditorDocument | SpreadsheetDocument;
export interface VersionDifference { label: string; before: string; after: string; }
const align = (value: string) => ({ left: '左对齐', center: '居中', right: '右对齐' }[value] || value);
const blockType = (value: string) => ({ paragraph: '正文', heading: '标题', bullet: '列表', image: '插图', table: '表格' }[value] || value);
const layout = (value: string) => ({ 'title-body': '标题正文', 'two-columns': '双栏', 'image-right': '左文右图', 'image-full': '大图' }[value] || value);
const format = (value?: string) => ({ general: '常规', number: '数字', currency: '金额', percent: '百分比' }[value || 'general'] || value);
const viewText = (value: SpreadsheetDocument['sheets'][number]['view']) => value ? [value.header ? '首行为表头' : '不固定表头', value.sort ? `${columnLabel(value.sort.column)} 列${value.sort.direction === 'asc' ? '升序' : '降序'}查看` : '', value.filter ? `${columnLabel(value.filter.column)} 列包含“${value.filter.text}”` : ''].filter(Boolean).join(' · ') : '原始查看顺序，无筛选';
export function compareDocumentVersions(current: ComparableDocument, previous: ComparableDocument, limit = 100) {
  const changes: VersionDifference[] = []; let total = 0;
  const add = (label: string, before: string, after: string) => { if (before === after) return; total++; if (changes.length < limit) changes.push({ label, before, after }); };
  add('标题', current.title, previous.title);
  if (current.kind !== previous.kind) { add('文件类型', current.kind, previous.kind); return { total, changes }; }
  if (current.kind === 'word' && previous.kind === 'word') {
    const old = new Map(previous.blocks.map((block, index) => [block.id, { block, index }]));
    for (const [index, block] of current.blocks.entries()) {
      const match = old.get(block.id); old.delete(block.id);
      if (!match) { add(`第 ${index + 1} 段`, block.text || (block.type === 'image' ? '插图' : '表格/空段落'), '此版本没有该段落'); continue; }
      add(`第 ${index + 1} 段文字`, block.table ? block.table.rows.map(row => row.cells.map(cell => cell.text).join(' | ')).join('\n') : block.text, match.block.table ? match.block.table.rows.map(row => row.cells.map(cell => cell.text).join(' | ')).join('\n') : match.block.text);
      if (block.imageId !== match.block.imageId) add(`第 ${index + 1} 段插图`, block.imageId ? '当前插图' : '无插图', match.block.imageId ? '该版本插图' : '无插图');
      add(`第 ${index + 1} 段格式`, `${blockType(block.type)} · ${block.fontSize} 磅 · ${align(block.align)}${block.bold ? ' · 加粗' : ''}${block.italic ? ' · 斜体' : ''}`, `${blockType(match.block.type)} · ${match.block.fontSize} 磅 · ${align(match.block.align)}${match.block.bold ? ' · 加粗' : ''}${match.block.italic ? ' · 斜体' : ''}`);
      if (index !== match.index) add('段落位置', `第 ${index + 1} 段`, `第 ${match.index + 1} 段`);
    }
    for (const { block, index } of old.values()) add(`该版本第 ${index + 1} 段`, '当前没有该段落', block.text || (block.type === 'image' ? '插图' : '表格/空段落'));
  } else if (current.kind === 'ppt' && previous.kind === 'ppt') {
    add('演示主题', current.theme, previous.theme);
    const old = new Map(previous.slides.map((slide, index) => [slide.id, { slide, index }]));
    for (const [index, slide] of current.slides.entries()) {
      const match = old.get(slide.id); old.delete(slide.id);
      if (!match) { add(`第 ${index + 1} 页`, `${slide.title}\n${slide.body}`, '该版本没有此页'); continue; }
      for (const [field, label] of [['title', '标题'], ['body', '正文'], ['notes', '备注']] as const) add(`第 ${index + 1} 页${label}`, slide[field], match.slide[field]);
      add(`第 ${index + 1} 页版式`, `${layout(slide.layout)} · ${slide.fontSize} 磅 · ${align(slide.align)}`, `${layout(match.slide.layout)} · ${match.slide.fontSize} 磅 · ${align(match.slide.align)}`);
      if (slide.imageId !== match.slide.imageId) add(`第 ${index + 1} 页插图`, slide.imageId ? '当前插图' : '无插图', match.slide.imageId ? '该版本插图' : '无插图');
      if (index !== match.index) add('页面位置', `第 ${index + 1} 页`, `第 ${match.index + 1} 页`);
    }
    for (const { slide, index } of old.values()) add(`该版本第 ${index + 1} 页`, '当前没有此页', `${slide.title}\n${slide.body}`);
  } else if (current.kind === 'excel' && previous.kind === 'excel') {
    const old = new Map(previous.sheets.map(sheet => [sheet.id, sheet]));
    add('工作表顺序', current.sheets.map(sheet => sheet.name).join(' → '), previous.sheets.map(sheet => sheet.name).join(' → '));
    for (const sheet of current.sheets) {
      const match = old.get(sheet.id); old.delete(sheet.id);
      if (!match) { add(sheet.name, `${Object.keys(sheet.cells).length} 个已用单元格`, '该版本没有此工作表'); continue; }
      add(`${sheet.name} 名称`, sheet.name, match.name); add(`${sheet.name} 行列`, `${sheet.rowCount} 行 × ${sheet.columnCount} 列`, `${match.rowCount} 行 × ${match.columnCount} 列`);
      for (const address of new Set([...Object.keys(sheet.cells), ...Object.keys(match.cells)])) {
        const before = sheet.cells[address], after = match.cells[address];
        add(`${sheet.name}!${address}`, cellToInput(before), cellToInput(after));
        if (before?.bold !== after?.bold || before?.align !== after?.align || before?.format !== after?.format) add(`${sheet.name}!${address} 格式`, `${before?.bold ? '加粗' : '普通'} · ${before?.align ? align(before.align) : '自动对齐'} · ${format(before?.format)}`, `${after?.bold ? '加粗' : '普通'} · ${after?.align ? align(after.align) : '自动对齐'} · ${format(after?.format)}`);
      }
      add(`${sheet.name} 列宽`, Object.entries(sheet.columnWidths || {}).map(([label, width]) => `${label} 列 ${width} 像素`).join('、') || '默认列宽', Object.entries(match.columnWidths || {}).map(([label, width]) => `${label} 列 ${width} 像素`).join('、') || '默认列宽');
      add(`${sheet.name} 查看排序/筛选`, viewText(sheet.view), viewText(match.view));
    }
    for (const sheet of old.values()) add(sheet.name, '当前没有此工作表', `${Object.keys(sheet.cells).length} 个已用单元格`);
  }
  return { total, changes };
}
