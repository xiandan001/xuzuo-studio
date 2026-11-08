import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url), { fixture, dependencies } = require('./production-test-fixtures.cjs'), { PNG } = dependencies('pngjs');
const { composeCommerceImage, applyCommerceAlpha, protectCommercePixels, previewCommerceRaster, rgbaRaster } = require('../../electron/commerce-compositor.cjs');
const { createCommerceImages } = require('../../electron/commerce-images.cjs'), { createLocalImageProof } = require('../../electron/local-image-proof.cjs');
const { commerceTextHtml, createCommerceTextRenderer } = require('../../electron/commerce-text-renderer.cjs'), { commerceDocumentHash } = require('../../electron/commerce-image-document.cjs');
const backup = require('../../electron/commerce-image-backup.cjs');
const closing = [];
afterEach(async () => { for (const close of closing.splice(0)) await close(); });
function png(width = 8, height = 8, color = [20, 80, 180, 255]) { const image = new PNG({ width, height }); for (let index = 0; index < image.data.length; index += 4) image.data.set(typeof color === 'function' ? color(index / 4) : color, index); return PNG.sync.write(image); }
const decode = buffer => PNG.sync.read(Buffer.from(buffer));
const layer = (source, extra = {}) => ({ source, x: 0, y: 0, width: 8, height: 8, visible: true, opacity: 1, ...extra });
function documentFor(read) { return { type: 'xuzuo-commerce-image', version: 1, id: read.documentId, projectId: read.projectId, sourceArtifactId: read.source.id, sourceSha256: read.source.sha256, revision: 0, title: '商品图层', width: 8, height: 8, background: '#ffffff', layers: [{ id: 'product', type: 'image', role: 'product', artifactId: read.source.id, name: '原图商品', x: 0, y: 0, width: 8, height: 8, visible: true, locked: false, opacity: 1 }], updatedAt: '' }; }
async function setup() {
  const f = await fixture(); await f.workspaceStorage.ensureProject({ projectId: 'commerce-project', workspaceId: 'production-workspace', name: '商品测试' }); await f.workspaceStorage.ensureProject({ projectId: 'other-project', workspaceId: 'production-workspace', name: '其它项目' });
  const tasks = [], exports = [], source = await f.artifactStore.write({ projectId: 'commerce-project', name: '真实原图.png', mimeType: 'image/png', buffer: png() });
  const functions = { 'commerce-preview': previewCommerceRaster, 'commerce-alpha': applyCommerceAlpha, 'commerce-protect': protectCommercePixels, 'commerce-compose': composeCommerceImage };
  let intercept;
  const cpuTasks = { async run(kind, input, { signal } = {}) { tasks.push(kind); if (signal?.aborted) throw Object.assign(Error('cancelled'), { name: 'AbortError' }); if (intercept) await intercept(kind); if (signal?.aborted) throw Object.assign(Error('cancelled'), { name: 'AbortError' }); return functions[kind](input, dependencies); } };
  const proof = createLocalImageProof({ artifactStore: f.artifactStore });
  const service = createCommerceImages({ workspaceStorage: f.workspaceStorage, artifactStore: f.artifactStore, cpuTasks, renderTextLayer: async item => png(Math.ceil(item.width), Math.ceil(item.height), [1, 2, 3, 128]), onExport: async value => { const validated = await proof.validate(value); exports.push({ ...value, validated }); } });
  closing.push(async () => { await service.shutdown(); await f.engine.shutdown(); await f.editorStore.drain(); await f.spreadsheetStore.drain(); await f.artifactStore.drain(); const temporary = await fs.realpath(os.tmpdir()), target = await fs.realpath(f.directory); if (path.dirname(target) !== temporary || !path.basename(target).startsWith('xuzuo-production-') || (await fs.lstat(target)).isSymbolicLink()) throw Error('Unsafe fixture cleanup'); await fs.rm(target, { recursive: true, force: true }); });
  return { ...f, source, service, proof, tasks, exports, setIntercept: hook => { intercept = hook; } };
}
describe('商品原始像素、透明蒙版与独立图层真实PNG', () => {
  it('只采AI蒙版Alpha，所有原RGB（含透明像素底色）保持不变', () => {
    const source = png(8, 8, index => [index, 255 - index, index * 3, 255]), mask = png(8, 8, index => [255, 0, 255, index < 32 ? 0 : 128]);
    const result = decode(applyCommerceAlpha({ source: { buffer: source }, alpha: { buffer: mask } }, dependencies).buffer), original = decode(source);
    for (let at = 0; at < result.data.length; at += 4) { expect([...result.data.subarray(at, at + 3)]).toEqual([...original.data.subarray(at, at + 3)]); expect(result.data[at + 3]).toBe(at < 128 ? 0 : 128); }
  });
  it('拒绝全不透明或全空结果，不假称已经完成抠图', () => {
    for (const alpha of [0, 255]) expect(() => applyCommerceAlpha({ source: { buffer: png() }, alpha: { buffer: png(8, 8, [255, 255, 255, alpha]) } }, dependencies)).toThrow('蒙版');
  });
  it('保护区以外RGBA逐字节相同，涂选区域才采用编辑像素', () => {
    const source = png(8, 8, index => [index, 80, 180, index < 8 ? 0 : 255]), edited = png(8, 8, [255, 33, 14, 255]), mask = png(8, 8, index => [0, 0, 0, index % 8 < 4 ? 0 : 255]);
    const result = protectCommercePixels({ source: { buffer: source }, edited: { buffer: edited }, mask: { buffer: mask } }, dependencies), output = decode(result.buffer), before = decode(source);
    expect(result.protectedPixels).toBe(32); for (let pixel = 0; pixel < 64; pixel++) expect([...output.data.subarray(pixel * 4, pixel * 4 + 4)]).toEqual(pixel % 8 < 4 ? [...before.data.subarray(pixel * 4, pixel * 4 + 4)] : [255, 33, 14, 255]);
  });
  it('按层级、位置、显示和透明度合成，缩放导出不拉伸', () => {
    const output = composeCommerceImage({ width: 8, height: 8, background: '#FFFFFF', layers: [layer({ buffer: png(8, 8, [0, 0, 255, 255]) }), layer({ buffer: png(8, 8, [255, 0, 0, 255]) }, { x: 4, width: 4, opacity: .5 }), layer({ buffer: png(8, 8, [0, 255, 0, 255]) }, { visible: false })], target: { width: 16, height: 24 } }, dependencies), bitmap = decode(output.buffer);
    expect([bitmap.width, bitmap.height]).toEqual([16, 24]); expect([...bitmap.data.subarray(0, 4)]).toEqual([255, 255, 255, 255]); expect([...bitmap.data.subarray((10 * 16 + 2) * 4, (10 * 16 + 2) * 4 + 4)]).toEqual([0, 0, 255, 255]); expect([...bitmap.data.subarray((10 * 16 + 14) * 4, (10 * 16 + 14) * 4 + 4)]).toEqual([128, 0, 128, 255]);
  });
  it('透明素材可保留Alpha导出，不强制烘成白底', () => {
    const source = png(8, 8, index => [40, 80, 180, index < 32 ? 0 : 128]), output = composeCommerceImage({ width: 8, height: 8, background: 'transparent', layers: [layer({ buffer: source })] }, dependencies), pixels = decode(output.buffer).data;
    expect(pixels[3]).toBe(0); expect([...pixels.subarray(128, 132)]).toEqual([40, 80, 180, 128]);
  });
  it('在后台按EXIF方向转换真实BGRA，不走1M采样函数', () => {
    const bitmap = Buffer.from([0, 0, 255, 255, 0, 255, 0, 255, 255, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 0, 255]);
    const output = rgbaRaster({ bitmap, width: 2, height: 3, orientation: 6 }); expect([output.width, output.height]).toEqual([3, 2]); expect([...output.pixels.subarray(0, 4)]).toEqual([0, 0, 0, 255]); expect([...output.pixels.subarray(8, 12)]).toEqual([255, 0, 0, 255]);
  });
  it('大画布在解码前拒绝，文字HTML不解释标签或外部资源', () => {
    expect(() => composeCommerceImage({ width: 8192, height: 8192, layers: [] }, () => { throw Error('must not decode'); })).toThrow('1600万');
    const html = commerceTextHtml({ text: '<script>恶意</script>&报价', fontFamily: 'Arial', fontSize: 30, fontWeight: 'bold', align: 'center', color: '#123456' }); expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>');
  });
  it('production CPU Worker实际执行抠图、图层合成和局部保护', async () => {
    const tasks = require('../../electron/cpu-tasks.cjs').createCpuTasks({ timeoutMs: 10000 }), source = png(), alpha = png(8, 8, index => [255, 0, 255, index % 8 < 4 ? 0 : 255]);
    const matte = await tasks.run('commerce-alpha', { source: { buffer: source }, alpha: { buffer: alpha } }); expect(decode(matte.buffer).data[3]).toBe(0);
    const output = await tasks.run('commerce-compose', { width: 8, height: 8, background: '#FFFFFF', layers: [layer({ buffer: matte.buffer })] }); expect(decode(output.buffer).width).toBe(8);
    const protectedResult = await tasks.run('commerce-protect', { source: { buffer: source }, edited: { buffer: png(8, 8, [255, 0, 0, 255]) }, mask: { buffer: alpha } }); expect([...decode(protectedResult.buffer).data.subarray(0, 4)]).toEqual([20, 80, 180, 255]); await tasks.drain();
  });
  it('文字捕获使用精确内容尺寸、透明无框及限制联网，关闭能中断未完成捕获', async () => {
    const configurations = [], windows = [], html = [];
    let hang = false;
    class Window {
      destroyed = false;
      constructor(options) { configurations.push(options); windows.push(this); }
      isDestroyed() { return this.destroyed; }
      destroy() { this.destroyed = true; }
      webContents = { setWindowOpenHandler() {}, on() {}, session: { webRequest: { onBeforeRequest() {} } }, loadURL: async url => { html.push(decodeURIComponent(url)); if (hang) await new Promise(() => {}); }, executeJavaScript: async () => ({ width: 100, height: 50, clientWidth: 100, clientHeight: 50, ratio: 1 }), capturePage: async () => ({ resize: () => ({ toPNG: () => png() }) }) };
    }
    const renderer = createCommerceTextRenderer({ BrowserWindow: Window }), text = { width: 100, height: 50, name: '售价', text: '<script>129元</script>', fontFamily: 'Arial', fontSize: 20, fontWeight: 'bold', color: '#000000', align: 'left' };
    expect((await renderer.render(text)).length).toBeGreaterThan(0); expect(configurations[0]).toMatchObject({ show: false, frame: false, useContentSize: true, transparent: true, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } }); expect(html[0]).toContain("script-src 'none'"); expect(html[0]).toContain('&lt;script&gt;'); expect(windows[0].destroyed).toBe(true);
    hang = true; const pending = renderer.render(text); const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' }); await new Promise(resolve => setTimeout(resolve, 5)); await renderer.shutdown(); await rejected; expect(windows.every(window => window.destroyed)).toBe(true);
  });
});
describe('商品图层工程CAS、真实成果、回层与恢复', () => {
  it('首次保存、并发CAS和来源隔离使用项目真实文件', async () => {
    const f = await setup(), initial = await f.service.read({ projectId: 'commerce-project', sourceArtifactId: f.source.id }), document = documentFor(initial);
    const saved = await f.service.save({ projectId: 'commerce-project', sourceArtifactId: f.source.id, expectedRevision: 0, document }); expect(saved.revision).toBe(1);
    const competing = await Promise.allSettled([1, 2].map(number => f.service.save({ projectId: 'commerce-project', sourceArtifactId: f.source.id, expectedRevision: 1, document: { ...saved, title: `版本${number}` } }))); expect(competing.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    await expect(f.service.read({ projectId: 'other-project', sourceArtifactId: f.source.id })).rejects.toThrow('本项目');
    expect((await f.service.history({ projectId: 'commerce-project', sourceArtifactId: f.source.id })).length).toBe(2);
  });
  it('反复改价保存不重复读取解码原大图，导出仍重新验证源', async () => {
    const f = await setup(), initial = await f.service.read({ projectId: 'commerce-project', sourceArtifactId: f.source.id }), originalRead = f.artifactStore.read; let reads = 0;
    f.artifactStore.read = (...input) => { reads++; return originalRead(...input); };
    const saved = await f.service.save({ projectId: 'commerce-project', sourceArtifactId: f.source.id, expectedRevision: 0, document: documentFor(initial) });
    await f.service.save({ projectId: 'commerce-project', sourceArtifactId: f.source.id, expectedRevision: saved.revision, document: { ...saved, title: '准确改价' } }); expect(reads).toBe(0);
    await f.service.render({ projectId: 'commerce-project', sourceArtifactId: f.source.id, expectedRevision: saved.revision + 1 }); expect(reads).toBeGreaterThan(0);
  });
  it('输出真正PNG+JSON并登记真实来源，成品重新打开恢复原文字Logo层', async () => {
    const f = await setup(), initial = await f.service.read({ projectId: 'commerce-project', sourceArtifactId: f.source.id }), document = documentFor(initial);
    document.layers.push({ id: 'price', name: '售价', type: 'text', text: '售价129元', fontSize: 6, fontFamily: 'Microsoft YaHei', fontWeight: 'bold', color: '#000000', align: 'left', x: 0, y: 0, width: 8, height: 8, visible: true, locked: false, opacity: 1 });
    const saved = await f.service.save({ projectId: 'commerce-project', sourceArtifactId: f.source.id, expectedRevision: 0, document }), exported = await f.service.render({ projectId: 'commerce-project', sourceArtifactId: f.source.id, expectedRevision: saved.revision, sizes: [{ width: 16, height: 24, label: '详情' }] });
    expect(f.exports[0].validated.proof.kind).toBe('commerce'); const image = exported.artifacts.find(file => file.mimeType === 'image/png'), actual = decode((await f.artifactStore.read(image.id)).buffer); expect([actual.width, actual.height]).toEqual([16, 24]);
    const reopened = await f.service.read({ projectId: 'commerce-project', sourceArtifactId: image.id }); expect(reopened.sourceArtifactId).toBe(f.source.id); expect(reopened.document.layers.find(layer => layer.id === 'price').text).toBe('售价129元'); expect(reopened.document.revision).toBe(0); expect(reopened.documentId).not.toBe(saved.id);
    const branch = await f.service.save({ projectId: 'commerce-project', sourceArtifactId: f.source.id, documentId: reopened.documentId, expectedRevision: 0, document: { ...reopened.document, layers: reopened.document.layers.map(layer => layer.type === 'text' ? { ...layer, text: '售价99元' } : layer) } });
    expect((await f.service.read({ projectId: 'commerce-project', sourceArtifactId: image.id })).document.layers.find(layer => layer.id === 'price').text).toBe('售价99元'); expect((await f.service.read({ projectId: 'commerce-project', sourceArtifactId: image.id })).workingDiffersFromExport).toBe(true);
    const frozen = await f.service.read({ projectId: 'commerce-project', sourceArtifactId: image.id, fromSnapshot: true }); expect(frozen.document.layers.find(layer => layer.id === 'price').text).toBe('售价129元'); expect(frozen.documentId).not.toBe(reopened.documentId);
    expect((await f.service.read({ projectId: 'commerce-project', sourceArtifactId: f.source.id })).document.layers.find(layer => layer.id === 'price').text).toBe('售价129元'); expect(branch.revision).toBe(1); expect(f.calls).toHaveLength(0);
  });
  it('自动流水线compose保留原图与可回编辑工程，不覆盖当前人工工程', async () => {
    const f = await setup(), original = await f.artifactStore.read(f.source.id), initial = await f.service.read({ projectId: 'commerce-project', sourceArtifactId: f.source.id }); await f.service.save({ projectId: 'commerce-project', sourceArtifactId: f.source.id, expectedRevision: 0, document: { ...documentFor(initial), title: '人工编辑' } });
    const mask = await f.artifactStore.write({ projectId: 'commerce-project', name: 'mask.png', mimeType: 'image/png', buffer: png(8, 8, index => [255, 0, 255, index < 32 ? 0 : 255]) });
    const result = await f.service.compose({ projectId: 'commerce-project', sourceArtifactId: f.source.id, alphaArtifactId: mask.id, text: '明确售价', sizes: [{ width: 256, height: 256, label: '主图' }] });
    expect(result.artifacts.filter(file => file.mimeType === 'image/png')).toHaveLength(1); expect((await f.service.read({ projectId: 'commerce-project', sourceArtifactId: f.source.id })).document.title).toBe('人工编辑'); expect((await f.artifactStore.read(f.source.id)).buffer.equals(original.buffer)).toBe(true); expect(f.calls).toHaveLength(0);
  });
  it('取消排队合成后不写迟到成品，费用与原文件保留', async () => {
    const f = await setup(), initial = await f.service.read({ projectId: 'commerce-project', sourceArtifactId: f.source.id }); await f.service.save({ projectId: 'commerce-project', sourceArtifactId: f.source.id, expectedRevision: 0, document: documentFor(initial) });
    let release; const gate = new Promise(resolve => { release = resolve; }); f.setIntercept(async kind => { if (kind === 'commerce-compose') await gate; });
    const render = f.service.render({ projectId: 'commerce-project', sourceArtifactId: f.source.id, expectedRevision: 1 }); await new Promise(resolve => setTimeout(resolve, 30)); const cancel = f.service.cancel({ projectId: 'commerce-project' }); release(); await expect(render).rejects.toMatchObject({ name: 'AbortError' }); await cancel; expect(f.exports).toHaveLength(0); expect(f.calls).toHaveLength(0);
  });
  it('备份重映射所有图层引用、保存快照hash和回编辑路径', async () => {
    const f = await setup(), read = await f.service.read({ projectId: 'commerce-project', sourceArtifactId: f.source.id }), document = documentFor(read), ids = new Map([['commerce-project', 'restored-project'], [f.source.id, 'restored-image'], [document.id, 'restored-document'], ['product', 'restored-layer']]);
    const record = { version: 1, projectId: 'commerce-project', sourceArtifactId: f.source.id, documentId: document.id, revision: 1, savedAt: '', document: { ...document, revision: 1 } }, digest = value => require('node:crypto').createHash('sha256').update(JSON.stringify(value)).digest('hex'), envelope = { version: 1, projectId: 'commerce-project', record, hash: digest(record) };
    const filename = `project/.xuzuo/commerce-images/${f.source.id}/${document.id}/commerce-image-revisions-v1/revision-1-${envelope.hash}.json`, remapped = backup.remapCommerceImage(envelope, ids, filename), renamed = backup.renamedCommercePath(filename, ids, remapped);
    expect(remapped.record.document.layers[0].artifactId).toBe('restored-image'); expect(remapped.record.document.layers[0].id).toBe('restored-layer'); expect(remapped.hash).toBe(digest(remapped.record)); expect(renamed).toContain('/restored-image/restored-document/'); expect(renamed).toContain(remapped.hash); expect(commerceDocumentHash(remapped.record.document)).not.toBe(commerceDocumentHash(record.document));
  });
});
