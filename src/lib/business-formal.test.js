import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url), { fixture, word, dependencies } = require('./production-test-fixtures.cjs');
const { validateBusinessFormalArtifact: validate, boundedEntry } = require('../../electron/business-formal.cjs');
const JSZip = dependencies('jszip'), { PNG } = dependencies('pngjs'), options = { loadModule: dependencies }, closings = [];
const file = (buffer, mimeType, extra = {}) => ({ buffer, mimeType, name: '正式成品', ...extra });
const png = () => PNG.sync.write(new PNG({ width: 16, height: 24 }));
const gif = Buffer.from('47494638396101000100800000000000ffffff21f90401020000002c000000000100010000020244010021f90401020000002c00000000010001000002024401003b', 'hex');
async function zip(entries) { const value = new JSZip(); for (const [name, bytes] of Object.entries(entries)) value.file(name, bytes); return value.generateAsync({ type: 'nodebuffer', compression: 'STORE' }); }
afterEach(async () => { for (const close of closings.splice(0)) await close(); });
describe('正式客户文件格式与有界ZIP校验', () => {
  it('接受实际PNG、静态SVG、动画GIF、PDF和UTF8CSV，拒绝伪装/缺尾/不安全SVG', async () => {
    for (const [bytes, type] of [[png(), 'image/png'], [gif, 'image/gif'], [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 24"><path d="M0 0h16v24H0z"/></svg>'), 'image/svg+xml'], [Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF'), 'application/pdf'], [Buffer.from('色号,用量\nA1,32\n'), 'text/csv']]) await expect(validate(file(bytes, type), options)).resolves.toBeUndefined();
    await expect(validate(file(png(), 'image/jpeg'), options)).rejects.toThrow('格式'); await expect(validate(file(png().subarray(0, 25), 'image/png'), options)).rejects.toThrow();
    await expect(validate(file(Buffer.from('%PDF-1.7 incomplete'), 'application/pdf'), options)).rejects.toThrow('不完整'); await expect(validate(file(Buffer.from([255, 254]), 'text/csv'), options)).rejects.toThrow();
    await expect(validate(file(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'), 'image/svg+xml'), options)).rejects.toThrow();
  });
  it('只接受自包含的拼豆工程，拒绝图层快照/模型配置以及内部字段', async () => {
    await expect(validate(file(Buffer.from(JSON.stringify({ type: 'xuzuo-commerce-image' })), 'application/json'), options)).rejects.toThrow('自包含');
    await expect(validate(file(Buffer.from(JSON.stringify({ type: 'xuzuo-bead-pattern', nested: { credentials: 'do-not-export' } })), 'application/json'), options)).rejects.toThrow('内部');
    await expect(validate(file(Buffer.from('模型返回原稿'), 'text/plain'), options)).rejects.toThrow('正式');
  });
  it('实际Word/PPT/Excel导出均通过，换错Office类型、缺少类型声明、非法XML及宏组件均拒绝', async () => {
    const f = await fixture(); closings.push(async () => { await f.engine.shutdown(); await Promise.all([f.editorStore.drain(), f.spreadsheetStore.drain(), f.artifactStore.drain()]); const directory = await fs.realpath(f.directory); if (path.dirname(directory) !== await fs.realpath(os.tmpdir()) || !path.basename(directory).startsWith('xuzuo-production-')) throw Error('Unsafe formal fixture cleanup'); await fs.rm(directory, { recursive: true, force: true }); });
    const docs = [word('真实完整Word正文'), { schemaVersion: 1, kind: 'ppt', title: '正式PPT', theme: 'paper', slides: [{ id: 's', title: '真实结论', body: '完整说明', notes: '讲解', layout: 'title-body', fontSize: 22, align: 'left' }] }, { schemaVersion: 1, kind: 'excel', title: '正式工作簿', sheets: [{ id: 'sheet', name: '表1', rowCount: 2, columnCount: 2, cells: { A1: { value: '金额' }, B1: { value: 10 } } }] }];
    let docx;
    for (const document of docs) { const projectId = 'formal-' + document.kind; await f.workspaceStorage.ensureProject({ projectId, workspaceId: 'production-workspace', name: projectId }); const result = await (document.kind === 'excel' ? f.spreadsheetStore : f.editorStore).export({ projectId, expectedRevision: 0, document }); const artifact = result.artifacts.find(row => row.kind === 'office'), actual = await f.artifactStore.read(artifact.id); await expect(validate(actual, options)).resolves.toBeUndefined(); if (document.kind === 'word') docx = actual; }
    await expect(validate({ ...docx, mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }, options)).rejects.toThrow('类型');
    const missing = await JSZip.loadAsync(docx.buffer); missing.remove('[Content_Types].xml'); await expect(validate({ ...docx, buffer: await missing.generateAsync({ type: 'nodebuffer' }) }, options)).rejects.toThrow('缺少');
    const malformed = await JSZip.loadAsync(docx.buffer); malformed.file('word/document.xml', 'this is not XML'); await expect(validate({ ...docx, buffer: await malformed.generateAsync({ type: 'nodebuffer' }) }, options)).rejects.toThrow('XML');
    const macro = await JSZip.loadAsync(docx.buffer); macro.file('word/vbaProject.bin', Buffer.from('active')); await expect(validate({ ...docx, buffer: await macro.generateAsync({ type: 'nodebuffer' }) }, options)).rejects.toThrow('活动组件');
  });
  it('正式套件支持图片、子目录和README授权，拒绝内部目录、原稿、程序和过深嵌套', async () => {
    await expect(validate(file(await zip({ '图纸/preview.png': png(), 'README.txt': '真实内容说明', 'LICENSE.md': '授权范围' }), 'application/zip'), options)).resolves.toBeUndefined();
    for (const entries of [{ '.xuzuo/internal.png': png() }, { 'prompt.txt': '内部提示词' }, { 'script.exe': 'program' }]) await expect(validate(file(await zip(entries), 'application/zip'), options)).rejects.toThrow();
    let nested = await zip({ 'preview.png': png() }); for (let i = 0; i < 3; i++) nested = await zip({ 'nested.zip': nested }); await expect(validate(file(nested, 'application/zip'), options)).rejects.toThrow('套嵌');
  });
  it('先于JSZip解包拒绝穿越、大小写重复、超量条目和损坏CRC', async () => {
    for (const entries of [{ '../outside.png': png() }, { 'A.png': png(), 'a.png': png() }, Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`${index}.png`, png()]))]) await expect(validate(file(await zip(entries), 'application/zip'), options)).rejects.toThrow();
    const damaged = await zip({ 'README.txt': 'a-real-unique-note' }), at = damaged.indexOf(Buffer.from('a-real-unique-note')); expect(at).toBeGreaterThan(0); damaged[at] ^= 1; await expect(validate(file(damaged, 'application/zip'), options)).rejects.toThrow('校验');
  });
  it('展开内容受累计预算控制，超限后明确停止而非信任压缩大小', async () => {
    const archive = await JSZip.loadAsync(await zip({ 'README.txt': '1234567890' })); await expect(boundedEntry(archive.file('README.txt'), 9)).rejects.toThrow('100MB'); await expect(validate(file(await zip({ 'README.txt': '1234567890', 'LICENSE.txt': '授权' }), 'application/zip'), { ...options, budget: { remaining: 11 } })).rejects.toThrow('100MB');
  });
  it('Native图层登记必须包含JSON加PNG，正式客户采用才排除内部JSON', async () => {
    const f = await fixture(), compositor = require('../../electron/commerce-compositor.cjs'), tasks = { 'commerce-preview': compositor.previewCommerceRaster, 'commerce-compose': compositor.composeCommerceImage };
    let captured; const commerce = require('../../electron/commerce-images.cjs').createCommerceImages({ workspaceStorage: f.workspaceStorage, artifactStore: f.artifactStore, cpuTasks: { run: (task, input) => tasks[task](input, dependencies) }, onExport: async input => { captured = input; return f.engine.recordLocalExport({ projectId: input.projectId, workspaceId: 'production-workspace', name: input.document.title, kind: 'image', artifacts: input.artifacts, commerceExport: input.commerceExport }); } });
    closings.push(async () => { await commerce.shutdown(); await f.engine.shutdown(); await Promise.all([f.editorStore.drain(), f.spreadsheetStore.drain(), f.artifactStore.drain()]); const directory = await fs.realpath(f.directory); if (path.dirname(directory) !== await fs.realpath(os.tmpdir()) || !path.basename(directory).startsWith('xuzuo-production-')) throw Error('Unsafe proof fixture cleanup'); await fs.rm(directory, { recursive: true, force: true }); });
    await f.workspaceStorage.ensureProject({ projectId: 'native-commerce', workspaceId: 'production-workspace', name: '实际图层登记' }); const original = await f.artifactStore.write({ projectId: 'native-commerce', name: '原图.png', mimeType: 'image/png', buffer: png() });
    const output = await commerce.compose({ projectId: 'native-commerce', sourceArtifactId: original.id, title: '独立本地商品图', sizes: [{ width: 64, height: 96, label: '实际尺寸' }] }), snapshot = await f.engine.snapshot(); expect(output.artifacts.map(row => row.mimeType)).toEqual(['application/json', 'image/png']); expect(snapshot.runs[0].status).toBe('complete'); expect(snapshot.runs[0].localImageProof.kind).toBe('commerce'); expect(snapshot.ledger).toEqual([]);
    const formal = output.artifacts.filter(row => row.mimeType === 'image/png'); await expect(validate(await f.artifactStore.read(formal[0].id), options)).resolves.toBeUndefined(); await expect(validate(await f.artifactStore.read(output.artifacts[0].id), options)).rejects.toThrow('自包含');
    await expect(require('../../electron/local-image-proof.cjs').createLocalImageProof({ artifactStore: f.artifactStore }).validate({ projectId: captured.projectId, runId: captured.runId, artifacts: formal, commerceExport: captured.commerceExport })).rejects.toThrow('缺少对应的可编辑');
  });
});
