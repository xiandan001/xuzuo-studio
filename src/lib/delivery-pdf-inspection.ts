import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { DeliveryPreflightCheck, DeliveryPreflightFinding, DeliveryPreflightPdf, DeliveryPreflightReport, DeliveryPreflightTarget } from '../delivery-types';

const MAX_PAGES = 80, MAX_ITEMS = 20000;
const normalized = (text: string) => text.replace(/\s+/g, '').toLowerCase();
const cancelled = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException('已取消格式预检', 'AbortError'); };
type PdfItem = { str: string; width: number; height: number; transform: number[] };
type PdfPage = Awaited<ReturnType<PDFDocumentProxy['getPage']>>;
export interface PdfInspectionOptions { projectId: string; signal?: AbortSignal; onProgress?: (page: number, pages: number) => void; loadDocument?: (bytes: Uint8Array) => { promise: Promise<PDFDocumentProxy>; destroy: () => Promise<void> }; }

export function pdfTextGeometry(item: PdfItem, page: Pick<PdfPage, 'getViewport'>) {
  const t = item.transform;
  if (!Array.isArray(t) || t.length !== 6 || !t.every(Number.isFinite) || !Number.isFinite(item.width) || !Number.isFinite(item.height)) return;
  const horizontal = Math.hypot(t[0], t[1]), vertical = Math.hypot(t[2], t[3]);
  if (horizontal <= 0 || vertical <= 0 || item.width < 0 || item.height < 0) return;
  const vx = t[0] / horizontal * item.width, vy = t[1] / horizontal * item.width;
  const hx = t[2] / vertical * item.height, hy = t[3] / vertical * item.height;
  const viewport = page.getViewport({ scale: 1 }), points = [[t[4], t[5]], [t[4] + vx, t[5] + vy], [t[4] + hx, t[5] + hy], [t[4] + vx + hx, t[5] + vy + hy]].map(point => viewport.convertToViewportPoint(point[0], point[1]));
  const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
  const x = Math.min(...xs), y = Math.min(...ys), right = Math.max(...xs), bottom = Math.max(...ys);
  return { x, y, width: right - x, height: bottom - y, pageWidth: viewport.width, pageHeight: viewport.height, fontSize: vertical * viewport.scale, outside: x < -2 || y < -2 || right > viewport.width + 2 || bottom > viewport.height + 2 };
}
function location(pdf: DeliveryPreflightPdf, projectId: string, pageNumber: number, pages: number, text = ''): DeliveryPreflightTarget {
  const result: DeliveryPreflightTarget = { projectId, artifactId: pdf.artifactId, sha256: pdf.sourceSha256, pageNumber, ...(Number.isSafeInteger(pdf.sourceRevision) ? { sourceRevision: pdf.sourceRevision } : {}) };
  if (pdf.sourceMap?.pages?.length === pages && pdf.sourceMap.pages[pageNumber - 1]?.pageId) result.pageId = pdf.sourceMap.pages[pageNumber - 1].pageId;
  const content = normalized(text);
  if (content.length >= 4 && pdf.sourceMap?.blocks) { const matches = pdf.sourceMap.blocks.filter(block => normalized(block.text).includes(content)); if (matches.length === 1) result.blockId = matches[0].blockId; }
  return result;
}
async function documentLoader(bytes: Uint8Array) {
  const [library, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  library.GlobalWorkerOptions.workerSrc = worker.default;
  return library.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: true, disableAutoFetch: true });
}

