import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Eraser, Hand, Minus, Pencil, Plus, Scan } from 'lucide-react';
import type { BeadPattern } from '../bead-types';

export interface BeadCellEdit { index: number; value: number; }
export interface BeadCanvasHandle { commitStroke: () => void; hasPendingStroke: () => boolean; }
interface Props { pattern: BeadPattern; brush: number; boardColumns: number; boardRows: number; disabled?: boolean; onCommit: (edits: BeadCellEdit[]) => void; }
type Tool = 'paint' | 'erase' | 'pan';

export function beadLineIndices(start: number, end: number, columns: number): number[] {
  let x = start % columns, y = Math.floor(start / columns); const toX = end % columns, toY = Math.floor(end / columns), dx = Math.abs(toX - x), dy = -Math.abs(toY - y), sx = x < toX ? 1 : -1, sy = y < toY ? 1 : -1, result: number[] = [];
  let error = dx + dy;
  for (;;) { result.push(y * columns + x); if (x === toX && y === toY) return result; const twice = 2 * error; if (twice >= dy) { error += dy; x += sx; } if (twice <= dx) { error += dx; y += sy; } }
}

export const BeadCanvas = forwardRef<BeadCanvasHandle, Props>(function BeadCanvas({ pattern, brush, boardColumns, boardRows, disabled = false, onCommit }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null), host = useRef<HTMLDivElement>(null), pending = useRef(new Map<number, number>()), frame = useRef<number | undefined>(undefined);
  const latest = useRef({ pattern, brush, disabled, onCommit }); latest.current = { pattern, brush, disabled, onCommit };
  const [viewport, setViewport] = useState({ width: 640, height: 440 }), [zoom, setZoom] = useState(1), [pan, setPan] = useState({ x: 0, y: 0 }), [tool, setTool] = useState<Tool>('paint'), [showCodes, setShowCodes] = useState(true), [hover, setHover] = useState<number>();
  const space = useRef(false), gesture = useRef<{ pointerId: number; kind: Tool; x: number; y: number; panX: number; panY: number; last?: number } | undefined>(undefined);
  const fit = Math.max(.5, Math.min((viewport.width - 44) / pattern.columns, (viewport.height - 44) / pattern.rows, 40)), size = Math.max(.5, Math.min(64, fit * zoom));
  const origin = { x: (viewport.width - pattern.columns * size) / 2 + pan.x, y: (viewport.height - pattern.rows * size) / 2 + pan.y };
  const drawRef = useRef<() => void>(() => {});
  drawRef.current = () => {
    const element = canvas.current, context = element?.getContext('2d'); if (!element || !context) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2); context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, viewport.width, viewport.height);
    context.fillStyle = getComputedStyle(element).getPropertyValue('--ui-bg').trim() || '#f4f5f7'; context.fillRect(0, 0, viewport.width, viewport.height);
    const firstX = Math.max(0, Math.floor(-origin.x / size)), firstY = Math.max(0, Math.floor(-origin.y / size)), lastX = Math.min(pattern.columns - 1, Math.ceil((viewport.width - origin.x) / size)), lastY = Math.min(pattern.rows - 1, Math.ceil((viewport.height - origin.y) / size));
    for (let row = firstY; row <= lastY; row++) for (let column = firstX; column <= lastX; column++) {
      const index = row * pattern.columns + column, value = pending.current.get(index) ?? pattern.cells[index], color = value ? pattern.palette.colors[value - 1] : undefined, x = origin.x + column * size, y = origin.y + row * size;
      context.fillStyle = color?.hex || ((column + row) % 2 ? '#eceff2' : '#ffffff'); context.fillRect(x, y, size + .25, size + .25);
      if (!value && size >= 10) { context.fillStyle = '#8b96a1'; context.font = `${Math.min(12, size * .6)}px sans-serif`; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText('×', x + size / 2, y + size / 2); }
      else if (color && showCodes && size >= 20) {
        const text = color.code; context.fillStyle = color.rgb[0] * .299 + color.rgb[1] * .587 + color.rgb[2] * .114 > 145 ? '#18212a' : '#ffffff';
        context.font = `${Math.max(8, Math.min(14, size / Math.max(2.4, text.length * .72)))}px sans-serif`; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(text, x + size / 2, y + size / 2, size - 2);
      }
    }
    if (size >= 5) {
      context.beginPath(); context.strokeStyle = 'rgba(90,106,123,.35)'; context.lineWidth = .6;
      for (let column = firstX; column <= lastX + 1; column++) { const x = origin.x + column * size; context.moveTo(x, Math.max(0, origin.y)); context.lineTo(x, Math.min(viewport.height, origin.y + pattern.rows * size)); }
      for (let row = firstY; row <= lastY + 1; row++) { const y = origin.y + row * size; context.moveTo(Math.max(0, origin.x), y); context.lineTo(Math.min(viewport.width, origin.x + pattern.columns * size), y); } context.stroke();
      context.beginPath(); context.strokeStyle = '#64748b'; context.lineWidth = 1.7;
      const boardWidth = Number.isInteger(boardColumns) && boardColumns > 0 ? boardColumns : pattern.columns, boardHeight = Number.isInteger(boardRows) && boardRows > 0 ? boardRows : pattern.rows;
      for (let column = boardWidth; column < pattern.columns; column += boardWidth) { const x = origin.x + column * size; if (x >= 0 && x <= viewport.width) { context.moveTo(x, Math.max(0, origin.y)); context.lineTo(x, Math.min(viewport.height, origin.y + pattern.rows * size)); } }
      for (let row = boardHeight; row < pattern.rows; row += boardHeight) { const y = origin.y + row * size; if (y >= 0 && y <= viewport.height) { context.moveTo(Math.max(0, origin.x), y); context.lineTo(Math.min(viewport.width, origin.x + pattern.columns * size), y); } } context.stroke();
    }
  };
  const schedule = useCallback(() => { if (frame.current !== undefined) return; frame.current = requestAnimationFrame(() => { frame.current = undefined; drawRef.current(); }); }, []);
  const commitStroke = useCallback(() => {
    gesture.current = undefined; if (!pending.current.size) return;
    const edits = [...pending.current].filter(([index, value]) => latest.current.pattern.cells[index] !== value).map(([index, value]) => ({ index, value })); pending.current.clear();
    if (edits.length) latest.current.onCommit(edits); schedule();
  }, [schedule]);
  useImperativeHandle(ref, () => ({ commitStroke, hasPendingStroke: () => pending.current.size > 0 }), [commitStroke]);
  useLayoutEffect(() => {
    const element = host.current; if (!element) return;
    const measure = () => { const rect = element.getBoundingClientRect(); const width = Math.max(240, Math.round(rect.width || 640)), height = Math.max(260, Math.round(rect.height || 440)); setViewport(previous => previous.width === width && previous.height === height ? previous : { width, height }); };
    const observer = new ResizeObserver(measure); observer.observe(element); measure(); return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const element = canvas.current; if (!element) return; const ratio = Math.min(window.devicePixelRatio || 1, 2); element.width = Math.round(viewport.width * ratio); element.height = Math.round(viewport.height * ratio); schedule();
  }, [viewport, schedule]);
  useEffect(schedule, [pattern, size, pan, showCodes, boardColumns, boardRows, schedule]);
  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, [pattern.columns, pattern.rows]);
  useEffect(() => { if (disabled) commitStroke(); }, [disabled, commitStroke]);
  useLayoutEffect(() => () => { commitStroke(); if (frame.current !== undefined) cancelAnimationFrame(frame.current); }, [commitStroke]);
  useEffect(() => { const up = () => { space.current = false; }; window.addEventListener('keyup', up); window.addEventListener('blur', up); return () => { window.removeEventListener('keyup', up); window.removeEventListener('blur', up); }; }, []);
  useEffect(() => { const observer = new MutationObserver(schedule); observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-app-theme', 'data-app-palette', 'class', 'style'] }); return () => observer.disconnect(); }, [schedule]);
  useEffect(() => {
    const element = canvas.current; if (!element) return;
    const wheel = (event: WheelEvent) => { event.preventDefault(); setZoom(value => Math.max(.25, Math.min(16, value * (event.deltaY < 0 ? 1.12 : 1 / 1.12)))); };
    element.addEventListener('wheel', wheel, { passive: false }); return () => element.removeEventListener('wheel', wheel);
  }, []);
  const indexAt = (clientX: number, clientY: number) => {
    const bounds = canvas.current!.getBoundingClientRect(), column = Math.floor((clientX - bounds.left - origin.x) / size), row = Math.floor((clientY - bounds.top - origin.y) / size);
    return column >= 0 && row >= 0 && column < pattern.columns && row < pattern.rows ? row * pattern.columns + column : undefined;
  };
  function paint(index: number) {
    const active = gesture.current; if (!active) return;
    const value = active.kind === 'erase' ? 0 : latest.current.brush;
    for (const cell of beadLineIndices(active.last ?? index, index, pattern.columns)) pending.current.set(cell, value);
    active.last = index; schedule();
  }
  function keyboard(event: ReactKeyboardEvent<HTMLCanvasElement>) {
    if (event.code === 'Space') { event.preventDefault(); space.current = true; return; }
    if (event.key === 'Enter' && !disabled && tool !== 'pan') { event.preventDefault(); pending.current.set(hover ?? 0, tool === 'erase' ? 0 : brush); commitStroke(); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); const previous = hover ?? 0, x = previous % pattern.columns, y = Math.floor(previous / pattern.columns);
    const column = Math.max(0, Math.min(pattern.columns - 1, x + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0))), row = Math.max(0, Math.min(pattern.rows - 1, y + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0)));
    setHover(row * pattern.columns + column); const centerX = origin.x + (column + .5) * size, centerY = origin.y + (row + .5) * size;
    if (centerX < 12 || centerX > viewport.width - 12 || centerY < 12 || centerY > viewport.height - 12) setPan(previousPan => ({ x: previousPan.x + viewport.width / 2 - centerX, y: previousPan.y + viewport.height / 2 - centerY }));
  }
  const hoverValue = hover === undefined ? undefined : pending.current.get(hover) ?? pattern.cells[hover], hoverColor = hoverValue ? pattern.palette.colors[hoverValue - 1] : undefined;
  return <section className="bead-canvas-section" aria-label="可编辑拼豆画布">
    <div className="bead-canvas-toolbar" role="toolbar" aria-label="画布工具"><div>{([{ value: 'paint', label: '画笔', Icon: Pencil }, { value: 'erase', label: '擦为空格', Icon: Eraser }, { value: 'pan', label: '移动', Icon: Hand }] as const).map(item => <button key={item.value} type="button" aria-pressed={tool === item.value} disabled={disabled} onClick={() => { commitStroke(); setTool(item.value); }}><item.Icon size={15} />{item.label}</button>)}</div><div><button type="button" aria-label="缩小拼豆画布" onClick={() => setZoom(value => Math.max(.25, value / 1.25))}><Minus size={15} /></button><span>{Math.round(zoom * 100)}%</span><button type="button" aria-label="放大拼豆画布" onClick={() => setZoom(value => Math.min(16, value * 1.25))}><Plus size={15} /></button><button type="button" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}><Scan size={15} />定位全图</button></div><label><input type="checkbox" checked={showCodes} onChange={event => setShowCodes(event.target.checked)} />色号</label></div>
    <div ref={host} className="bead-canvas-host"><canvas ref={canvas} tabIndex={0} aria-label="拼豆格子画布" aria-disabled={disabled} style={{ cursor: tool === 'pan' ? 'grab' : 'crosshair' }} onContextMenu={event => event.preventDefault()} onKeyDown={keyboard} onPointerDown={event => {
      if (latest.current.disabled || gesture.current || ![0, 1].includes(event.button)) return; event.preventDefault(); canvas.current?.focus(); canvas.current?.setPointerCapture?.(event.pointerId);
      const kind = event.button === 1 || space.current ? 'pan' : tool; gesture.current = { pointerId: event.pointerId, kind, x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }; const index = indexAt(event.clientX, event.clientY); if (index !== undefined && kind !== 'pan') paint(index);
    }} onPointerMove={event => {
      const index = indexAt(event.clientX, event.clientY); if (index !== hover) setHover(index);
      const active = gesture.current; if (!active || active.pointerId !== event.pointerId) return;
      if (active.kind === 'pan') setPan({ x: active.panX + event.clientX - active.x, y: active.panY + event.clientY - active.y }); else if (index !== undefined) paint(index);
    }} onPointerUp={commitStroke} onPointerCancel={commitStroke} onLostPointerCapture={commitStroke} onPointerLeave={() => { if (!gesture.current) setHover(undefined); }} /></div>
    <footer className="bead-canvas-caption"><span>{hover === undefined ? `${pattern.columns} 列 × ${pattern.rows} 行` : `第 ${Math.floor(hover / pattern.columns) + 1} 行 · 第 ${hover % pattern.columns + 1} 列 · ${hoverColor ? `${hoverColor.code} ${hoverColor.name}` : '空格，不计珠'}`}</span><span>拖动连续绘制 · 空格键拖动画面 · × 为空格</span></footer>
  </section>;
});
