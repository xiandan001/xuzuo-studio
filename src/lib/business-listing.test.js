import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url), { fixture, dependencies } = require('./production-test-fixtures.cjs'), { PNG } = dependencies('pngjs'), JSZip = dependencies('jszip');
const { createBusinessListing, createListingZip } = require('../../electron/business-listing.cjs'), { createCommerceImages } = require('../../electron/commerce-images.cjs'), compositor = require('../../electron/commerce-compositor.cjs');
const closings = []; afterEach(async () => { for (const close of closings.splice(0)) await close(); });
function png(color = [200, 60, 10, 255]) { const bitmap = new PNG({ width: 8, height: 8 }); for (let at = 0; at < bitmap.data.length; at += 4) bitmap.data.set(color, at); return PNG.sync.write(bitmap); }
function pdf() { return Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n'); }
async function setup() {
  const f = await fixture(); for (const id of ['listing-root', 'foreign-project']) await f.workspaceStorage.ensureProject({ projectId: id, workspaceId: 'production-workspace', name: id });
  const taskFunctions = { 'commerce-preview': compositor.previewCommerceRaster, 'commerce-alpha': compositor.applyCommerceAlpha, 'commerce-protect': compositor.protectCommercePixels, 'commerce-compose': compositor.composeCommerceImage };
  const cpuTasks = { async run(task, input, { signal } = {}) { if (signal?.aborted) throw Object.assign(Error('cancelled'), { name: 'AbortError' }); return taskFunctions[task](input, dependencies); } };
  const captions = [], commerce = createCommerceImages({ workspaceStorage: f.workspaceStorage, artifactStore: f.artifactStore, cpuTasks, renderTextLayer: async layer => { captions.push(layer.text); const bitmap = new PNG({ width: Math.ceil(layer.width), height: Math.ceil(layer.height) }); for (let at = 0; at < bitmap.data.length; at += 4) bitmap.data.set([0, 0, 0, 64], at); return PNG.sync.write(bitmap); }, onExport: async () => {} });
  const source = await f.artifactStore.write({ projectId: 'listing-root', name: '自己导入的完成作品.png', mimeType: 'image/png', buffer: png() }), state = { workspaceId: 'production-workspace', products: [], orders: [{ id: 'order', name: '数字作品', recipe: 'digital', sourceProjectId: 'listing-root', projectIds: ['listing-root'], productIds: [], referenceArtifactIds: [], outputIds: [source.id], factsRevision: 1, tasks: [], status: 'review' }] };
  const businessStore = { snapshot: async () => structuredClone(state) }, listing = createBusinessListing({ businessStore, workspaceStorage: f.workspaceStorage, artifactStore: f.artifactStore, commerceImages: commerce, loadModule: dependencies });
  closings.push(async () => { await listing.shutdown(); await commerce.shutdown(); await f.engine.shutdown(); await f.editorStore.drain(); await f.spreadsheetStore.drain(); await f.artifactStore.drain(); const temporary = await fs.realpath(os.tmpdir()), target = await fs.realpath(f.directory); if (path.dirname(target) !== temporary || !path.basename(target).startsWith('xuzuo-production-') || (await fs.lstat(target)).isSymbolicLink()) throw Error('Unsafe listing fixture cleanup'); await fs.rm(target, { recursive: true, force: true }); });
  const input = () => ({ workspaceId: 'production-workspace', orderId: 'order', projectId: 'listing-root', artifactIds: [source.id], title: '原创图纸', description: '真实描述', instructions: '按正式文件说明使用', licence: '本人原创，个人使用授权', watermark: '授权前仅供预览' });
  return { ...f, commerce, listing, state, source, input, captions };
}
describe('数字商品真实上架包与正式文件隔离', () => {
  it('自选已导入成品允许上架，真实ZIP分formal与带水印预览且不改原图', async () => {
    const f = await setup(), original = (await f.artifactStore.read(f.source.id)).buffer, result = await f.listing.export(f.input());
    expect(result.formalArtifactIds).toEqual([f.source.id]); expect(result.previewArtifactIds).toHaveLength(2); expect(f.captions).toContain('授权前仅供预览');
    const archive = result.artifacts.find(file => file.mimeType === 'application/zip'), zip = await JSZip.loadAsync((await f.artifactStore.read(archive.id)).buffer), files = Object.keys(zip.files).filter(name => !zip.files[name].dir);
    expect(files.filter(name => name.startsWith('files/'))).toHaveLength(1); expect(files.filter(name => name.startsWith('previews/'))).toHaveLength(2);
    expect((await zip.file(files.find(name => name.startsWith('files/'))).async('nodebuffer')).equals(original)).toBe(true);
    expect((await f.artifactStore.read(f.source.id)).buffer.equals(original)).toBe(true); expect(files.some(name => /\.json$|原图|Key|ledger|prompt/i.test(name))).toBe(false); expect(await zip.file('README-上架说明.txt').async('string')).toContain('像素 8×8'); expect(f.calls).toHaveLength(0);
  });
  it('仅Office/PDF正式资料也能生成说明和完整ZIP，不虚构图像尺寸', async () => {
    const f = await setup(), file = await f.artifactStore.write({ projectId: 'listing-root', name: '真实说明.pdf', mimeType: 'application/pdf', buffer: pdf() });
    const result = await f.listing.export({ ...f.input(), artifactIds: [file.id] }); expect(result.previewArtifactIds).toEqual([]); expect(f.captions).toEqual([]);
    const archive = result.artifacts.find(file => file.mimeType === 'application/zip'), zip = await JSZip.loadAsync((await f.artifactStore.read(archive.id)).buffer), readme = await zip.file('README-上架说明.txt').async('string'); expect(readme).toContain('application/pdf'); expect(readme).not.toContain('像素 8×8');
  });
  it('拒绝本单商品原始参考、内部蒙版、非关联项目与错误工作区', async () => {
    const f = await setup(); f.state.products = [{ id: 'product', referenceArtifactIds: [f.source.id] }]; f.state.orders[0].productIds = ['product']; await expect(f.listing.export(f.input())).rejects.toThrow('原始参考');
    f.state.orders[0].productIds = []; f.state.orders[0].tasks = [{ operation: 'cutout', artifactIds: [f.source.id] }]; await expect(f.listing.export(f.input())).rejects.toThrow('内部蒙版');
    f.state.orders[0].tasks = []; const foreign = await f.artifactStore.write({ projectId: 'foreign-project', name: '其它项目.png', mimeType: 'image/png', buffer: png() }); await expect(f.listing.export({ ...f.input(), artifactIds: [foreign.id] })).rejects.toThrow('关联项目');
    await expect(f.listing.export({ ...f.input(), workspaceId: 'wrong-workspace' })).rejects.toThrow();
  });
  it('内部图层快照、模型文字结果不能塞入正式客户文件', async () => {
    const f = await setup(), file = await f.artifactStore.write({ projectId: 'listing-root', name: '内部图层.json', mimeType: 'application/json', text: JSON.stringify({ type: 'xuzuo-commerce-image', secret: 'fixture-never-real' }) });
    await expect(f.listing.export({ ...f.input(), artifactIds: [file.id] })).rejects.toThrow('内部');
    const text = await f.artifactStore.write({ projectId: 'listing-root', name: '原稿.txt', mimeType: 'text/plain', text: '模型原稿' }); await expect(f.listing.export({ ...f.input(), artifactIds: [text.id] })).rejects.toThrow('正式');
  });
  it('第二份样张失败仍保留第一份实际文件、正式源与费用', async () => {
    const f = await setup(), original = f.commerce.compose; let count = 0; f.commerce.compose = input => ++count === 2 ? Promise.reject(Error('controlled local failure')) : original(input);
    let retained; try { await f.listing.export(f.input()); } catch (error) { retained = error.artifacts; }
    expect(retained).toHaveLength(1); expect(PNG.sync.read((await f.artifactStore.read(retained[0].id)).buffer).width).toBe(1280); expect((await f.artifactStore.read(f.source.id)).buffer.equals(png())).toBe(true); expect(f.calls).toHaveLength(0);
  });
  it('正式拼豆套件ZIP内PNG可直接生成上架样张，正式ZIP原字节不改', async () => {
    const f = await setup(), zip = new JSZip(); zip.file('预览.png', png()); zip.file('README.txt', '真实套件说明'); zip.file('LICENSE.txt', '本人原创'); const bytes = await zip.generateAsync({ type: 'nodebuffer' }), file = await f.artifactStore.write({ projectId: 'listing-root', name: '现成套件.zip', mimeType: 'application/zip', buffer: bytes });
    const result = await f.listing.export({ ...f.input(), artifactIds: [file.id] }); expect(result.previewArtifactIds).toHaveLength(2); const output = await JSZip.loadAsync((await f.artifactStore.read(result.artifacts.find(file => file.mimeType === 'application/zip').id)).buffer), formal = Object.keys(output.files).find(name => name.startsWith('files/') && !output.files[name].dir); expect((await output.file(formal).async('nodebuffer')).equals(bytes)).toBe(true);
  });
  it('ZIP拒路径穿越、大小超限和大小写重复，不执行外部程序', async () => {
    await expect(createListingZip({ files: [{ name: 'files/../secret.txt', buffer: Buffer.from('x') }] }, dependencies)).rejects.toThrow();
    await expect(createListingZip({ files: [{ name: 'files/a.png', buffer: Buffer.from('a') }, { name: 'files/A.png', buffer: Buffer.from('b') }] }, dependencies)).rejects.toThrow();
  });
});
