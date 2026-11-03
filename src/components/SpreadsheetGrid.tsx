import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { SpreadsheetCalculation, SpreadsheetSheet } from '../spreadsheet-types';
import { cellToInput, columnLabel, parseCellAddress } from '../lib/spreadsheet-engine';
import { displaySpreadsheetCell, GRID_COLUMN_WIDTH, GRID_HEADER_HEIGHT, GRID_ROW_HEADER_WIDTH, GRID_ROW_HEIGHT, spreadsheetVisibleRange } from '../lib/spreadsheet-ui';

export interface SpreadsheetGridProps {
  sheet: SpreadsheetSheet;
  calculation?: SpreadsheetCalculation;
  selectedAddress: string;
  onSelect: (address: string) => void;
  onCellInput: (address: string, input: string) => void;
  onPasteBlock: (address: string, input: string) => void;
  onEditingChange?: (editing: boolean) => void;
  disabled?: boolean;
}
interface CellEdit { address: string; value: string; }

export function SpreadsheetGrid({ sheet, calculation, selectedAddress, onSelect, onCellInput, onPasteBlock, onEditingChange, disabled = false }: SpreadsheetGridProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [view, setView] = useState({ top: 0, left: 0, width: 960, height: 480 });
  const [editing, setEditing] = useState<CellEdit | null>(null);
  const editRef = useRef(editing);
  const selected = parseCellAddress(selectedAddress) || { row: 1, column: 1, address: 'A1' };
  const rows = spreadsheetVisibleRange(view.top, view.height, GRID_ROW_HEIGHT, sheet.rowCount);
  const columns = spreadsheetVisibleRange(view.left, view.width, GRID_COLUMN_WIDTH, sheet.columnCount);
  const results = calculation?.cells[sheet.id] || {};
  const cellId = (address: string) => `spreadsheet-${sheet.id}-${address}`;

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => setView({ top: element.scrollTop, left: element.scrollLeft, width: element.clientWidth, height: element.clientHeight });
    const observer = new ResizeObserver(measure); observer.observe(element); measure();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const top = (selected.row - 1) * GRID_ROW_HEIGHT, left = (selected.column - 1) * GRID_COLUMN_WIDTH;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + GRID_ROW_HEIGHT > element.scrollTop + element.clientHeight - GRID_HEADER_HEIGHT) element.scrollTop = top + GRID_ROW_HEIGHT - element.clientHeight + GRID_HEADER_HEIGHT;
    if (left < element.scrollLeft) element.scrollLeft = left;
    else if (left + GRID_COLUMN_WIDTH > element.scrollLeft + element.clientWidth - GRID_ROW_HEADER_WIDTH) element.scrollLeft = left + GRID_COLUMN_WIDTH - element.clientWidth + GRID_ROW_HEADER_WIDTH;
  }, [selected.row, selected.column, sheet.id]);
  useEffect(() => { if (editing) { input.current?.focus(); if (editing.value === cellToInput(sheet.cells[editing.address])) input.current?.select(); } }, [editing?.address]);

  function edit(value = cellToInput(sheet.cells[selectedAddress])) {
    if (disabled) return;
    const next = { address: selectedAddress, value }; editRef.current = next; setEditing(next); onEditingChange?.(true);
  }
  function finish(commit = true) {
    const current = editRef.current;
    editRef.current = null; setEditing(null); onEditingChange?.(false);
    if (current && commit && !disabled && current.value !== cellToInput(sheet.cells[current.address])) onCellInput(current.address, current.value);
  }
  function select(row: number, column: number) {
    onSelect(`${columnLabel(Math.max(1, Math.min(sheet.columnCount, column)))}${Math.max(1, Math.min(sheet.rowCount, row))}`);
  }
  function move(row: number, column: number) { finish(); select(row, column); viewport.current?.focus(); }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled || event.target instanceof HTMLTextAreaElement || event.nativeEvent.isComposing || event.keyCode === 229) return;
    const delta: Record<string, [number, number]> = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], Tab: [0, event.shiftKey ? -1 : 1] };
    if (delta[event.key]) { event.preventDefault(); select(selected.row + delta[event.key][0], selected.column + delta[event.key][1]); }
    else if (event.key === 'Enter' || event.key === 'F2') { event.preventDefault(); edit(); }
    else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); onCellInput(selectedAddress, ''); }
    else if (event.key === 'Home') { event.preventDefault(); select(event.ctrlKey || event.metaKey ? 1 : selected.row, 1); }
    else if (event.key === 'End') { event.preventDefault(); select(event.ctrlKey || event.metaKey ? sheet.rowCount : selected.row, sheet.columnCount); }
    else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); edit(event.key); }
  }
  const visibleRows = Array.from({ length: Math.max(0, rows.end - rows.start) }, (_, index) => rows.start + index + 1);
  const visibleColumns = Array.from({ length: Math.max(0, columns.end - columns.start) }, (_, index) => columns.start + index + 1);
  return <div className="ss-grid-wrap">
    <div ref={viewport} className="ss-grid" role="grid" aria-label={`${sheet.name} 可编辑表格`} aria-rowcount={sheet.rowCount + 1} aria-colcount={sheet.columnCount + 1} aria-readonly={disabled} aria-activedescendant={cellId(selectedAddress)} tabIndex={disabled ? -1 : 0} onKeyDown={onKeyDown}
      onScroll={event => { const element = event.currentTarget; setView({ top: element.scrollTop, left: element.scrollLeft, width: element.clientWidth, height: element.clientHeight }); }}
      onCopy={event => { if (event.target instanceof HTMLTextAreaElement) return; event.clipboardData.setData('text/plain', cellToInput(sheet.cells[selectedAddress])); event.preventDefault(); }}
      onPaste={event => { if (disabled || event.target instanceof HTMLTextAreaElement) return; const text = event.clipboardData.getData('text/plain'); event.preventDefault(); finish(false); onPasteBlock(selectedAddress, text); }}>
      <div className="ss-grid-canvas" style={{ width: GRID_ROW_HEADER_WIDTH + sheet.columnCount * GRID_COLUMN_WIDTH, height: GRID_HEADER_HEIGHT + sheet.rowCount * GRID_ROW_HEIGHT }}>
        <div className="ss-grid-corner" aria-hidden="true" style={{ top: view.top, left: view.left, width: GRID_ROW_HEADER_WIDTH, height: GRID_HEADER_HEIGHT }} />
        <div role="row" aria-rowindex={1}>{visibleColumns.map(column => <div role="columnheader" aria-colindex={column + 1} className={`ss-column-header ${selected.column === column ? 'is-selected' : ''}`} key={column} style={{ top: view.top, left: GRID_ROW_HEADER_WIDTH + (column - 1) * GRID_COLUMN_WIDTH, width: GRID_COLUMN_WIDTH, height: GRID_HEADER_HEIGHT }}>{columnLabel(column)}</div>)}</div>
        {visibleRows.map(row => <div role="row" aria-rowindex={row + 1} key={row}>
          <div role="rowheader" className={`ss-row-header ${selected.row === row ? 'is-selected' : ''}`} style={{ top: GRID_HEADER_HEIGHT + (row - 1) * GRID_ROW_HEIGHT, left: view.left, width: GRID_ROW_HEADER_WIDTH, height: GRID_ROW_HEIGHT }}>{row}</div>
          {visibleColumns.map(column => {
            const address = `${columnLabel(column)}${row}`, cell = sheet.cells[address], result = results[address], active = address === selectedAddress;
            const issue = result?.status === 'error' || result?.status === 'unsupported';
            return <div id={cellId(address)} role="gridcell" aria-colindex={column + 1} aria-selected={active} aria-label={`${address}${cell?.formula ? `，公式 =${cell.formula}` : ''}${issue ? `，${result.message || result.error}` : ''}`} key={column} className={`ss-cell ${active ? 'is-selected' : ''} ${issue ? 'has-issue' : ''} ${cell?.formula ? 'has-formula' : ''}`} style={{ top: GRID_HEADER_HEIGHT + (row - 1) * GRID_ROW_HEIGHT, left: GRID_ROW_HEADER_WIDTH + (column - 1) * GRID_COLUMN_WIDTH, width: GRID_COLUMN_WIDTH, height: GRID_ROW_HEIGHT, textAlign: cell?.align || (typeof result?.value === 'number' || typeof cell?.value === 'number' ? 'right' : 'left'), fontWeight: cell?.bold ? 700 : 400 }} title={issue ? result.message || result.error : cell?.formula ? `=${cell.formula}` : displaySpreadsheetCell(cell, result)} onClick={() => { if (disabled || active && editing) return; finish(); onSelect(address); viewport.current?.focus(); }} onDoubleClick={() => { if (!disabled) { onSelect(address); const next = { address, value: cellToInput(cell) }; editRef.current = next; setEditing(next); onEditingChange?.(true); } }}>
              {editing?.address === address ? <textarea ref={input} rows={1} aria-label={`${sheet.name} ${address} 内容`} value={editing.value} disabled={disabled} spellCheck={false} onClick={event => event.stopPropagation()} onChange={event => { const next = { address, value: event.target.value }; editRef.current = next; setEditing(next); }} onBlur={() => finish()} onKeyDown={event => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.key === 'Escape') { event.preventDefault(); finish(false); viewport.current?.focus(); } else if (event.key === 'Enter' && !event.shiftKey || event.key === 'Tab') { event.preventDefault(); move(row + (event.key === 'Enter' ? 1 : 0), column + (event.key === 'Tab' ? event.shiftKey ? -1 : 1 : 0)); } }} /> : <span>{displaySpreadsheetCell(cell, result)}</span>}
            </div>;
          })}
        </div>)}
      </div>
    </div>
    <div className="ss-grid-hint"><span>{sheet.rowCount.toLocaleString()} 行 × {sheet.columnCount} 列</span><span>双击或直接键入编辑 · Enter 确认 · Tab 换列 · 支持粘贴表格</span></div>
  </div>;
}
