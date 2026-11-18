import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url), { fixture, dependencies } = require('./production-test-fixtures.cjs'), { PNG } = dependencies('pngjs');
const { createCommerceImages } = require('../../electron/commerce-images.cjs'), { previewCommerceRaster, composeCommerceImage } = require('../../electron/commerce-compositor.cjs');
const { createReflowJobStore } = require('../../electron/commerce-reflow-jobs.cjs');
const roots = [], sha = bytes => createHash('sha256').update(bytes).digest('hex');
function png(width = 16, height = 24) { const image = new PNG({ width, height }); for (let at = 0; at < image.data.length; at += 4) image.data.set([45, 170, 110, 255], at); return PNG.sync.write(image); }
const targets = [{ width: 160, height: 160, label: '正方形' }, { width: 120, height: 160, label: '竖版' }, { width: 160, height: 90, label: '横版' }];
async function setup({ failAt, lostAck = false } = {}) {
  const f = await fixture(); for (const projectId of ['resume-project', 'other-project']) await f.workspaceStorage.ensureProject({ projectId, workspaceId: 'production-workspace', name: projectId });
  const source = await f.artifactStore.write({ projectId: 'resume-project', name: '真实原图.png', mimeType: 'image/png', buffer: png() }), sourceHash = sha((await f.artifactStore.read(source.id)).buffer), services = [], exports = [], stats = { composed: 0, fault: false, ack: false };
  const options = { workspaceStorage: f.workspaceStorage, artifactStore: f.artifactStore, cpuTasks: { async run(task, input, options) {
    if (task === 'commerce-preview') return previewCommerceRaster(input, dependencies);
    if (options?.priority !== 'interactive') { stats.composed++; if (stats.composed === failAt && !stats.fault) { stats.fault = true; throw Error('fixture third local encoding interrupted'); } }
    return composeCommerceImage(input, dependencies);
  } }, renderTextLayer: async layer => png(Math.ceil(layer.width), Math.ceil(layer.height)), onExport: async input => {
    const run = await f.engine.recordLocalExport({ projectId: input.projectId, workspaceId: 'production-workspace', name: input.document.title, kind: 'image', artifacts: input.artifacts, commerceExport: input.commerceExport }); exports.push(run.id);
    if (lostAck && !stats.ack) { stats.ack = true; throw Error('fixture local registration acknowledgement lost'); }
  } };
  let service = createCommerceImages(options); services.push(service);
  const opened = await service.read({ projectId: 'resume-project', sourceArtifactId: source.id }), scope = { projectId: 'resume-project', sourceArtifactId: source.id, documentId: opened.documentId };
  const document = await service.save({ ...scope, expectedRevision: 0, document: { type: 'xuzuo-commerce-image', version: 1, id: opened.documentId, projectId: scope.projectId, sourceArtifactId: source.id, sourceSha256: sourceHash, revision: 0, title: '续存原稿', width: 400, height: 400, background: '#FFFFFF', updatedAt: '', layers: [
    { id: 'product', name: '商品', type: 'image', role: 'product', artifactId: source.id, x: 100, y: 80, width: 160, height: 240, opacity: 1, visible: true, locked: false },
    { id: 'text', name: '文案', type: 'text', text: '新售价88元', fontSize: 20, fontFamily: 'Arial', fontWeight: 'normal', color: '#112233', align: 'center', x: 20, y: 350, width: 360, height: 35, opacity: 1, visible: true, locked: false },
  ] } });
  const owned = { ...f, services }; roots.push(owned);
  const jobStore = createReflowJobStore({ workspaceStorage: f.workspaceStorage });
  return { ...owned, source, sourceHash, document, scope, stats, exports, options, jobStore, get service() { return service; }, async restart() { await service.shutdown(); service = createCommerceImages(options); services.push(service); },
    async preview(count = 3) { return service.reflowPreview({ ...scope, expectedRevision: 1, requestId: randomUUID(), targets: targets.slice(0, count) }); },
    async list() { return service.reflowJobs({ ...scope, expectedRevision: 1 }); },
    async resume(job) { return service.reflowExport({ ...scope, expectedRevision: 1, jobId: job.id, approvedTargetIds: job.targets.map(target => target.id) }); },
  };
}
afterEach(async () => { for (const f of roots.splice(0)) { for (const service of f.services) await service.shutdown(); await f.engine.shutdown(); await Promise.all([f.editorStore.drain(), f.spreadsheetStore.drain(), f.artifactStore.drain()]); const directory = await fs.realpath(f.directory); if (path.dirname(directory) !== await fs.realpath(os.tmpdir()) || !path.basename(directory).startsWith('xuzuo-production-')) throw Error('Unowned recovery fixture'); await fs.rm(directory, { recursive: true, force: true }); } });
const submitted = (f, preview) => ({ ...f.scope, expectedRevision: 1, previewId: preview.previewId, approvedTargetIds: preview.targets.map(target => target.id) });
describe('真实FS多比例续存（字体使用明确像素替身；不调用模型）', () => {
  it('第三版中断后重建服务，一次仅补剩余版；原先成功文件/逐版确认/原稿/费用都不变', async () => {
    const f = await setup({ failAt: 3 }), preview = await f.preview(), ledger = (await f.engine.snapshot()).ledger;
    await expect(f.service.reflowExport(submitted(f, preview))).rejects.toThrow('interrupted');
    const job = (await f.list()).jobs[0]; expect(job).toMatchObject({ completed: 2, total: 3, canResume: true });
    const before = new Map(); for (const id of job.targets.flatMap(target => target.artifactIds)) before.set(id, sha((await f.artifactStore.read(id)).buffer));
    const partial = await f.artifactStore.listProject(f.scope.projectId), attempts = f.stats.composed; expect(partial).toHaveLength(6);
    await f.restart(); expect((await f.list()).jobs[0].id).toBe(job.id); const resumed = await f.resume(job);
    expect(f.stats.composed - attempts).toBe(1); expect(resumed.artifacts).toHaveLength(6); expect(await f.artifactStore.listProject(f.scope.projectId)).toHaveLength(7);
    for (const [id, expected] of before) expect(sha((await f.artifactStore.read(id)).buffer)).toBe(expected);
    const receipt = (await f.jobStore.read(f.scope, job.id)).job; expect(receipt.approvedTargetIds).toEqual(preview.targets.map(target => target.id)); expect(receipt.targets.every(target => target.completed)).toBe(true);
    expect(await f.service.templateSource(f.scope)).toEqual(f.document); expect(sha((await f.artifactStore.read(f.source.id)).buffer)).toBe(f.sourceHash); expect((await f.engine.snapshot()).ledger).toEqual(ledger); expect(f.calls).toHaveLength(0);
    const repeated = await f.resume((await f.list()).jobs[0]); expect(repeated.artifacts.map(file => file.id)).toEqual(resumed.artifacts.map(file => file.id)); expect(f.stats.composed - attempts).toBe(1);
  }, 15000);
  it('PNG与本地登记已成功但回执丢失时，重开复用同一文件和run，既不再编码也不重复登记', async () => {
    const f = await setup({ lostAck: true }), preview = await f.preview(1);
    await expect(f.service.reflowExport(submitted(f, preview))).rejects.toThrow('acknowledgement'); const files = await f.artifactStore.listProject(f.scope.projectId), before = f.stats.composed;
    expect(files).toHaveLength(3); expect((await f.list()).jobs[0].completed).toBe(0); await f.restart(); const result = await f.resume((await f.list()).jobs[0]);
    expect(f.stats.composed).toBe(before); expect(result.artifacts.map(file => file.id).sort()).toEqual(files.filter(file => file.runId).map(file => file.id).sort()); expect(new Set(f.exports).size).toBe(1); expect((await f.engine.snapshot()).runs).toHaveLength(1); expect((await f.engine.snapshot()).ledger).toHaveLength(0);
  }, 15000);
  it('并发和重复提交同一个已确认任务共用结果，不重复写JSON或PNG', async () => {
    const f = await setup(), preview = await f.preview(1), input = submitted(f, preview), [first, second] = await Promise.all([f.service.reflowExport(input), f.service.reflowExport(input)]);
    expect(first.artifacts.map(file => file.id)).toEqual(second.artifacts.map(file => file.id)); expect(f.stats.composed).toBe(1); expect(await f.artifactStore.listProject(f.scope.projectId)).toHaveLength(3);
    await expect(f.service.reflowExport({ ...input, approvedTargetIds: [] })).rejects.toThrow('全部'); expect(f.stats.composed).toBe(1);
  }, 15000);
  it('另一个项目、变化原稿及外部改变的成功文件都不能接受旧确认或补写', async () => {
    const f = await setup({ failAt: 2 }), preview = await f.preview(); await expect(f.service.reflowExport(submitted(f, preview))).rejects.toThrow(); const job = (await f.list()).jobs[0], before = f.stats.composed;
    await expect(f.service.reflowExport({ ...f.scope, projectId: 'other-project', expectedRevision: 1, jobId: job.id, approvedTargetIds: job.targets.map(target => target.id) })).rejects.toThrow();
    const pngId = (await f.artifactStore.list(job.targets[0].artifactIds)).find(file => file.mimeType === 'image/png').id, file = await f.artifactStore.read(pngId); await fs.writeFile(file.path, Buffer.from('externally changed'));
    await expect(f.resume(job)).rejects.toThrow(); expect(f.stats.composed).toBe(before);
    await f.service.save({ ...f.scope, expectedRevision: 1, document: { ...f.document, title: '用户后来改过的稿' } }); expect((await f.service.reflowJobs({ ...f.scope, expectedRevision: 2 })).jobs[0].canResume).toBe(false);
    await expect(f.service.reflowExport({ ...f.scope, expectedRevision: 2, jobId: job.id, approvedTargetIds: job.targets.map(target => target.id) })).rejects.toThrow(/原稿|改变/); expect(f.stats.composed).toBe(before);
  }, 15000);
  it('成功记录不挤掉未完成项；新原稿的明确导出会归档失效旧确认而不删除其文件记录', async () => {
    const f = await setup({ failAt: 1 }), preview = await f.preview(1); await expect(f.service.reflowExport(submitted(f, preview))).rejects.toThrow(); const first = (await f.list()).jobs[0], template = (await f.jobStore.read(f.scope, first.id)).job;
    for (let index = 0; index < 19; index++) { const job = structuredClone(template); job.id = `${Date.now()}-${randomUUID()}`; job.targets = job.targets.map(target => ({ ...target, runId: randomUUID() })); await f.jobStore.save(job); }
    expect((await f.list()).jobs.filter(job => job.completed < job.total)).toHaveLength(20);
    const changed = await f.service.save({ ...f.scope, expectedRevision: 1, document: { ...f.document, title: '明确使用新版原稿' } }), fresh = await f.service.reflowPreview({ ...f.scope, expectedRevision: changed.revision, requestId: randomUUID(), targets: targets.slice(0, 1) });
    await f.service.reflowExport({ ...f.scope, expectedRevision: changed.revision, previewId: fresh.previewId, approvedTargetIds: fresh.targets.map(target => target.id) });
    expect((await f.service.reflowJobs({ ...f.scope, expectedRevision: changed.revision })).jobs.filter(job => job.completed < job.total)).toHaveLength(0); expect((await f.jobStore.read(f.scope, first.id)).job.id).toBe(first.id);
  }, 15000);
  it('保存前拒绝超过可读取2MiB的合法工程记录，损坏记录不会变成空进度覆盖已有文件', async () => {
    const f = await setup({ failAt: 1 }), preview = await f.preview(1); await expect(f.service.reflowExport(submitted(f, preview))).rejects.toThrow(); const item = (await f.list()).jobs[0], { job: original, filename } = await f.jobStore.read(f.scope, item.id), huge = structuredClone(original);
    huge.id = `${Date.now()}-${randomUUID()}`;
    huge.targets = Array.from({ length: 6 }, (_, index) => ({ ...original.targets[0], id: randomUUID(), width: 160 + index * 8, height: 160, warnings: [], document: { ...original.targets[0].document, id: randomUUID(), width: 160 + index * 8 }, runId: randomUUID() })); huge.approvedTargetIds = huge.targets.map(target => target.id);
    const limit = 2 * 1024 * 1024, envelope = () => ({ version: 1, sha256: '0'.repeat(64), job: huge });
    let count = Math.floor((limit - Buffer.byteLength(JSON.stringify(envelope()), 'utf8')) / (6 * 453));
    const warnings = () => { for (const target of huge.targets) target.warnings = Array(count).fill('a'.repeat(450)); }; warnings();
    while (Buffer.byteLength(JSON.stringify(envelope()), 'utf8') > limit) { count--; warnings(); }
    expect(Buffer.byteLength(JSON.stringify(envelope()), 'utf8')).toBeLessThanOrEqual(limit); expect(Buffer.byteLength(JSON.stringify(envelope(), null, 2) + '\n', 'utf8')).toBeGreaterThan(limit);
    await expect(f.jobStore.save(huge)).rejects.toThrow('2MB'); await expect(fs.lstat(path.join(path.dirname(filename), huge.id + '.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    const files = await f.artifactStore.listProject(f.scope.projectId); await fs.writeFile(filename, '{broken'); const listed = await f.list(); expect(listed.errors).toHaveLength(1); await expect(f.resume(item)).rejects.toThrow(); expect(await f.artifactStore.listProject(f.scope.projectId)).toEqual(files);
  }, 15000);
  it('新确认只归档已确定损坏或缺失的旧单；权限或临时IO失败不被当作坏记录清除', async () => {
    const f = await setup({ failAt: 1 }), preview = await f.preview(1); await expect(f.service.reflowExport(submitted(f, preview))).rejects.toThrow(); const item = (await f.list()).jobs[0], { job, filename } = await f.jobStore.read(f.scope, item.id), indexFile = path.join(path.dirname(filename), 'index-v1.json'), originalIndex = await fs.readFile(indexFile);
    for (const code of ['EIO', 'EACCES']) {
      const blocked = createReflowJobStore({ workspaceStorage: f.workspaceStorage, fileSystem: { ...fs, readFile: (file, ...args) => file === filename ? Promise.reject(Object.assign(Error('fixture temporary read fault'), { code })) : fs.readFile(file, ...args) } }), next = { ...structuredClone(job), id: `${Date.now()}-${randomUUID()}` };
      await expect(blocked.save(next)).rejects.toMatchObject({ code }); expect(await fs.readFile(indexFile)).toEqual(originalIndex); await expect(fs.lstat(path.join(path.dirname(filename), next.id + '.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    }
    await fs.writeFile(filename, '{broken'); const next = { ...structuredClone(job), id: `${Date.now()}-${randomUUID()}` }; await f.jobStore.save(next);
    expect(JSON.parse(await fs.readFile(indexFile, 'utf8')).pending).toEqual([next.id]); expect(await fs.readFile(filename, 'utf8')).toBe('{broken');
    const missing = { ...structuredClone(job), id: `${Date.now()}-${randomUUID()}` }; await fs.unlink(path.join(path.dirname(filename), next.id + '.json')); await f.jobStore.save(missing); expect(JSON.parse(await fs.readFile(indexFile, 'utf8')).pending).toEqual([missing.id]);
  }, 15000);
});
