import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url), { fixture, dependencies } = require('./production-test-fixtures.cjs'), { PNG } = dependencies('pngjs');
const { createCommerceImages } = require('../../electron/commerce-images.cjs'), { previewCommerceRaster, composeCommerceImage } = require('../../electron/commerce-compositor.cjs');
const owned = [], sha = value => createHash('sha256').update(value).digest('hex');
afterEach(async () => { for (const item of owned.splice(0)) { await item.service.shutdown(); await item.f.engine.shutdown(); await item.f.artifactStore.drain(); const directory = await fs.realpath(item.f.directory); if (path.dirname(directory) !== await fs.realpath(os.tmpdir()) || !path.basename(directory).startsWith('xuzuo-production-')) throw Error('Unowned fixture directory'); await fs.rm(directory, { recursive: true, force: true }); } });
function image(width = 3840, height = 2160) { const png = new PNG({ width, height }); for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) png.data.set([x % 256, y % 256, (x ^ y) % 256, 255], (y * width + x) * 4); return PNG.sync.write(png); }
async function setup(buffer = image()) {
  const f = await fixture(); await f.workspaceStorage.ensureProject({ projectId: 'clear-preview', workspaceId: 'production-workspace', name: '清晰预览' });
  const artifact = await f.artifactStore.write({ projectId: 'clear-preview', name: '原图4K.png', mimeType: 'image/png', buffer }); let intercept;
  const service = createCommerceImages({ workspaceStorage: f.workspaceStorage, artifactStore: f.artifactStore, cpuTasks: { async run(kind, input, { signal } = {}) { if (intercept) await intercept(kind, input); if (signal?.aborted) throw Object.assign(Error('cancelled'), { name: 'AbortError' }); return kind === 'commerce-preview' ? previewCommerceRaster(input, dependencies) : composeCommerceImage(input, dependencies); } }, onExport: async () => {} });
  owned.push({ f, service }); return { f, service, artifact, buffer, intercept: fn => { intercept = fn; } };
}
describe('真实4K原图的只读清晰预览', () => {
  it('只返回视口裁片的原始像素；保存和导出仍读取完整原图且不产生模型费用', async () => {
    const f = await setup(), before = sha(f.buffer), region = { x: .25, y: .25, width: .125, height: .125 };
    const preview = await f.service.preview({ projectId: 'clear-preview', artifactId: f.artifact.id, requestId: 'viewport', maxSide: 2048, region, expectedSha256: before }), decoded = PNG.sync.read(Buffer.from(preview.dataUrl.split(',')[1], 'base64')), source = PNG.sync.read(f.buffer);
    expect(decoded.width).toBe(480); expect(decoded.height).toBe(270); expect(preview.sourceWidth).toBe(3840); expect(preview.sourceHeight).toBe(2160);
    for (const [x, y] of [[0, 0], [100, 80], [479, 269]]) expect([...decoded.data.subarray((y * decoded.width + x) * 4, (y * decoded.width + x) * 4 + 4)]).toEqual([...source.data.subarray(((y + 540) * source.width + x + 960) * 4, ((y + 540) * source.width + x + 960) * 4 + 4)]);
    const read = await f.service.read({ projectId: 'clear-preview', sourceArtifactId: f.artifact.id });
    const document = { type: 'xuzuo-commerce-image', version: 1, id: read.documentId, projectId: 'clear-preview', sourceArtifactId: f.artifact.id, sourceSha256: before, revision: 0, title: '原图', width: 3840, height: 2160, background: '#FFFFFF', layers: [{ id: 'original', name: '原图', type: 'image', role: 'product', artifactId: f.artifact.id, x: 0, y: 0, width: 3840, height: 2160, opacity: 1, visible: true, locked: false }], updatedAt: '' };
    const saved = await f.service.save({ projectId: 'clear-preview', sourceArtifactId: f.artifact.id, documentId: read.documentId, expectedRevision: 0, document });
    const rendered = await f.service.render({ projectId: 'clear-preview', sourceArtifactId: f.artifact.id, documentId: read.documentId, expectedRevision: saved.revision }), output = await f.f.artifactStore.read(rendered.artifacts.find(file => file.mimeType === 'image/png').id), full = PNG.sync.read(output.buffer);
    expect(full.width).toBe(3840); expect(full.height).toBe(2160); expect(full.data.equals(source.data)).toBe(true); expect(sha((await f.f.artifactStore.read(f.artifact.id)).buffer)).toBe(before); expect((await f.f.engine.snapshot()).ledger).toEqual([]);
  });
  it('拒绝越界、非有限坐标、过大档位和错误来源SHA', async () => {
    const f = await setup(image(128, 96)), input = { projectId: 'clear-preview', artifactId: f.artifact.id, requestId: 'viewport', maxSide: 1280, region: { x: 0, y: 0, width: 1, height: 1 } };
    for (const changes of [{ maxSide: 8192 }, { region: { x: 1, y: 0, width: .1, height: 1 } }, { region: { x: NaN, y: 0, width: 1, height: 1 } }, { expectedSha256: 'a'.repeat(64) }, { projectId: 'foreign' }]) await expect(f.service.preview({ ...input, ...changes })).rejects.toThrow();
  });
  it('取消只针对指定预览；迟到的worker不能返回清晰图或写入原图', async () => {
    const f = await setup(image(128, 96)); let enter, release; const entered = new Promise(resolve => { enter = resolve; }), waiting = new Promise(resolve => { release = resolve; });
    f.intercept(async kind => { if (kind === 'commerce-preview') { enter(); await waiting; } });
    const task = f.service.preview({ projectId: 'clear-preview', artifactId: f.artifact.id, requestId: 'cancel-this', maxSide: 1280, region: { x: 0, y: 0, width: 1, height: 1 } }); await entered;
    await f.service.cancelPreview({ projectId: 'clear-preview', requestId: 'other-request' }); const cancelled = f.service.cancelPreview({ projectId: 'clear-preview', requestId: 'cancel-this' }); release();
    await expect(task).rejects.toMatchObject({ name: 'AbortError' }); await cancelled; expect(sha((await f.f.artifactStore.read(f.artifact.id)).buffer)).toBe(sha(f.buffer)); expect((await f.f.engine.snapshot()).ledger).toEqual([]);
  });
});
