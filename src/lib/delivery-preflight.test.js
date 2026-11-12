import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { fixture, word, dependencies } = require('./production-test-fixtures.cjs');
const { createDeliveryPreflight } = require('../../electron/delivery-preflight.cjs');
const { analyzeDeliveryArtifact, OFFICE } = require('../../electron/delivery-preflight-analysis.cjs');
const active = [], services = [];
afterEach(async () => { for (const service of services.splice(0)) await service.shutdown(); for (const f of active.splice(0)) { await f.engine.shutdown(); await fs.rm(f.directory, { recursive: true, force: true }); } });
async function setup() { const f = await fixture(); active.push(f); await f.workspaceStorage.ensureProject({ projectId: 'preflight-project', workspaceId: 'production-workspace', name: '预检真实成品' }); return f; }
function service(f, options = {}) { const result = createDeliveryPreflight({ artifactStore: f.artifactStore, loadModule: dependencies, ...options }); services.push(result); return result; }
const selection = (file, kind = 'word', requestId = 'preflight-one') => ({ projectId: 'preflight-project', kind, artifactIds: [file.id], requestId });
async function savedWord(f) {
  const document = word('已确认的客户正文，不是未保存草稿'), exported = await f.editorStore.export({ projectId: 'preflight-project', expectedRevision: 0, document });
  const original = await f.artifactStore.read(exported.artifacts.find(file => file.kind === 'office').id), zip = await dependencies('jszip').loadAsync(original.buffer);
  zip.file('word/document.xml', (await zip.file('word/document.xml').async('string')).replace(/<w:sz w:val="\d+"\/>/g, '<w:sz w:val="14"/>'));
  const file = await f.artifactStore.write({ projectId: 'preflight-project', name: '真实小字号.docx', mimeType: OFFICE.word, buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  return { file, document, sourceRevision: exported.record.revision };
}

describe('绑定实际导出文件的本地交付预检', () => {
  it('真实DOCX读取小字号并定位已保存段落，无引擎时不假装验证分页，不修改原文件或费用', async () => {
    const f = await setup(), saved = await savedWord(f), before = (await f.artifactStore.read(saved.file.id)).buffer;
    const check = service(f, { readDocumentArtifact: async () => saved, officePreview: { status: async () => ({ available: false, reason: '未安装本地分页引擎' }) } });
    const result = await check.preflight({ ...selection(saved.file), sourceRevision: saved.sourceRevision });
    expect(result.findings.some(item => item.label.includes('小于8磅') && item.target.blockId === 'paragraph' && item.target.sourceRevision === saved.sourceRevision)).toBe(true);
    expect(result.checks.find(item => item.id.endsWith('actual-pagination')).status).toBe('unverified'); expect(result.rendered.status).toBe('unavailable');
    expect((await f.artifactStore.read(saved.file.id)).buffer).toEqual(before); expect((await f.engine.snapshot()).ledger).toEqual([]); expect(f.calls).toEqual([]);
    expect(result.pdfPreviews).toBeUndefined();
  });
  it('真实PPTX检测越界对象、小字号并绑定页码和源页', async () => {
    const f = await setup(), Pptx = dependencies('pptxgenjs'), ppt = new Pptx(); ppt.layout = 'LAYOUT_WIDE';
    const page = ppt.addSlide(); page.addText('OFF-CANVAS', { x: 12.8, y: 0.4, w: 2, h: 0.5, fontSize: 6 });
    const bytes = Buffer.from(await ppt.write({ outputType: 'nodebuffer' })), file = await f.artifactStore.write({ projectId: 'preflight-project', name: '真实越界演示.pptx', mimeType: OFFICE.ppt, buffer: bytes });
    const report = await service(f, { readDocumentArtifact: async () => ({ sourceRevision: 3, document: { kind: 'ppt', slides: [{ id: 'source-page', title: 'OFF-CANVAS', body: '' }] } }) }).preflight({ ...selection(file, 'ppt'), sourceRevision: 3 });
    expect(report.findings.some(item => item.label.includes('超出画布') && item.target.pageNumber === 1 && item.target.pageId === 'source-page')).toBe(true);
    expect(report.findings.some(item => item.label.includes('小于10磅'))).toBe(true); expect(report.files[0].sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  });
  it('读取真实XLSX的错误、未支持公式、缓存缺失和不一致，定位真实sheet/cell', async () => {
    const f = await setup(), Excel = dependencies('exceljs'), workbook = new Excel.Workbook(), sheet = workbook.addWorksheet('采购');
    sheet.getCell('A1').value = 2; sheet.getCell('A2').value = 3;
    sheet.getCell('B1').value = { formula: 'SUM(A1:A2)', result: 99 }; sheet.getCell('B2').value = { formula: '1/0', result: { error: '#DIV/0!' } };
    sheet.getCell('C1').value = { formula: 'SUM(A1:A2)' }; sheet.getCell('C2').value = { formula: 'VLOOKUP(A1,A1:B2,2,FALSE)', result: 2 };
    const file = await f.artifactStore.write({ projectId: 'preflight-project', name: '真实公式.xlsx', mimeType: OFFICE.excel, buffer: Buffer.from(await workbook.xlsx.writeBuffer()) });
    const result = await service(f, { readDocumentArtifact: async () => ({ sourceRevision: 2, document: { kind: 'excel', sheets: [{ id: 'purchase-sheet', name: '采购' }] } }) }).preflight({ ...selection(file, 'excel'), sourceRevision: 2 });
    expect(result.findings.some(item => item.label.includes('缓存与本地重算不一致') && item.target.cellAddress === 'B1' && item.target.sheetId === 'purchase-sheet')).toBe(true);
    expect(result.findings.some(item => item.target.cellAddress === 'B2' && item.severity === 'error')).toBe(true);
    expect(result.findings.some(item => item.target.cellAddress === 'C2' && item.severity === 'unverified')).toBe(true);
    expect(result.checks.some(item => item.detail.includes('1处没有导出缓存') && item.status === 'issues')).toBe(true);
  });
  it('真实PNG解码透明像素，缓存只存结构结果；相同字节不同登记仍返回正确artifact定位', async () => {
    const f = await setup(), { PNG } = dependencies('pngjs'), png = new PNG({ width: 3, height: 2 }); png.data.fill(255); png.data[3] = 0;
    const buffer = PNG.sync.write(png), file = await f.artifactStore.write({ projectId: 'preflight-project', name: '透明.png', mimeType: 'image/png', buffer }), check = service(f);
    const first = await check.preflight(selection(file, 'image')); const secondFile = await f.artifactStore.write({ projectId: 'preflight-project', name: '同字节.png', mimeType: 'image/png', buffer });
    const second = await check.preflight(selection(secondFile, 'image', 'second-file'));
    expect(first.checks.some(item => item.detail.includes('3 × 2'))).toBe(true); expect(first.checks.some(item => item.detail.includes('1 个非不透明'))).toBe(true);
    expect(second.cached).toBe(true); expect(second.findings.every(item => item.target.artifactId === secondFile.id)).toBe(true); expect(JSON.stringify(second)).not.toContain('pdfBase64');
  });
  it('拒绝错项目、错保存版本、外部改字节和错SHA，不写回或抹掉成品', async () => {
    const f = await setup(), saved = await savedWord(f), check = service(f, { readDocumentArtifact: async () => saved });
    await expect(check.preflight({ ...selection(saved.file), projectId: 'other-project' })).rejects.toThrow('本项目');
    await expect(check.preflight({ ...selection(saved.file), sourceRevision: 999 })).rejects.toThrow('版本不一致');
    await fs.appendFile(saved.file.path, 'OUTSIDE-CHANGE'); await expect(check.preflight(selection(saved.file))).rejects.toThrow(/改变/);
    expect(await fs.readFile(saved.file.path, 'utf8')).toContain('OUTSIDE-CHANGE');
    await expect(analyzeDeliveryArtifact({ file: { id: 'file', projectId: 'p', name: 'fake.png', mimeType: 'image/png', sha256: '0'.repeat(64), buffer: Buffer.from('bad') } })).rejects.toThrow('指纹');
  });
  it('队列可取消、退出等待后台且拒绝新任务；真实PDF只能匹配原文件SHA', async () => {
    const f = await setup(), saved = await savedWord(f), render = vi.fn(async () => ({ artifactId: saved.file.id, projectId: 'preflight-project', sourceSha256: 'wrong', pdfBase64: Buffer.from('%PDF-1.4\n%%EOF').toString('base64') }));
    const renderer = { status: async () => ({ available: true }), render, cancel: vi.fn() }, check = service(f, { officePreview: renderer });
    const result = await check.preflight(selection(saved.file)); expect(result.pdfPreviews).toBeUndefined(); expect(result.rendered.reason).toContain('指纹不一致');
    let entered; const ready = new Promise(resolve => { entered = resolve; });
    const cancellable = service(f, { runAnalysis: (_file, _binding, signal) => new Promise((_resolve, reject) => { entered(); signal.addEventListener('abort', () => reject(Error('cancelled')), { once: true }); }) });
    const pending = cancellable.preflight(selection(saved.file)); await ready; cancellable.cancel({ requestId: 'preflight-one' }); await expect(pending).rejects.toThrow('取消');
    await cancellable.shutdown(); await expect(cancellable.preflight(selection(saved.file))).rejects.toThrow('退出');
  });
  it('仅有实际渲染后的PDF payload；相同成品复查复用OOXML但不把PDF放进结果缓存', async () => {
    const f = await setup(), saved = await savedWord(f), pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF'), source = await f.artifactStore.read(saved.file.id);
    const renderer = { status: async () => ({ available: true }), render: vi.fn(async () => ({ previewId: 'real-preview', artifactId: saved.file.id, projectId: source.projectId, sourceSha256: createHash('sha256').update(source.buffer).digest('hex'), renderer: 'isolated-real-pdf-fixture', pdfBase64: pdf.toString('base64'), pdfSha256: createHash('sha256').update(pdf).digest('hex') })) };
    const check = service(f, { officePreview: () => renderer, readDocumentArtifact: async () => saved });
    const first = await check.preflight(selection(saved.file)), next = await check.preflight(selection(saved.file));
    expect(first.rendered.status).toBe('partial'); expect(first.pdfPreviews[0].sourceMap.blocks[0].blockId).toBe('paragraph'); expect(next.cached).toBe(true); expect(renderer.render).toHaveBeenCalledTimes(2); expect(next.checks.find(item => item.id.endsWith('actual-pagination')).status).toBe('unverified');
  });
});
