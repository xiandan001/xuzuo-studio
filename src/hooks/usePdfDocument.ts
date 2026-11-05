import { useEffect, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';

export function usePdfDocument(encoded: string | undefined) {
  const [document, setDocument] = useState<PDFDocumentProxy>(), [error, setError] = useState('');
  useEffect(() => {
    let disposed = false, task: { destroy: () => Promise<void> } | undefined;
    setDocument(undefined); setError(''); if (!encoded) return;
    void (async () => {
      try {
        const [library, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
        if (disposed) return; library.GlobalWorkerOptions.workerSrc = worker.default;
        const raw = atob(encoded), bytes = new Uint8Array(raw.length); for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
        const loading = library.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: true, disableAutoFetch: true }); task = loading;
        const pdf = await loading.promise; if (disposed) { await pdf.destroy(); return; } setDocument(pdf);
      } catch (cause) { if (!disposed) setError(cause instanceof Error ? cause.message : 'PDF 分页未能读取，请重新生成预览。'); }
    })();
    return () => { disposed = true; void task?.destroy().catch(() => undefined); };
  }, [encoded]);
  return { document, error };
}
