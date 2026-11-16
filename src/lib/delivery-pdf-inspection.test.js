import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { completeDeliveryPreflight, inspectDeliveryPdf, pdfTextGeometry } from './delivery-pdf-inspection';
const require = createRequire(import.meta.url), { dependencies } = require('./production-test-fixtures.cjs');
afterEach(() => vi.unstubAllGlobals());
function realPdf(text = 'BT /F1 12 Tf 1 0 0 1 580 300 Tm (FIRST BLOCK) Tj /F1 6 Tf 1 0 0 1 40 60 Tm (TINY) Tj ET') {
  const objects = ['<</Type /Catalog /Pages 2 0 R>>', '<</Type /Pages /Kids [3 0 R] /Count 1>>', '<</Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources <</Font <</F1 4 0 R>>>> /Contents 5 0 R>>', '<</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>', `<</Length ${Buffer.byteLength(text)}>>\nstream\n${text}\nendstream`];
  let output = '%PDF-1.4\n', offsets = [0]; for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(output)); output += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const start = Buffer.byteLength(output); output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<</Size ${objects.length + 1} /Root 1 0 R>>\nstartxref\n${start}\n%%EOF\n`; return Buffer.from(output);
}
function payload(bytes = realPdf()) { return { artifactId: 'artifact', name: '真实导出.pptx', sourceSha256: 'a'.repeat(64), sourceRevision: 4, previewId: 'preview', renderer: 'isolated-pdf-fixture', pdfSha256: createHash('sha256').update(bytes).digest('hex'), pdfBase64: bytes.toString('base64'), sourceMap: { blocks: [{ blockId: 'first-block', text: 'FIRST BLOCK' }, { blockId: 'small-block', text: 'TINY' }] } }; }
async function actualPdfLoader() {
  // Text extraction uses PDF.js array transforms; no canvas renderer is substituted.
  if (!globalThis.DOMMatrix) vi.stubGlobal('DOMMatrix', class DOMMatrix { a = 1; b = 0; c = 0; d = 1; e = 0; f = 0; });
  const url = pathToFileURL(dependencies.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href;
  const library = await import(/* @vite-ignore */ url);
  library.GlobalWorkerOptions.workerSrc = pathToFileURL(dependencies.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
  return bytes => library.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: true, disableFontFace: true, disableAutoFetch: true });
}
describe('真实PDF分页预检与有界元数据', () => {
  it('真正解析有效PDF，输出页码/唯一段落/小字号/边界，消费后不保留base64', async () => {
    const pdf = payload(), loadDocument = await actualPdfLoader();
    const input = { version: 1, projectId: 'project', kind: 'ppt', requestId: 'request', generatedAt: '', cached: false, files: [{ id: 'artifact', sha256: pdf.sourceSha256 }], checks: [{ id: 'artifact-actual-pagination', artifactId: 'artifact', method: 'pdf', status: 'unverified', label: '等待', detail: '' }], findings: [], rendered: { status: 'partial' }, pdfPreviews: [pdf] };
    const result = await completeDeliveryPreflight(input, { loadDocument });
    expect(result.findings.some(item => item.label.includes('超出页面') && item.target.pageNumber === 1 && item.target.blockId === 'first-block' && item.target.sourceRevision === 4)).toBe(true);
    expect(result.findings.some(item => item.label.includes('小于8磅') && item.target.blockId === 'small-block')).toBe(true);
    expect(result.checks.find(item => item.id === 'artifact-actual-pagination').status).toBe('issues'); expect(result.pdfPreviews).toBeUndefined(); expect(JSON.stringify(result)).not.toContain(pdf.pdfBase64);
  });
  it('扫描/纯图片页保持未核定，不把没有文字当作视觉通过', async () => {
    const result = await inspectDeliveryPdf(payload(realPdf('q 1 0 0 1 0 0 cm Q')), { projectId: 'project', loadDocument: await actualPdfLoader() });
    expect(result.complete).toBe(false); expect(result.findings[0].severity).toBe('unverified'); expect(result.checks.find(item => item.id.endsWith('actual-pagination')).status).toBe('unverified');
  });
  it('源SHA不匹配或PDF被换字节时不使用旧分页', async () => {
    const pdf = payload(), loadDocument = vi.fn();
    await expect(inspectDeliveryPdf({ ...pdf, pdfSha256: '0'.repeat(64) }, { projectId: 'project', loadDocument })).rejects.toThrow('指纹'); expect(loadDocument).not.toHaveBeenCalled();
    await expect(completeDeliveryPreflight({ projectId: 'project', files: [{ id: pdf.artifactId, sha256: 'different' }], checks: [], findings: [], pdfPreviews: [pdf] }, { loadDocument })).rejects.toThrow('成品不一致');
  });
  it('取消会销毁后台PDF任务，超80页明确未核定，不读取无界页面', async () => {
    const abort = new AbortController(); let rejectTask;
    const destroy = vi.fn(async () => { rejectTask?.(Error('destroyed')); });
    const pending = inspectDeliveryPdf(payload(), { projectId: 'project', signal: abort.signal, loadDocument: () => ({ promise: new Promise((_resolve, reject) => { rejectTask = reject; abort.abort(); }), destroy }) });
    await expect(pending).rejects.toThrow(); expect(destroy).toHaveBeenCalled();
    const page = { getTextContent: async () => ({ items: [] }), cleanup: vi.fn() }, getPage = vi.fn(async () => page);
    const report = await inspectDeliveryPdf(payload(), { projectId: 'project', loadDocument: () => ({ promise: Promise.resolve({ numPages: 81, getPage }), destroy: async () => undefined }) });
    expect(getPage).toHaveBeenCalledTimes(80); expect(report.findings.some(item => item.label.includes('后续页面'))).toBe(true); expect(report.complete).toBe(false);
  });
  it('页面旋转通过真实viewport变换坐标，非法坐标不判通过', () => {
    const page = { getViewport: () => ({ width: 800, height: 600, scale: 1, convertToViewportPoint: (x, y) => [y, x] }) };
    expect(pdfTextGeometry({ str: 'rotated', transform: [12, 0, 0, 12, 40, 60], width: 50, height: 12 }, page)).toMatchObject({ x: 60, y: 40, width: 12, height: 50, outside: false });
    expect(pdfTextGeometry({ str: 'bad', transform: [0, 0, 0, 0, 40, 60], width: 50, height: 12 }, page)).toBeUndefined();
  });
});
