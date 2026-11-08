import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { CommerceImageDocument, CommerceImageSource } from '../commerce-image-types';
import { changeCommerceLayer } from '../lib/commerce-image';
import { Redo2, Undo2 } from 'lucide-react';

export type CommerceMaskMode = 'product' | 'protect';
interface Props {
  document: CommerceImageDocument; source: CommerceImageSource; previews: Record<string, string>; selectedId: string;
  disabled?: boolean; maskMode?: CommerceMaskMode; maskBase?: string; onSelect: (id: string) => void;
  onChange: (document: CommerceImageDocument, group?: string) => void; onMask: (dataUrl: string) => Promise<void>; onCancelMask: () => void;
  onMaskDirty?: (dirty: boolean) => void;
}
export interface CommerceLayerCanvasHandle { flushDrag: () => void; applyPendingMask: () => Promise<boolean>; }
export const CommerceLayerCanvas = forwardRef<CommerceLayerCanvasHandle, Props>(function CommerceLayerCanvas({ document: value, source, previews, selectedId, disabled, maskMode, maskBase, onSelect, onChange, onMask, onCancelMask, onMaskDirty }, ref) {
  const stage = useRef<HTMLDivElement>(null), mask = useRef<HTMLCanvasElement>(null), drag = useRef<{ id: string; x: number; y: number; clientX: number; clientY: number } | undefined>(undefined), drawing = useRef(false), latest = useRef(value); latest.current = value;
  const pending = useRef<{ x: number; y: number } | undefined>(undefined), frame = useRef<number | undefined>(undefined), [stageWidth, setStageWidth] = useState(600), [brush, setBrush] = useState(28), [maskDirty, setMaskDirty] = useState(false), [applying, setApplying] = useState(false), maskChanged = useRef(false), maskSave = useRef<Promise<boolean> | undefined>(undefined);
  type Stroke = { points: { x: number; y: number }[]; radius: number };
  const strokes = useRef<Stroke[]>([]), redoStrokes = useRef<Stroke[]>([]), [, historyTick] = useState(0);
  const width = maskMode === 'product' ? source.width : value.width, height = maskMode === 'product' ? source.height : value.height, scale = stageWidth / width;
  useEffect(() => { if (!stage.current) return; const observer = new ResizeObserver(entries => setStageWidth(entries[0].contentRect.width)); observer.observe(stage.current); return () => observer.disconnect(); }, []);
  useEffect(() => { strokes.current = []; redoStrokes.current = []; maskChanged.current = false; onMaskDirty?.(false); const element = mask.current; if (!element) return; const ratio = Math.min(1, 1024 / width, 1024 / height); element.width = Math.max(1, Math.round(width * ratio)); element.height = Math.max(1, Math.round(height * ratio)); setMaskDirty(false); historyTick(value => value + 1); }, [maskMode, width, height]);
  useEffect(() => () => { if (frame.current !== undefined) cancelAnimationFrame(frame.current); }, []);
  function applyDrag() {
    frame.current = undefined; const active = drag.current, point = pending.current; if (!active || !point) return;
    onChange(changeCommerceLayer(latest.current, active.id, { x: active.x + (point.x - active.clientX) / scale, y: active.y + (point.y - active.clientY) / scale }), `drag:${active.id}`);
  }
  function start(event: ReactPointerEvent<HTMLDivElement>, id: string) {
    onSelect(id); const layer = latest.current.layers.find(layer => layer.id === id); if (!layer || layer.locked || disabled || maskMode) return;
    event.currentTarget.setPointerCapture(event.pointerId); drag.current = { id, x: layer.x, y: layer.y, clientX: event.clientX, clientY: event.clientY }; event.preventDefault();
  }
  function move(event: ReactPointerEvent<HTMLDivElement>) { if (!drag.current) return; pending.current = { x: event.clientX, y: event.clientY }; if (frame.current === undefined) frame.current = requestAnimationFrame(applyDrag); }
  function stop() { if (frame.current !== undefined) cancelAnimationFrame(frame.current); if (drag.current && pending.current) applyDrag(); drag.current = undefined; pending.current = undefined; }
  function paint(event: ReactPointerEvent<HTMLCanvasElement>, first = false) {
    if (disabled || applying || !first && !drawing.current || first && strokes.current.length >= 60) return;
    const element = event.currentTarget, context = element.getContext('2d'), rect = element.getBoundingClientRect(); if (!context) return;
    const x = (event.clientX - rect.left) * element.width / rect.width, y = (event.clientY - rect.top) * element.height / rect.height, size = brush * element.width / rect.width;
    if (first) { drawing.current = true; element.setPointerCapture(event.pointerId); strokes.current.push({ points: [{ x, y }], radius: Math.max(.5, size / 2) }); redoStrokes.current = []; context.fillStyle = '#2469ff'; context.beginPath(); context.arc(x, y, Math.max(.5, size / 2), 0, Math.PI * 2); context.fill(); context.beginPath(); context.moveTo(x, y); }
    else { const stroke = strokes.current.at(-1); if (!stroke || stroke.points.length > 8000) return; stroke.points.push({ x, y }); }
    context.lineWidth = Math.max(1, size); context.lineCap = 'round'; context.lineJoin = 'round'; context.strokeStyle = '#2469ff'; context.lineTo(x, y); context.stroke(); maskChanged.current = true; setMaskDirty(true); onMaskDirty?.(true);
  }
  function redrawMask() {
    const element = mask.current, context = element?.getContext('2d'); if (!element || !context) return;
    context.clearRect(0, 0, element.width, element.height); context.strokeStyle = '#2469ff'; context.fillStyle = '#2469ff'; context.lineCap = 'round'; context.lineJoin = 'round';
    for (const stroke of strokes.current) { const first = stroke.points[0]; context.beginPath(); context.arc(first.x, first.y, stroke.radius, 0, Math.PI * 2); context.fill(); context.beginPath(); context.moveTo(first.x, first.y); context.lineWidth = stroke.radius * 2; for (const point of stroke.points.slice(1)) context.lineTo(point.x, point.y); context.stroke(); }
    maskChanged.current = strokes.current.length > 0; setMaskDirty(maskChanged.current); onMaskDirty?.(maskChanged.current); historyTick(value => value + 1);
  }
  function finishStroke() { drawing.current = false; historyTick(value => value + 1); }
  function undoMask() { if (applying) return; drawing.current = false; const stroke = strokes.current.pop(); if (!stroke) return; redoStrokes.current.push(stroke); redrawMask(); }
  function redoMask() { if (applying) return; drawing.current = false; const stroke = redoStrokes.current.pop(); if (!stroke) return; strokes.current.push(stroke); redrawMask(); }
  useEffect(() => { if (!maskMode) return; const key = (event: KeyboardEvent) => { if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z' || event.target instanceof Element && event.target.closest('input,textarea,[contenteditable=true]')) return; event.preventDefault(); event.stopImmediatePropagation(); if (event.shiftKey) redoMask(); else undoMask(); }; window.addEventListener('keydown', key, true); return () => window.removeEventListener('keydown', key, true); }, [maskMode, applying]);
  async function applyPendingMask() {
    if (maskSave.current) return maskSave.current; if (!maskChanged.current) return true; if (!mask.current) return false;
    finishStroke(); setApplying(true); const data = mask.current.toDataURL('image/png');
    const task = onMask(data).then(() => { maskChanged.current = false; setMaskDirty(false); onMaskDirty?.(false); return true; }, () => false).finally(() => { setApplying(false); maskSave.current = undefined; }); maskSave.current = task; return task;
  }
  useImperativeHandle(ref, () => ({ flushDrag: stop, applyPendingMask }));
  const protectedBase = value.protectionSourceArtifactId && previews[value.protectionSourceArtifactId], protectedMask = value.protectedMaskArtifactId && previews[value.protectedMaskArtifactId];
  return <section className="cle-canvas-section" aria-label="独立图层画布">{maskMode && <div className="cle-mask-toolbar"><div><strong>{maskMode === 'product' ? '涂选要保留的商品主体' : '涂选允许修改的区域'}</strong><small>{maskMode === 'product' ? '只采蒙版透明度，主体RGB仍来自原图。' : '蓝色区域可改变；未选区域保留基准图原像素，包括文字和Logo。'}</small></div><label>画笔<input aria-label="蒙版画笔大小" inputMode="numeric" value={brush} onChange={event => setBrush(Math.max(2, Math.min(120, Number(event.target.value) || 2)))} /></label><button type="button" className="btn-icon" aria-label="撤销一笔蒙版" disabled={applying || !strokes.current.length} onClick={undoMask}><Undo2 size={16} /></button><button type="button" className="btn-icon" aria-label="重做一笔蒙版" disabled={applying || !redoStrokes.current.length} onClick={redoMask}><Redo2 size={16} /></button><button type="button" className="btn btn-ghost" disabled={applying} onClick={() => { strokes.current = []; redoStrokes.current = []; redrawMask(); }}>清空</button><button type="button" className="btn btn-secondary" disabled={applying} onClick={onCancelMask}>取消</button><button type="button" className="btn btn-primary" disabled={!maskDirty || applying || disabled} onClick={() => { void applyPendingMask(); }}>{applying ? '应用中…' : '应用涂选'}</button></div>}
    {maskMode && strokes.current.length >= 60 && <p className="cle-inline-error" role="status">当前选区已达60笔；可撤销修正，或清空后使用较大画笔重画。</p>}
    <div className="cle-stage-scroll"><div ref={stage} className={`cle-stage ${value.background === 'transparent' ? 'is-transparent' : ''}`} style={{ aspectRatio: `${width}/${height}`, backgroundColor: value.background }}>
      {maskMode ? <img className="cle-mask-source" src={maskMode === 'product' ? source.previewDataUrl : maskBase || protectedBase || source.previewDataUrl} alt="涂选基准图片" /> : <>
        {protectedBase && protectedMask && <img className="cle-mask-source" src={protectedBase} alt="受保护基准" />}
        <div className="cle-layer-group" style={protectedBase && protectedMask ? { maskImage: `url(${protectedMask})`, maskSize: '100% 100%' } : undefined}>
          {value.layers.filter(layer => layer.visible).map(layer => <div key={layer.id} role="button" tabIndex={disabled ? -1 : 0} aria-label={`图层 ${layer.name}`} aria-pressed={selectedId === layer.id} className={`cle-layer ${selectedId === layer.id ? 'selected' : ''} ${layer.locked ? 'locked' : ''}`} style={{ left: `${layer.x / width * 100}%`, top: `${layer.y / height * 100}%`, width: `${layer.width / width * 100}%`, height: `${layer.height / height * 100}%`, opacity: layer.opacity }} onPointerDown={event => start(event, layer.id)} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || layer.locked || disabled) return; event.preventDefault(); const delta = event.shiftKey ? 10 : 1; onChange(changeCommerceLayer(latest.current, layer.id, { x: layer.x + (event.key === 'ArrowLeft' ? -delta : event.key === 'ArrowRight' ? delta : 0), y: layer.y + (event.key === 'ArrowUp' ? -delta : event.key === 'ArrowDown' ? delta : 0) }), `move:${layer.id}`); }}>
            {layer.type === 'image' ? previews[layer.artifactId] ? <img src={previews[layer.artifactId]} alt={layer.name} draggable={false} /> : <span className="cle-missing-image">图片预览暂不可用</span> : <div className="cle-text" style={{ fontFamily: layer.fontFamily, fontSize: layer.fontSize * scale, fontWeight: layer.fontWeight, textAlign: layer.align, color: layer.color }}>{layer.text}</div>}
          </div>)}
        </div>
      </>}
      {maskMode && <canvas ref={mask} className="cle-mask" aria-label="主体与保护区蒙版画布" onPointerDown={event => paint(event, true)} onPointerMove={event => paint(event)} onPointerUp={finishStroke} onPointerCancel={finishStroke} />}
    </div></div><p className="cle-canvas-caption">{width} × {height} px · 预览使用缩略图，导出读取原图。{maskMode ? '涂选仅保留参数与小蒙版，不消耗API费用。' : '拖动移动，方向键微调；Shift＋方向键移动10px。'}</p>
  </section>;
});
