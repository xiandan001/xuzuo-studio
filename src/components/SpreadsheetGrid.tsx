import { shortcutLabel } from '../lib/platform';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { SpreadsheetCalculation, SpreadsheetSheet } from '../spreadsheet-types';
import { cellToInput, columnLabel, parseCellAddress } from '../lib/spreadsheet-engine';
import { displaySpreadsheetCell, GRID_HEADER_HEIGHT, GRID_ROW_HEADER_WIDTH, GRID_ROW_HEIGHT, spreadsheetVisibleRange } from '../lib/spreadsheet-ui';
import { spreadsheetColumnGeometry, spreadsheetRange, spreadsheetRangeText } from '../lib/spreadsheet-operations';

export interface SpreadsheetGridProps {
  sheet: SpreadsheetSheet; calculation?: SpreadsheetCalculation; selectedAddress: string; range?: string;
  onSelect: (address: string) => void; onRangeChange?: (range: string) => void;
  onCellInput: (address: string, input: string) => void; onPasteBlock: (address: string, input: string) => void;
  onClearRange?: () => void;
  onColumnWidthChange?: (column: string, width: number) => void; onFillDown?: () => void;
  viewPending?: boolean;
  onEditingChange?: (editing: boolean) => void; disabled?: boolean;
}
interface CellEdit { address: string; value: string; }
export function SpreadsheetGrid({ sheet, calculation, selectedAddress, range, onSelect, onRangeChange, onCellInput, onPasteBlock, onClearRange, onColumnWidthChange, onFillDown, onEditingChange, viewPending = false, disabled = false }: SpreadsheetGridProps) {
  const viewport = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null);
  const [view, setView] = useState({ top: 0, left: 0, width: 960, height: 480 });
  const [editing, setEditing] = useState<CellEdit | null>(null), [feedback, setFeedback] = useState('');
  const [resizePreview, setResizePreview] = useState<{ column: string; width: number }>();
  const resize = useRef<{ column: string; x: number; initial: number; width: number } | undefined>(undefined), dragging = useRef(false), anchor = useRef(selectedAddress), ownSelection = useRef(''), editRef = useRef(editing), scrollFrame = useRef(0);
  const selected = parseCellAddress(selectedAddress);
  const rowOrder = useMemo(() => calculation?.rowOrders?.[sheet.id]?.filter(row => row >= 1 && row <= sheet.rowCount), [calculation?.rowOrders, sheet.id, sheet.rowCount]);
  const rowCount = rowOrder?.length ?? sheet.rowCount, rowAt = (index: number) => rowOrder ? rowOrder[index] : index + 1;
  const geometry = useMemo(() => spreadsheetColumnGeometry(resizePreview ? { ...sheet, columnWidths: { ...sheet.columnWidths, [resizePreview.column]: resizePreview.width } } : sheet), [sheet.columnCount, sheet.columnWidths, resizePreview]);
  const rows = spreadsheetVisibleRange(view.top, view.height, GRID_ROW_HEIGHT, Math.max(1, rowCount));
  const results = calculation?.cells[sheet.id] || {}, viewActive = !!sheet.view?.sort || !!sheet.view?.filter?.text;
  let area; try { area = spreadsheetRange(sheet, range || selectedAddress); } catch { area = spreadsheetRange(sheet, selectedAddress); }
  const cellId = (address: string) => `spreadsheet-${sheet.id}-${address}`;
  useEffect(() => {
    const element = viewport.current; if (!element) return;
    const measure = () => setView({ top: element.scrollTop, left: element.scrollLeft, width: element.clientWidth, height: element.clientHeight });
    const observer = new ResizeObserver(measure); observer.observe(element); measure();
    const end = () => { dragging.current = false; }; window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
    return () => { observer.disconnect(); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); cancelAnimationFrame(scrollFrame.current); };
  }, []);
  useEffect(() => {
    const element = viewport.current; if (!element) return;
    const visibleIndex = rowOrder ? rowOrder.indexOf(selected.row) : selected.row - 1;
    if (visibleIndex < 0) { if (rowOrder?.length) onSelect(`${columnLabel(selected.column)}${rowOrder[0]}`); return; }
    const top = visibleIndex * GRID_ROW_HEIGHT, left = geometry.offsets[selected.column - 1];
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + GRID_ROW_HEIGHT > element.scrollTop + element.clientHeight - GRID_HEADER_HEIGHT) element.scrollTop = top + GRID_ROW_HEIGHT - element.clientHeight + GRID_HEADER_HEIGHT;
    if (left < element.scrollLeft) element.scrollLeft = left;
    else if (left + geometry.widths[selected.column - 1] > element.scrollLeft + element.clientWidth - GRID_ROW_HEADER_WIDTH) element.scrollLeft = left + geometry.widths[selected.column - 1] - element.clientWidth + GRID_ROW_HEADER_WIDTH;
  }, [selected.row, selected.column, sheet.id, rowOrder, geometry]);
  useEffect(() => { if (editing) { input.current?.focus(); if (editing.value === cellToInput(sheet.cells[editing.address])) input.current?.select(); } }, [editing?.address]);
  useEffect(() => { if (ownSelection.current === selectedAddress) ownSelection.current = ''; else anchor.current = selectedAddress; }, [selectedAddress]);
  function edit(value = cellToInput(sheet.cells[selectedAddress])) { if (disabled) return; const next = { address: selectedAddress, value }; editRef.current = next; setEditing(next); onEditingChange?.(true); }
  function finish(commit = true) { const current = editRef.current; editRef.current = null; setEditing(null); onEditingChange?.(false); if (current && commit && !disabled && current.value !== cellToInput(sheet.cells[current.address])) onCellInput(current.address, current.value); }
  function select(row: number, column: number, extend = false) {
    const address = `${columnLabel(Math.max(1, Math.min(sheet.columnCount, column)))}${Math.max(1, Math.min(sheet.rowCount, row))}`;
    if (!extend || viewActive) anchor.current = address;
    ownSelection.current = address; onSelect(address); onRangeChange?.(viewActive ? address : `${anchor.current}:${address}`);
  }
  function move(row: number, column: number) { finish(); select(row, column); viewport.current?.focus(); }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled || event.target instanceof HTMLTextAreaElement || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); onFillDown?.(); return; }
    if (event.metaKey && !event.altKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      select(event.key === 'ArrowUp' ? rowAt(0) : event.key === 'ArrowDown' ? rowAt(Math.max(0, rowCount - 1)) : selected.row,
        event.key === 'ArrowLeft' ? 1 : event.key === 'ArrowRight' ? sheet.columnCount : selected.column, event.shiftKey);
      return;
    }
    const delta: Record<string, [number, number]> = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], Tab: [0, event.shiftKey ? -1 : 1] };
    if (delta[event.key]) {
      event.preventDefault(); const offset = delta[event.key];
      const index = rowOrder?.indexOf(selected.row), row = rowOrder && offset[0] ? rowOrder[Math.max(0, Math.min(rowOrder.length - 1, (index ?? 0) + offset[0]))] : selected.row + offset[0];
      select(row ?? selected.row, selected.column + offset[1], event.shiftKey && event.key !== 'Tab');
    } else if (event.key === 'Enter' || event.key === 'F2') { event.preventDefault(); edit(); }
    else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); if (onClearRange) onClearRange(); else onCellInput(selectedAddress, ''); }
    else if (event.key === 'Home') { event.preventDefault(); select(event.ctrlKey || event.metaKey ? rowAt(0) : selected.row, 1, event.shiftKey); }
    else if (event.key === 'End') { event.preventDefault(); select(event.ctrlKey || event.metaKey ? rowAt(Math.max(0, rowCount - 1)) : selected.row, sheet.columnCount, event.shiftKey); }
    else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); edit(event.key); }
  }
  const visibleRows = Array.from({ length: Math.max(0, Math.min(rowCount, rows.end) - rows.start) }, (_, index) => ({ row: rowAt(rows.start + index), index: rows.start + index }));
  const visibleColumns = geometry.widths.flatMap((width, index) => geometry.offsets[index] + width >= view.left - 200 && geometry.offsets[index] <= view.left + view.width + 200 ? [index + 1] : []);
  const hint = feedback || `拖动或 Shift 选择区域 · ${shortcutLabel('C')} 复制 · ${shortcutLabel('D')} 填充 · 支持粘贴表格 · 双击编辑`;
  return <div className="ss-grid-wrap"><div ref={viewport} className="ss-grid" role="grid" aria-label={`${sheet.name} 可编辑表格`} aria-rowcount={sheet.rowCount + 1} aria-colcount={sheet.columnCount + 1} aria-readonly={disabled} aria-activedescendant={rowCount ? cellId(selectedAddress) : undefined} tabIndex={disabled ? -1 : 0} onKeyDown={onKeyDown}
    onScroll={event => { const element = event.currentTarget; cancelAnimationFrame(scrollFrame.current); scrollFrame.current = requestAnimationFrame(() => setView({ top: element.scrollTop, left: element.scrollLeft, width: element.clientWidth, height: element.clientHeight })); }}
    onCopy={event => { if (event.target instanceof HTMLTextAreaElement) return; event.preventDefault(); try { if (viewActive && viewPending) throw new Error('查看排序和筛选尚未计算完成，请等待或清除查看设置后复制。'); event.clipboardData.setData('text/plain', spreadsheetRangeText(sheet, range || selectedAddress, rowOrder)); setFeedback('已复制选中区域，公式与原始行号保持。'); } catch (error) { setFeedback(error instanceof Error ? error.message : '复制未完成。'); } }}
    onPaste={event => { if (disabled || event.target instanceof HTMLTextAreaElement) return; const text = event.clipboardData.getData('text/plain'); event.preventDefault(); finish(false); onPasteBlock(selectedAddress, text); }}>
    <div className="ss-grid-canvas" style={{ width: GRID_ROW_HEADER_WIDTH + geometry.width, height: GRID_HEADER_HEIGHT + rowCount * GRID_ROW_HEIGHT }}>
      <div className="ss-grid-corner" aria-hidden="true" style={{ top: view.top, left: view.left, width: GRID_ROW_HEADER_WIDTH, height: GRID_HEADER_HEIGHT }} />
      <div role="row" aria-rowindex={1}>{visibleColumns.map(column => { const label = columnLabel(column), width = geometry.widths[column - 1]; return <div role="columnheader" aria-colindex={column + 1} className={`ss-column-header ${selected.column === column ? 'is-selected' : ''}`} key={column} style={{ top: view.top, left: GRID_ROW_HEADER_WIDTH + geometry.offsets[column - 1], width, height: GRID_HEADER_HEIGHT }}>{label}{onColumnWidthChange && <button type="button" className="ss-column-resize" aria-label={`调整 ${label} 列宽`} title="拖动调整列宽，方向键每次调整 8 像素" disabled={disabled}
        onPointerDown={event => { event.preventDefault(); event.stopPropagation(); resize.current = { column: label, x: event.clientX, initial: width, width }; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={event => { const current = resize.current; if (!current || current.column !== label) return; current.width = Math.round(Math.max(64, Math.min(640, current.initial + event.clientX - current.x))); setResizePreview({ column: label, width: current.width }); }}
        onPointerUp={event => { const current = resize.current; if (!current) return; resize.current = undefined; event.currentTarget.releasePointerCapture(event.pointerId); onColumnWidthChange(current.column, current.width); setResizePreview(undefined); }}
        onPointerCancel={() => { resize.current = undefined; setResizePreview(undefined); }}
        onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); onColumnWidthChange(label, Math.max(64, Math.min(640, width + (event.key === 'ArrowLeft' ? -8 : 8)))); } }} />}</div>; })}</div>
      {visibleRows.map(({ row, index }) => <div role="row" aria-rowindex={row + 1} key={row}><div role="rowheader" className={`ss-row-header ${selected.row === row ? 'is-selected' : ''}`} style={{ top: GRID_HEADER_HEIGHT + index * GRID_ROW_HEIGHT, left: view.left, width: GRID_ROW_HEADER_WIDTH, height: GRID_ROW_HEIGHT }}>{row}</div>{visibleColumns.map(column => {
        const address = `${columnLabel(column)}${row}`, cell = sheet.cells[address], result = results[address], active = address === selectedAddress, inRange = row >= area.top && row <= area.bottom && column >= area.left && column <= area.right;
        const issue = result?.status === 'error' || result?.status === 'unsupported';
        return <div id={cellId(address)} role="gridcell" aria-colindex={column + 1} aria-selected={inRange} aria-label={`${address}${cell?.formula ? `，公式 =${cell.formula}` : ''}${issue ? `，${result.message || result.error}` : ''}`} key={column} className={`ss-cell ${active ? 'is-selected' : inRange ? 'is-range' : ''} ${issue ? 'has-issue' : ''} ${cell?.formula ? 'has-formula' : ''}`} style={{ top: GRID_HEADER_HEIGHT + index * GRID_ROW_HEIGHT, left: GRID_ROW_HEADER_WIDTH + geometry.offsets[column - 1], width: geometry.widths[column - 1], height: GRID_ROW_HEIGHT, fontWeight: cell?.bold ? 700 : undefined, textAlign: cell?.align || (typeof cell?.value === 'number' || cell?.formula ? 'right' : 'left') }}
          onPointerDown={event => { if (disabled || event.button !== 0 || event.target instanceof HTMLTextAreaElement) return; finish(); select(row, column, event.shiftKey); dragging.current = !viewActive; viewport.current?.focus(); }}
          onPointerEnter={event => { if (dragging.current && event.buttons === 1) select(row, column, true); }} onDoubleClick={() => edit(cellToInput(cell))}>
          {editing?.address === address ? <textarea ref={input} rows={1} aria-label={`${sheet.name} ${address} 内容`} value={editing.value} disabled={disabled} spellCheck={false} onClick={event => event.stopPropagation()} onChange={event => { const next = { address, value: event.target.value }; editRef.current = next; setEditing(next); }} onBlur={() => finish()} onKeyDown={event => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.key === 'Escape') { event.preventDefault(); finish(false); viewport.current?.focus(); } else if (event.key === 'Enter' && !event.shiftKey || event.key === 'Tab') { event.preventDefault(); move(row + (event.key === 'Enter' ? 1 : 0), column + (event.key === 'Tab' ? event.shiftKey ? -1 : 1 : 0)); } }} /> : <span>{displaySpreadsheetCell(cell, result)}</span>}
        </div>;
      })}</div>)}
    </div>
    {!rowCount && <p className="ss-filter-empty">没有符合筛选条件的行。清除查看筛选后可继续编辑。</p>}
  </div><div className="ss-grid-hint"><span>{sheet.rowCount.toLocaleString()} 行 × {sheet.columnCount} 列{viewActive ? ` · 当前可见 ${rowCount} 行（原始行号）` : ''}</span><span role="status" title={hint}>{hint}</span></div></div>;
}
