import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, RotateCcw, Undo2, X } from 'lucide-react';
import type { PointerEvent } from 'react';
import { ModalPortal } from './ModalPortal';
import './image-markup-editor.css';
type Point = { x: number; y: number };
export function ImageMarkupEditor({ source, onSave, onClose }: { source: string; onSave: (dataUrl: string) => Promise<void>; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null), image = useRef<HTMLImageElement>(null), strokes = useRef<Point[][]>([]), active = useRef<Point[] | undefined>(undefined);
  const [ready, setReady] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState(''), [count, setCount] = useState(0);
  function redraw() {
    const element = canvas.current, context = element?.getContext('2d'); if (!element || !context) return;
    context.clearRect(0, 0, element.width, element.height); context.strokeStyle = '#f04444'; context.lineWidth = Math.max(3, element.width / 220); context.lineCap = 'round'; context.lineJoin = 'round';
    for (const points of strokes.current) { context.beginPath(); for (let index = 0; index < points.length; index++) { if (!index) context.moveTo(points[index].x, points[index].y); else context.lineTo(points[index].x, points[index].y); } context.stroke(); }
  }
  function loaded() { const source = image.current, layer = canvas.current; if (!source || !layer) return; if (source.naturalWidth * source.naturalHeight > 16777216) { setError('原图超过圈画像素限制，请先缩小。'); return; } layer.width = source.naturalWidth; layer.height = source.naturalHeight; setReady(true); redraw(); }
  function point(event: PointerEvent<HTMLCanvasElement>) { const element = event.currentTarget, bounds = element.getBoundingClientRect(); return { x: (event.clientX - bounds.left) * element.width / bounds.width, y: (event.clientY - bounds.top) * element.height / bounds.height }; }
  function down(event: PointerEvent<HTMLCanvasElement>) { if (!ready || saving) return; event.currentTarget.setPointerCapture(event.pointerId); active.current = [point(event)]; strokes.current.push(active.current); setCount(strokes.current.length); }
  function move(event: PointerEvent<HTMLCanvasElement>) { if (!active.current) return; const next = point(event), previous = active.current.at(-1)!; const context = event.currentTarget.getContext('2d'); active.current.push(next); if (context) { context.beginPath(); context.moveTo(previous.x, previous.y); context.lineTo(next.x, next.y); context.strokeStyle = '#f04444'; context.lineWidth = Math.max(3, event.currentTarget.width / 220); context.lineCap = 'round'; context.stroke(); } }
  function stop() { active.current = undefined; }
  async function save() { if (!canvas.current || !count || saving) return; setSaving(true); setError(''); try { await onSave(canvas.current.toDataURL('image/png')); onClose(); } catch (cause) { setError(cause instanceof Error ? cause.message : '标注没有保存，请重试。'); } finally { setSaving(false); } }
  useEffect(() => () => { active.current = undefined; }, []);
  return <ModalPortal onClose={onClose} busy={saving}><div className="ime-overlay"><section className="ime-panel" role="dialog" aria-modal="true" aria-label="圈画修改位置"><header><div><h2>圈画修改位置</h2><p>用红线圈出想修改的区域，再用文字说明；原图不会被涂改。</p></div><button type="button" className="btn-icon" disabled={saving} onClick={onClose} aria-label="关闭圈画窗口"><X size={20} /></button></header><div className="ime-toolbar"><button className="btn btn-secondary" disabled={!count || saving} onClick={() => { strokes.current.pop(); setCount(strokes.current.length); redraw(); }}><Undo2 size={16} />撤销一笔</button><button className="btn btn-ghost" disabled={!count || saving} onClick={() => { strokes.current = []; setCount(0); redraw(); }}><RotateCcw size={16} />清空标注</button><span>标注独立保存为透明PNG，不消耗API费用</span></div><div className="ime-canvas"><div><img ref={image} src={source} alt="圈画原图" onLoad={loaded} onError={() => setError('原图无法读取，请重新选择。')} /><canvas ref={canvas} aria-label="圈画标注画布" onPointerDown={down} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} /></div></div>{error && <p className="ime-error" role="alert">{error}</p>}<footer><span>{count} 笔标注</span><button className="btn btn-secondary" disabled={saving} onClick={onClose}>取消</button><button className="btn btn-primary" disabled={!ready || !count || saving} onClick={() => { void save(); }}>{saving && <LoaderCircle size={16} className="spin" />}使用这份标注</button></footer></section></div></ModalPortal>;
}