export async function inspectDeliveryPdf(pdf: DeliveryPreflightPdf, options: PdfInspectionOptions) {
  cancelled(options.signal);
  if (pdf.pdfBase64.length > 28 * 1024 * 1024) throw Error('PDF 超过本轮20MB检查上限。');
  const raw = atob(pdf.pdfBase64), bytes = Uint8Array.from(raw, char => char.charCodeAt(0));
  const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.buffer))).map(value => value.toString(16).padStart(2, '0')).join('');
  if (actual !== pdf.pdfSha256) throw Error('PDF内容指纹不一致，未使用失效分页。');
  cancelled(options.signal);
  const task = options.loadDocument ? options.loadDocument(bytes) : await documentLoader(bytes);
  void task.promise.catch(() => undefined);
  const stop = () => { void task.destroy().catch(() => undefined); }; options.signal?.addEventListener('abort', stop, { once: true }); if (options.signal?.aborted) stop();
  const checks: DeliveryPreflightCheck[] = [], findings: DeliveryPreflightFinding[] = [];
  let pages = 0, checkedPages = 0, unknownPages = 0, outside = 0, small = 0;
  const add = (severity: DeliveryPreflightFinding['severity'], label: string, detail: string, target: DeliveryPreflightTarget) => { if (findings.length < 200) findings.push({ id: `${pdf.artifactId}-pdf-${findings.length}`, severity, label, detail, method: 'pdf', target }); };
  try {
    cancelled(options.signal);
    const document = await task.promise; cancelled(options.signal); pages = document.numPages;
    if (!Number.isSafeInteger(pages) || pages < 1) throw Error('实际PDF没有可读取的页面。');
    for (let pageNumber = 1; pageNumber <= Math.min(pages, MAX_PAGES); pageNumber++) {
      cancelled(options.signal); options.onProgress?.(pageNumber, Math.min(pages, MAX_PAGES));
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent(); cancelled(options.signal);
        const items = content.items.filter((item): item is typeof item & PdfItem => 'str' in item && !!item.str.trim());
        if (!items.length || items.length > MAX_ITEMS) { unknownPages++; add('unverified', `第 ${pageNumber} 页文字边界未核定`, !items.length ? '此页没有可提取文字，可能是纯图片或扫描页。不能据此判断画面为空或排版通过。' : '此页文字片段超过20000个检查上限，请分拆文件后核对。', location(pdf, options.projectId, pageNumber, pages)); continue; }
        checkedPages++; let unknownItems = 0;
        for (const item of items) {
          const geometry = pdfTextGeometry(item, page); if (!geometry) { unknownItems++; continue; }
          const target = location(pdf, options.projectId, pageNumber, pages, item.str), x = Math.min(1, Math.max(0, geometry.x / geometry.pageWidth)), y = Math.min(1, Math.max(0, geometry.y / geometry.pageHeight));
          target.region = { x, y, width: Math.max(0, Math.min(1 - x, geometry.width / geometry.pageWidth)), height: Math.max(0, Math.min(1 - y, geometry.height / geometry.pageHeight)) };
          if (geometry.outside) { outside++; add('warning', `第 ${pageNumber} 页文字靠近或超出页面`, `“${item.str.slice(0, 100)}”的实际PDF文字坐标超出页面容差，请检查是否为有意出血；这里只检查可提取文字，无法发现所有被裁掉的内容。`, target); }
          if (geometry.fontSize < 8) { small++; add('warning', `第 ${pageNumber} 页含小于8磅的可见文字`, `“${item.str.slice(0, 100)}”约 ${geometry.fontSize.toFixed(1)} 磅，请确认在实际交付尺寸下可读。`, target); }
        }
        if (unknownItems) { unknownPages++; add('unverified', `第 ${pageNumber} 页部分文字坐标未核定`, `${unknownItems}个片段缺少可靠的尺寸或变换，不以缺失坐标判定通过。`, location(pdf, options.projectId, pageNumber, pages)); }
      } finally { page.cleanup(); }
    }
    if (pages > MAX_PAGES) add('unverified', '后续页面尚未逐页检查', `文件共 ${pages} 页，本轮最多检查前 ${MAX_PAGES} 页。请拆分后检查剩余部分。`, location(pdf, options.projectId, MAX_PAGES + 1, pages));
    if (pdf.sourceMap?.pages && pdf.sourceMap.pages.length !== pages) add('warning', 'PPT实际分页与编辑页数不同', `编辑源 ${pdf.sourceMap.pages.length} 页，实际PDF ${pages} 页；已停用自动页面映射，请打开实际文件检查。`, location(pdf, options.projectId, 1, pages));
    checks.push({ id: pdf.artifactId + '-actual-pagination', artifactId: pdf.artifactId, label: '实际分页与可见文字', status: outside || small ? 'issues' : unknownPages || pages > MAX_PAGES ? 'unverified' : 'passed', method: 'pdf', detail: `${pdf.renderer}真实转换 ${pages} 页，读取 ${checkedPages} 页文字坐标；${outside}处边界提示，${small}处小字号。结果绑定当前成品SHA，Office/WPS使用不同字体时仍可能分页不同。` });
    checks.push({ id: pdf.artifactId + '-visual-layout', artifactId: pdf.artifactId, label: '遮挡、拥挤与图片裁切效果', status: 'unverified', method: 'pdf', detail: 'PDF文本坐标不能可靠证明所有图形遮挡、段落拥挤、字形裁切或图片主体完整。请打开真实分页逐页目视确认。' });
    return { checks, findings, pages, complete: !unknownPages && pages <= MAX_PAGES };
  } finally { options.signal?.removeEventListener('abort', stop); await task.destroy().catch(() => undefined); }
}

export async function completeDeliveryPreflight(input: DeliveryPreflightReport, options: Omit<PdfInspectionOptions, 'projectId'> = {}): Promise<DeliveryPreflightReport> {
  const { pdfPreviews, ...metadata } = input;
  const report = { ...metadata, checks: [...metadata.checks], findings: [...metadata.findings] };
  for (const pdf of pdfPreviews || []) {
    cancelled(options.signal);
    const source = report.files.find(file => file.id === pdf.artifactId);
    if (!source || source.sha256 !== pdf.sourceSha256) throw Error('分页与所选成品不一致，请重新预检。');
    try {
      const inspected = await inspectDeliveryPdf(pdf, { ...options, projectId: report.projectId });
      report.checks = report.checks.filter(check => check.id !== pdf.artifactId + '-actual-pagination').concat(inspected.checks);
      report.findings.push(...inspected.findings);
      report.rendered = { status: inspected.complete && !report.checks.some(check => check.id.endsWith('-actual-pagination') && check.status === 'unverified') ? 'available' : 'partial', engine: pdf.renderer, reason: '已读取真实分页；视觉质量仍需人工核对。' };
    } catch (error) {
      cancelled(options.signal);
      report.rendered = { status: 'partial', engine: pdf.renderer, reason: '实际分页文字分析未完成：' + (error instanceof Error ? error.message : '读取失败') };
      report.checks = report.checks.map(check => check.id === pdf.artifactId + '-actual-pagination' ? { ...check, status: 'unverified' as const, detail: report.rendered.reason || '' } : check);
    }
  }
  return report;
}
