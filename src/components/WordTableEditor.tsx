import { memo, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { WordTable } from '../editor-types';
import { editWordTableCell, insertWordTableColumn, insertWordTableRow, removeWordTableColumn, removeWordTableRow, WORD_TABLE_MAX_COLUMNS, WORD_TABLE_MAX_ROWS } from '../lib/word-table';
import { AutoGrowTextarea } from './AutoGrowTextarea';
import './word-table-editor.css';

interface WordTableEditorProps { blockId: string; table: WordTable; blockIndex: number; style: CSSProperties; disabled?: boolean; onChange: (id: string, table: WordTable) => void; onSelectCell?: (blockId: string, cellId: string) => void; }
export const WordTableEditor = memo(function WordTableEditor({ blockId, table, blockIndex, style, disabled, onChange, onSelectCell }: WordTableEditorProps) {
  const [activeCell, setActiveCell] = useState(table.rows[0].cells[0].id);
  const rowIndex = Math.max(0, table.rows.findIndex(row => row.cells.some(cell => cell.id === activeCell)));
  const columnIndex = Math.max(0, table.rows[rowIndex].cells.findIndex(cell => cell.id === activeCell));
  const headerStyle = useMemo(() => ({ ...style, fontWeight: 700 }), [style]);
  function changeStructure(next: WordTable) {
    setActiveCell(next.rows[Math.min(rowIndex, next.rows.length - 1)].cells[Math.min(columnIndex, next.columns.length - 1)].id);
    onChange(blockId, next);
  }
  return <div className="ed-word-table-editor">
    <fieldset disabled={disabled} className="ed-word-table-tools" aria-label={`表格 ${blockIndex + 1} 操作`}>
      <span>第 {rowIndex + 1} 行 · 第 {columnIndex + 1} 列</span>
      <button type="button" disabled={table.rows.length >= WORD_TABLE_MAX_ROWS} onClick={() => changeStructure(insertWordTableRow(table, rowIndex))}>增加行</button>
      <button type="button" disabled={table.rows.length <= 1} onClick={() => changeStructure(removeWordTableRow(table, rowIndex))}>删除行</button>
      <button type="button" disabled={table.columns.length >= WORD_TABLE_MAX_COLUMNS} onClick={() => changeStructure(insertWordTableColumn(table, columnIndex))}>增加列</button>
      <button type="button" disabled={table.columns.length <= 1} onClick={() => changeStructure(removeWordTableColumn(table, columnIndex))}>删除列</button>
      <label><input type="checkbox" checked={table.header} onChange={event => onChange(blockId, { ...table, header: event.target.checked })} />首行为表头</label>
      <label><input type="checkbox" checked={table.borders} onChange={event => onChange(blockId, { ...table, borders: event.target.checked })} />显示边框</label>
    </fieldset>
    <div className="ed-word-table-scroll"><table className={`ed-word-table${table.borders ? ' with-borders' : ''}`} aria-label={`文档表格 ${blockIndex + 1}`}><tbody>{table.rows.map((row, rowPosition) => <tr key={row.id}>{row.cells.map((cell, columnPosition) => {
      const Cell = table.header && rowPosition === 0 ? 'th' : 'td';
      return <Cell key={cell.id} scope={Cell === 'th' ? 'col' : undefined}><AutoGrowTextarea disabled={disabled} data-edit-field={JSON.stringify(['cell', blockId, cell.id])} aria-label={`表格 ${blockIndex + 1} 第 ${rowPosition + 1} 行第 ${columnPosition + 1} 列`} style={Cell === 'th' ? headerStyle : style} value={cell.text} maxLength={20000} onFocus={event => { event.stopPropagation(); setActiveCell(cell.id); onSelectCell?.(blockId, cell.id); }} onChange={event => onChange(blockId, editWordTableCell(table, cell.id, event.target.value))} /></Cell>;
    })}</tr>)}</tbody></table></div>
  </div>;
});
