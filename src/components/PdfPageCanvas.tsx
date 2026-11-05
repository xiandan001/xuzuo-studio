import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';

export interface PdfEdgeHint { page: number; text: string; }
export function PdfPageCanvas({ document, page, zoom, onHints }: { document: PDFDocumentProxy; page: number; zoom: number; onHints: (hints: PdfEdgeHint[]) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [availableWidth, setAvailableWidth] = useState(900);
  const callbacks = useRef(onHints); callbacks.current = onHints;
  useEffect(() => { const container = canvas.current?.parentElement; if (!container) return; const measure = () => setAvailableWidth(Math.max(260, container.clientWidth - 24)); const observer = new ResizeObserver(measure); observer.observe(container); measure(); return () => observer.disconnect(); }, []);
  useEffect(() => {
    let disposed = false, render: RenderTask | undefined; setError(''); setLoading(true);
    void (async () => {
      try {
        const source = await document.getPage(page); if (disposed || !canvas.current) return;
        const initial = source.getViewport({ scale: 1 }), scale = Math.min(1100, availableWidth) / initial.width * zoom / 100, viewport = source.getViewport({ scale });
        const outputScale = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(4_000_000 / (viewport.width * viewport.height))), element = canvas.current, context = element.getContext('2d');
        if (!context) throw new Error('当前环境无法显示 PDF 页面。');
        element.width = Math.ceil(viewport.width * outputScale); element.height = Math.ceil(viewport.height * outputScale); element.style.width = viewport.width + 'px'; element.style.height = viewport.height + 'px';
        render = source.render({ canvas: element, canvasContext: context, viewport, transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0] }); await render.promise;
        const text = await source.getTextContent(); const width = source.view[2] - source.view[0], height = source.view[3] - source.view[1];
        const hints = text.items.flatMap(item => { if (!('str' in item) || !item.str.trim()) return []; const x = item.transform[4] - source.view[0], y = item.transform[5] - source.view[1]; return x < 0 || x + item.width > width + 1 || y < 0 || y > height + 1 ? [{ page, text: item.str.slice(0, 100) }] : []; }).slice(0, 30);
        if (!disposed) { callbacks.current(hints); setLoading(false); }
      } catch (cause) { if (!disposed && !(cause instanceof Error && cause.name === 'RenderingCancelledException')) { setError(cause instanceof Error ? cause.message : '页面未能显示。'); setLoading(false); } }
    })();
    return () => { disposed = true; render?.cancel(); if (canvas.current) { canvas.current.width = 0; canvas.current.height = 0; } };
  }, [document, page, zoom, availableWidth]);
  return <section className="ofp-page" aria-label={`实际导出第 ${page} 页`} aria-busy={loading}>{loading && <p role="status">正在显示第 {page} 页…</p>}{error && <p role="alert">{error}</p>}<canvas ref={canvas} aria-label={`第 ${page} 页实际版式`} /></section>;
}
