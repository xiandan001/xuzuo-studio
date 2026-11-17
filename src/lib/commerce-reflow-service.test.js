import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url), { fixture, dependencies } = require('./production-test-fixtures.cjs'), { PNG } = dependencies('pngjs');
const { createCommerceImages } = require('../../electron/commerce-images.cjs'), { previewCommerceRaster, composeCommerceImage } = require('../../electron/commerce-compositor.cjs');
const roots = [];
function png(width, height, alpha = 255) { const image = new PNG({ width, height }); for (let at = 0; at < image.data.length; at += 4) image.data.set([50, 140, 200, alpha], at); return PNG.sync.write(image); }
async function setup() {
  const f = await fixture(); for (const projectId of ['reflow-project', 'foreign-project']) await f.workspaceStorage.ensureProject({ projectId, workspaceId: 'production-workspace', name: projectId });
  const tasks = [], exports = [], source = await f.artifactStore.write({ projectId: 'reflow-project', name: '主体.png', mimeType: 'image/png', buffer: png(16, 24, 128) });
  const cpuTasks = { async run(kind, input, options) { tasks.push({ kind, priority: options?.priority }); if (options?.signal?.aborted) throw Object.assign(Error('cancelled'), { name: 'AbortError' }); return (kind === 'commerce-preview' ? previewCommerceRaster : composeCommerceImage)(input, dependencies); } };
  const service = createCommerceImages({ workspaceStorage: f.workspaceStorage, artifactStore: f.artifactStore, cpuTasks, renderTextLayer: async layer => png(Math.ceil(layer.width), Math.ceil(layer.height)), onExport: async result => exports.push(result) });
  const opened = await service.read({ projectId: 'reflow-project', sourceArtifactId: source.id }), base = { type: 'xuzuo-commerce-image', version: 1, id: opened.documentId, projectId: 'reflow-project', sourceArtifactId: source.id, sourceSha256: opened.source.sha256, revision: 0, title: '真实图层', width: 400, height: 400, background: 'transparent', updatedAt: '', layers: [{ id: 'product', name: '主体', type: 'image', role: 'product', artifactId: source.id, x: 100, y: 80, width: 160, height: 240, opacity: 1, visible: true, locked: false }, { id: 'text', name: '价格', type: 'text', text: '新价格99元', fontSize: 20, fontFamily: 'Arial', fontWeight: 'normal', color: '#111111', align: 'center', x: 20, y: 350, width: 360, height: 35, opacity: 1, visible: true, locked: false }] };
  const scope = { projectId: 'reflow-project', sourceArtifactId: source.id, documentId: opened.documentId }, saved = await service.save({ ...scope, expectedRevision: 0, document: base });
  roots.push({ ...f, service }); return { ...f, source, service, scope, saved, tasks, exports };
}
afterEach(async () => { for (const f of roots.splice(0)) { await f.service.shutdown(); await f.engine.shutdown(); await Promise.all([f.editorStore.drain(), f.spreadsheetStore.drain(), f.artifactStore.drain()]); const target = await fs.realpath(f.directory); if (path.dirname(target) !== await fs.realpath(os.tmpdir()) || !path.basename(target).startsWith('xuzuo-production-')) throw Error('Unowned fixture'); await fs.rm(target, { recursive: true, force: true }); } });
const sizes = [[160, 160], [120, 160], [128, 160], [90, 160], [160, 90], [144, 96]].map(([width, height], index) => ({ width, height, label: `渠道${index + 1}` }));
describe('多比例预览确认与真实文件/工程导出（文字为明确像素替身）', () => {
  it('预览不写文件，六版逐一确认后生成真实PNG与独立可重开图层；重复确认复用结果', async () => {
    const f = await setup(), original = await f.service.templateSource(f.scope), before = await f.artifactStore.listProject(f.scope.projectId), ledger = (await f.engine.snapshot()).ledger;
    const preview = await f.service.reflowPreview({ ...f.scope, expectedRevision: 1, requestId: 'preview-request', targets: sizes }); expect(preview.targets).toHaveLength(6); expect(await f.artifactStore.listProject(f.scope.projectId)).toEqual(before); expect(f.exports).toHaveLength(0); expect(f.tasks.some(task => task.priority === 'interactive')).toBe(true);
    await expect(f.service.reflowExport({ ...f.scope, expectedRevision: 1, previewId: preview.previewId, approvedTargetIds: preview.targets.slice(0, 5).map(target => target.id) })).rejects.toThrow('全部');
    const input = { ...f.scope, expectedRevision: 1, previewId: preview.previewId, approvedTargetIds: preview.targets.map(target => target.id) }, output = await f.service.reflowExport(input);
    expect(output.variants).toHaveLength(6); expect(f.exports).toHaveLength(6);
    for (const [index, variant] of output.variants.entries()) { const file = output.artifacts.find(file => variant.artifactIds.includes(file.id) && file.mimeType === 'image/png'), bytes = (await f.artifactStore.read(file.id)).buffer, image = PNG.sync.read(bytes); expect([image.width, image.height]).toEqual([sizes[index].width, sizes[index].height]); expect(image.data[3]).toBe(0); const opened = await f.service.read({ projectId: f.scope.projectId, sourceArtifactId: file.id }); expect([opened.document.width, opened.document.height]).toEqual([sizes[index].width, sizes[index].height]); expect(opened.document.id).not.toBe(f.saved.id); expect((await f.service.templateSource({ ...f.scope, documentId: variant.documentId })).id).toBe(variant.documentId); expect(opened.document.layers.some(layer => layer.type === 'text' && layer.text === '新价格99元')).toBe(true); }
    const again = await f.service.reflowExport(input); expect(again.artifacts.map(file => file.id)).toEqual(output.artifacts.map(file => file.id)); expect(f.exports).toHaveLength(6); expect(await f.service.templateSource(f.scope)).toEqual(original); expect((await f.engine.snapshot()).ledger).toEqual(ledger); expect(f.calls).toHaveLength(0);
  }, 15000);
  it('预览后改稿或原图字节改变都会拒绝旧确认，不创建目标文件', async () => {
    const f = await setup(), preview = await f.service.reflowPreview({ ...f.scope, expectedRevision: 1, requestId: 'first-preview', targets: sizes.slice(0, 1) });
    await f.service.save({ ...f.scope, expectedRevision: 1, document: { ...f.saved, title: '新修改' } });
    await expect(f.service.reflowExport({ ...f.scope, expectedRevision: 1, previewId: preview.previewId, approvedTargetIds: preview.targets.map(item => item.id) })).rejects.toThrow(/保存|改变/);
    const fresh = await f.service.reflowPreview({ ...f.scope, expectedRevision: 2, requestId: 'second-preview', targets: sizes.slice(0, 1) }), before = (await f.artifactStore.listProject(f.scope.projectId)).length;
    await fs.writeFile((await f.artifactStore.read(f.source.id)).path, png(16, 24, 200));
    await expect(f.service.reflowExport({ ...f.scope, expectedRevision: 2, previewId: fresh.previewId, approvedTargetIds: fresh.targets.map(item => item.id) })).rejects.toThrow(); expect((await f.artifactStore.listProject(f.scope.projectId)).length).toBe(before); expect(f.exports).toHaveLength(0); expect(f.calls).toHaveLength(0);
  });
  it('不能使用另一个项目的预览确认，也不把无已保存图层的平面图冒充智能排版', async () => {
    const f = await setup(), preview = await f.service.reflowPreview({ ...f.scope, expectedRevision: 1, requestId: 'owned-preview', targets: sizes.slice(0, 1) });
    await expect(f.service.reflowExport({ ...f.scope, projectId: 'foreign-project', expectedRevision: 1, previewId: preview.previewId, approvedTargetIds: preview.targets.map(item => item.id) })).rejects.toThrow();
    const flat = await f.artifactStore.write({ projectId: f.scope.projectId, name: '平面图.png', mimeType: 'image/png', buffer: png(16, 16) }); await expect(f.service.reflowPreview({ projectId: f.scope.projectId, sourceArtifactId: flat.id, expectedRevision: 0, requestId: 'flat-preview', targets: sizes.slice(0, 1) })).rejects.toThrow('真实图层');
    const opened = await f.service.read({ projectId: f.scope.projectId, sourceArtifactId: flat.id }), document = { ...f.saved, id: opened.documentId, sourceArtifactId: flat.id, sourceSha256: opened.source.sha256, revision: 0, layers: [{ ...f.saved.layers[0], artifactId: flat.id }] }; await f.service.save({ projectId: f.scope.projectId, sourceArtifactId: flat.id, documentId: opened.documentId, expectedRevision: 0, document }); await expect(f.service.reflowPreview({ projectId: f.scope.projectId, sourceArtifactId: flat.id, expectedRevision: 1, requestId: 'saved-flat-preview', targets: sizes.slice(0, 1) })).rejects.toThrow('独立'); expect(f.calls).toHaveLength(0);
  });
});
