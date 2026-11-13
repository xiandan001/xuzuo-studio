import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { CommerceImageDocument, CommerceImagePreview, CommerceImageSource, CommerceImagesBridge } from '../commerce-image-types';
import { changeCommerceLayer } from '../lib/commerce-image';
import { Hand, LoaderCircle, Maximize2, Minus, MousePointer2, Plus, Redo2, Undo2 } from 'lucide-react';
import { commerceFitScale, commercePreviewPlans, commerceStageGeometry, commerceZoom, commerceZoomAnchor, COMMERCE_ZOOM_MAX, COMMERCE_ZOOM_MIN } from '../lib/commerce-viewport';
import { useCommerceClearPreviews } from '../hooks/useCommerceClearPreviews';
import { isTextEditingTarget } from '../lib/edit-history';

export type CommerceMaskMode = 'product' | 'protect';
interface Props {
  document: CommerceImageDocument; source: CommerceImageSource; previews: Record<string, string>; selectedId: string;
  disabled?: boolean; maskMode?: CommerceMaskMode; maskBase?: string; onSelect: (id: string) => void;
  previewBridge?: CommerceImagesBridge; maskArtifactId?: string;
  onChange: (document: CommerceImageDocument, group?: string) => void; onMask: (dataUrl: string) => Promise<void>; onCancelMask: () => void;
  onMaskDirty?: (dirty: boolean) => void;
}
export interface CommerceLayerCanvasHandle { flushDrag: () => void; applyPendingMask: () => Promise<boolean>; }
function PreviewRaster({ low, clear, alt, className }: { low: string; clear?: CommerceImagePreview; alt: string; className?: string }) {
  const crop = clear?.crop, left = (crop?.x || 0) * 100, top = (crop?.y || 0) * 100, right = left + (crop?.width || 0) * 100, bottom = top + (crop?.height || 0) * 100;
  // Cut a hole in the placeholder, rather than double-blending transparent pixels.
  const clipPath = crop ? `polygon(evenodd,0% 0%,100% 0%,100% 100%,0% 100%,0% 0%,${left}% ${top}%,${right}% ${top}%,${right}% ${bottom}%,${left}% ${bottom}%,${left}% ${top}%)` : undefined;
  return <><img className={className} src={low} alt={alt} draggable={false} style={{ clipPath }} />{clear && <img className="cle-clear-preview" src={clear.dataUrl} alt="" aria-hidden="true" draggable={false} data-preview-artifact={clear.artifactId} data-preview-sha256={clear.sha256} data-preview-crop={JSON.stringify(clear.crop)} data-source-size={`${clear.sourceWidth}x${clear.sourceHeight}`} data-preview-size={`${clear.width}x${clear.height}`} style={{ left: `${left}%`, top: `${top}%`, width: `${clear.crop.width * 100}%`, height: `${clear.crop.height * 100}%` }} />}</>;
}
export const CommerceLayerCanvas = forwardRef<CommerceLayerCanvasHandle, Props>(function CommerceLayerCanvas({ document: value, source, previews, selectedId, disabled, maskMode, maskBase, previewBridge, maskArtifactId, onSelect, onChange, onMask, onCancelMask, onMaskDirty }, ref) {
  const viewport = useRef<HTMLDivElement>(null), mask = useRef<HTMLCanvasElement>(null), drag = useRef<{ id: string; x: number; y: number; clientX: number; clientY: number } | undefined>(undefined), drawing = useRef(false), latest = useRef(value); latest.current = value;
  const pending = useRef<{ x: number; y: number } | undefined>(undefined), frame = useRef<number | undefined>(undefined), [brush, setBrush] = useState(28), [maskDirty, setMaskDirty] = useState(false), [applying, setApplying] = useState(false), maskChanged = useRef(false), maskSave = useRef<Promise<boolean> | undefined>(undefined);
  const [viewportSize, setViewportSize] = useState({ width: 600, height: 440 }), [zoom, setZoom] = useState<number>(), [scroll, setScroll] = useState({ left: 0, top: 0 }), [panTool, setPanTool] = useState(false), [spacePan, setSpacePan] = useState(false), [panning, setPanning] = useState(false);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | undefined>(undefined), nextScroll = useRef<{ left: number; top: number } | undefined>(undefined), scrollFrame = useRef<number | undefined>(undefined);
  type Stroke = { points: { x: number; y: number }[]; radius: number };
  const strokes = useRef<Stroke[]>([]), redoStrokes = useRef<Stroke[]>([]), [, historyTick] = useState(0);
  const width = maskMode === 'product' ? source.width : value.width, height = maskMode === 'product' ? source.height : value.height, scale = zoom ?? commerceFitScale(viewportSize, width, height), geometry = commerceStageGeometry(viewportSize, width, height, scale);
  const maskSourceId = maskMode === 'product' ? source.id : maskArtifactId || value.protectionSourceArtifactId || source.id;
  const plans = commercePreviewPlans(value, viewportSize, scale, scroll, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, selectedId, maskMode ? { artifactId: maskSourceId, width, height } : undefined);
  const clear = useCommerceClearPreviews({ projectId: value.projectId, scope: `${value.id}/${source.id}/${source.sha256}`, sourceId: source.id, sourceSha256: source.sha256, plans, bridge: previewBridge, enabled: !disabled && !applying });
  useEffect(() => { const element = viewport.current; if (!element) return; const observer = new ResizeObserver(entries => { const rect = entries[0]?.contentRect; if (rect && rect.width > 0) setViewportSize(previous => ({ width: rect.width, height: rect.height > 0 ? rect.height : previous.height })); }); observer.observe(element); return () => observer.disconnect(); }, []);
  useLayoutEffect(() => { setZoom(undefined); setScroll({ left: 0, top: 0 }); if (viewport.current) { viewport.current.scrollLeft = 0; viewport.current.scrollTop = 0; } }, [value.id, source.id, width, height, maskMode]);
  useLayoutEffect(() => { if (!nextScroll.current || !viewport.current) return; viewport.current.scrollLeft = nextScroll.current.left; viewport.current.scrollTop = nextScroll.current.top; setScroll(nextScroll.current); nextScroll.current = undefined; }, [scale, viewportSize.width, viewportSize.height]);
  useEffect(() => { strokes.current = []; redoStrokes.current = []; maskChanged.current = false; onMaskDirty?.(false); const element = mask.current; if (!element) return; const ratio = Math.min(1, 1024 / width, 1024 / height); element.width = Math.max(1, Math.round(width * ratio)); element.height = Math.max(1, Math.round(height * ratio)); setMaskDirty(false); historyTick(value => value + 1); }, [maskMode, width, height]);
  useEffect(() => () => { if (frame.current !== undefined) cancelAnimationFrame(frame.current); if (scrollFrame.current !== undefined) cancelAnimationFrame(scrollFrame.current); }, []);
  function applyDrag() {
    frame.current = undefined; const active = drag.current, point = pending.current; if (!active || !point) return;
    onChange(changeCommerceLayer(latest.current, active.id, { x: active.x + (point.x - active.clientX) / scale, y: active.y + (point.y - active.clientY) / scale }), `drag:${active.id}`);
  }
  function start(event: ReactPointerEvent<HTMLDivElement>, id: string) {
    onSelect(id); event.currentTarget.focus({ preventScroll: true }); const layer = latest.current.layers.find(layer => layer.id === id); if (!layer || layer.locked || disabled || maskMode || panTool || spacePan) return;
    event.currentTarget.setPointerCapture(event.pointerId); drag.current = { id, x: layer.x, y: layer.y, clientX: event.clientX, clientY: event.clientY }; event.preventDefault();
  }
  function move(event: ReactPointerEvent<HTMLDivElement>) { if (!drag.current) return; pending.current = { x: event.clientX, y: event.clientY }; if (frame.current === undefined) frame.current = requestAnimationFrame(applyDrag); }
  function stop() { if (frame.current !== undefined) cancelAnimationFrame(frame.current); if (drag.current && pending.current) applyDrag(); drag.current = undefined; pending.current = undefined; }
  function setViewScale(next: number, point?: { x: number; y: number }) {
    const element = viewport.current; if (!element || disabled || applying) return; stop(); finishStroke();
    const target = commerceZoom(next), anchor = point || { x: element.clientWidth / 2, y: element.clientHeight / 2 };
    nextScroll.current = commerceZoomAnchor(viewportSize, width, height, scale, target, { left: element.scrollLeft, top: element.scrollTop }, anchor); setZoom(target);
    if (target === scale) { element.scrollLeft = nextScroll.current.left; element.scrollTop = nextScroll.current.top; nextScroll.current = undefined; }
  }
  function fit() { if (disabled || applying) return; stop(); finishStroke(); nextScroll.current = { left: 0, top: 0 }; setZoom(undefined); if (viewport.current) { viewport.current.scrollLeft = 0; viewport.current.scrollTop = 0; } setScroll({ left: 0, top: 0 }); }
  function captureScroll() { if (scrollFrame.current !== undefined) return; scrollFrame.current = requestAnimationFrame(() => { scrollFrame.current = undefined; if (viewport.current) setScroll({ left: viewport.current.scrollLeft, top: viewport.current.scrollTop }); }); }
  function startPan(event: ReactPointerEvent<HTMLDivElement>) { if (disabled || applying || !(panTool || spacePan || event.button === 1)) return; const element = event.currentTarget; stop(); finishStroke(); pan.current = { x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop }; element.setPointerCapture(event.pointerId); element.focus({ preventScroll: true }); setPanning(true); event.preventDefault(); event.stopPropagation(); }
  function movePan(event: ReactPointerEvent<HTMLDivElement>) { if (!pan.current) return; event.currentTarget.scrollLeft = pan.current.left - event.clientX + pan.current.x; event.currentTarget.scrollTop = pan.current.top - event.clientY + pan.current.y; captureScroll(); event.preventDefault(); event.stopPropagation(); }
  function stopPan() { pan.current = undefined; setPanning(false); }
  const viewActions = useRef({ setViewScale, scale, disabled: disabled || applying }); viewActions.current = { setViewScale, scale, disabled: disabled || applying };
  useEffect(() => {
    const element = viewport.current; if (!element) return;
    const wheel = (event: WheelEvent) => { if (!(event.ctrlKey || event.metaKey) || isTextEditingTarget(event.target)) return; event.preventDefault(); event.stopPropagation(); if (viewActions.current.disabled) return; const rect = element.getBoundingClientRect(), delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1); viewActions.current.setViewScale(viewActions.current.scale * Math.exp(-Math.max(-300, Math.min(300, delta)) * .0025), { x: event.clientX - rect.left, y: event.clientY - rect.top }); };
    const down = (event: KeyboardEvent) => { if (event.code !== 'Space' || isTextEditingTarget(event.target) || !element.contains(document.activeElement)) return; event.preventDefault(); setSpacePan(true); };
    const up = (event: KeyboardEvent) => { if (event.code === 'Space') { setSpacePan(false); stopPan(); } };
    const blur = () => { setSpacePan(false); stopPan(); };
    element.addEventListener('wheel', wheel, { passive: false }); window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    return () => { element.removeEventListener('wheel', wheel); window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, []);
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
    <div className="cle-view-toolbar" role="toolbar" aria-label="画布视图"><div><button type="button" className="btn-icon" aria-label="选择与移动图层" aria-pressed={!panTool} disabled={disabled || applying} onClick={() => setPanTool(false)}><MousePointer2 size={17} /></button><button type="button" className="btn-icon" aria-label="拖动画布" aria-pressed={panTool} disabled={disabled || applying} onClick={() => { stop(); setPanTool(true); }}><Hand size={17} /></button></div><div><button type="button" className="btn-icon" aria-label="缩小画布" disabled={disabled || applying || scale <= COMMERCE_ZOOM_MIN} onClick={() => setViewScale(scale / 1.25)}><Minus size={17} /></button><output aria-label="画布缩放比例">{Math.round(scale * 100)}%</output><button type="button" className="btn-icon" aria-label="放大画布" disabled={disabled || applying || scale >= COMMERCE_ZOOM_MAX} onClick={() => setViewScale(scale * 1.25)}><Plus size={17} /></button><button type="button" className="btn btn-ghost" disabled={disabled || applying} onClick={() => setViewScale(1)}>100%</button><button type="button" className="btn btn-secondary" disabled={disabled || applying} onClick={fit}><Maximize2 size={14} />适应窗口</button></div><span role="status">{clear.loading ? <><LoaderCircle size={13} className="spin" />清晰预览加载中</> : previewBridge?.preview ? '按视口加载清晰图' : '当前后台提供缩略预览'}</span></div>
    {clear.issue && <p className="cle-preview-issue" role="status">{clear.issue}<button type="button" className="text-button" onClick={clear.retry}>重试预览</button></p>}
    <div ref={viewport} className={`cle-stage-scroll${panTool || spacePan ? ' is-pan-tool' : ''}${panning ? ' is-panning' : ''}`} tabIndex={0} aria-label="图片编辑视口" onScroll={captureScroll} onPointerDownCapture={startPan} onPointerMoveCapture={movePan} onPointerUpCapture={stopPan} onPointerCancelCapture={stopPan} onKeyDown={event => { if (isTextEditingTarget(event.target)) return; if ((event.ctrlKey || event.metaKey) && ['+', '=', '-', '0'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); if (event.key === '0') fit(); else setViewScale(scale * (event.key === '-' ? .8 : 1.25)); } }}><div className="cle-stage-space" style={{ width: geometry.scrollWidth, height: geometry.scrollHeight }}><div className={`cle-stage ${value.background === 'transparent' ? 'is-transparent' : ''}`} style={{ width: geometry.width, height: geometry.height, left: geometry.left, top: geometry.top, backgroundColor: value.background }}>

      {maskMode ? <PreviewRaster className="cle-mask-source" low={maskMode === 'product' ? source.previewDataUrl : maskBase || protectedBase || source.previewDataUrl} clear={clear.tiles['mask:base']} alt="涂选基准图片" /> : <>
        {protectedBase && protectedMask && <PreviewRaster className="cle-mask-source" low={protectedBase} clear={clear.tiles['protected:base']} alt="受保护基准" />}
        <div className="cle-layer-group" style={protectedBase && protectedMask ? { maskImage: `url(${protectedMask})`, maskSize: '100% 100%' } : undefined}>
          {value.layers.filter(layer => layer.visible).map(layer => <div key={layer.id} role="button" tabIndex={disabled ? -1 : 0} aria-label={`图层 ${layer.name}`} aria-pressed={selectedId === layer.id} className={`cle-layer ${selectedId === layer.id ? 'selected' : ''} ${layer.locked ? 'locked' : ''}`} style={{ left: `${layer.x / width * 100}%`, top: `${layer.y / height * 100}%`, width: `${layer.width / width * 100}%`, height: `${layer.height / height * 100}%`, opacity: layer.opacity }} onPointerDown={event => start(event, layer.id)} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || layer.locked || disabled || panTool || spacePan) return; event.preventDefault(); const delta = event.shiftKey ? 10 : 1; onChange(changeCommerceLayer(latest.current, layer.id, { x: layer.x + (event.key === 'ArrowLeft' ? -delta : event.key === 'ArrowRight' ? delta : 0), y: layer.y + (event.key === 'ArrowUp' ? -delta : event.key === 'ArrowDown' ? delta : 0) }), `move:${layer.id}`); }}>
            {layer.type === 'image' ? previews[layer.artifactId] ? <PreviewRaster low={previews[layer.artifactId]} clear={clear.tiles[`layer:${layer.id}`]} alt={layer.name} /> : <span className="cle-missing-image">图片预览暂不可用</span> : <div className="cle-text" style={{ fontFamily: layer.fontFamily, fontSize: layer.fontSize * scale, fontWeight: layer.fontWeight, textAlign: layer.align, color: layer.color }}>{layer.text}</div>}
          </div>)}
        </div>
      </>}
      {maskMode && <canvas ref={mask} className="cle-mask" aria-label="主体与保护区蒙版画布" onPointerDown={event => paint(event, true)} onPointerMove={event => paint(event)} onPointerUp={finishStroke} onPointerCancel={finishStroke} />}
    </div></div></div><p className="cle-canvas-caption">{width} × {height} px · {Math.round(scale * 100)}% · 导出读取原图。Ctrl＋滚轮缩放，空格＋拖动平移。{maskMode ? '涂选仅保留参数与小蒙版，不消耗API费用。' : '拖动移动，方向键微调；Shift＋方向键移动10px。'}</p>
  </section>;
});
