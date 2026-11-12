import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url), root = path.resolve(import.meta.dirname, '../..');
const load = createRequire(path.join(root, 'work/ui-build/package.json'));
const { createCustomerProofing } = require('../../electron/customer-proofing.cjs');
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
const { hash } = require('../../electron/proofing-validation.cjs');
const directories = [];
afterEach(async () => { for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-proof-unit-')); directories.push(directory);
  const artifactStore = createArtifactStore({ directory: path.join(directory, 'artifacts'), loadModule: load });
  const docs = new Map(), commitFeedback = vi.fn(async input => ({ orderId: 'order', imported: input.annotations.length }));
  const assertProject = vi.fn(async (projectId, workspaceId) => { if (projectId !== 'project' || workspaceId !== 'workspace') throw Error('foreign scope'); });
  const service = createCustomerProofing({ directory, artifactStore, assertProject, loadModule: load, readDocument: async file => docs.get(file.id), commitFeedback });
  const { PNG } = load('pngjs'), image = new PNG({ width: 8, height: 8 }); image.data.fill(255);
  const picture = await artifactStore.write({ projectId: 'project', name: '成品.png', mimeType: 'image/png', buffer: PNG.sync.write(image) });
  async function create(files = [picture], title = '客户A校样') { return service.create({ workspaceId: 'workspace', projectId: 'project', artifactIds: files.map(file => file.id), title }); }
  async function data(output) { const zip = await load('jszip').loadAsync((await artifactStore.read(output.artifact.id)).buffer), html = await zip.file('index.html').async('string'); return { zip, html, manifest: JSON.parse(await zip.file('manifest.json').async('string')), data: JSON.parse(/<script id="proof-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1]) }; }
  const feedback = (output, data, patch = {}) => ({ format: 'xuzuo-proof-feedback', version: 1, packageId: output.packageId, fingerprint: output.fingerprint, createdAt: new Date().toISOString(), annotations: [{ id: 'annotation', pageId: data.pages[0].id, text: '把此处调整得更清楚', region: { x: .1, y: .2, width: .3, height: .4 } }], ...patch });
  return { directory, artifactStore, docs, service, commitFeedback, picture, create, data, feedback };
}
describe('离线客户校样与准确反馈承接', () => {
  it('真正打包可见图片和离线交互，未泄漏原项目私料/提示词/账本', async () => {
    const f = await fixture(), output = await f.create(), { zip, html, data, manifest } = await f.data(output);
    expect(Object.keys(zip.files).sort()).toEqual(['README.txt', 'index.html', 'manifest.json']); expect(html).toContain('data:image/png;base64,'); expect(html).toContain('导出反馈文件'); expect(html).toContain("connect-src &#39;none&#39;"); expect(html).toContain("script-src &#39;sha256-");
    expect(data.pages).toHaveLength(1); expect(manifest.files[0].sha256).toBe(hash((await f.artifactStore.read(f.picture.id)).buffer)); expect(manifest.files[0]).not.toHaveProperty('artifactId'); expect(data).not.toHaveProperty('projectId'); expect(data).not.toHaveProperty('orderId');
    expect(html).not.toMatch(/https?:\/\//); expect(html).not.toContain('workflowRunId'); expect(html).not.toContain('credentialId');
  });
  it('圈选反馈映射真实文件与版本，重复导入不重复返修/不重复模型费用', async () => {
    const f = await fixture(), output = await f.create(), { data } = await f.data(output), feedback = f.feedback(output, data);
    const first = await f.service.importFeedback({ workspaceId: 'workspace', feedback }); expect(first).toMatchObject({ annotations: 1, duplicate: 0, orderId: 'order', imported: true });
    expect(f.commitFeedback).toHaveBeenCalledWith(expect.objectContaining({ annotations: [expect.objectContaining({ target: expect.objectContaining({ artifactId: f.picture.id, projectId: 'project', region: feedback.annotations[0].region }), sourceSha256: output.files[0].sha256 })] }));
    const again = await f.service.importFeedback({ workspaceId: 'workspace', feedback }); expect(again).toMatchObject({ annotations: 0, duplicate: 1, imported: false }); expect(f.commitFeedback).toHaveBeenCalledOnce();
    feedback.annotations[0].text = '试图覆盖已有意见'; await expect(f.service.importFeedback({ workspaceId: 'workspace', feedback })).rejects.toThrow('内容已改变'); expect(f.commitFeedback).toHaveBeenCalledOnce();
  });
  it('跨区、错版本、伪造位置、负坐标和脚本字段全部在写入前拒绝', async () => {
    const f = await fixture(), output = await f.create(), { data } = await f.data(output), feedback = f.feedback(output, data);
    await expect(f.service.importFeedback({ workspaceId: 'other', feedback })).rejects.toThrow();
    for (const change of [value => { value.fingerprint = '0'.repeat(64); }, value => { value.annotations[0].pageId = 'foreign'; }, value => { value.annotations[0].region.x = -.2; }, value => { value.annotations[0].region.width = 2; }, value => { value.annotations[0].script = 'fetch(secret)'; }, value => { value.annotations[0].locatorId = 'constructor'; }]) { const value = structuredClone(feedback); change(value); await expect(f.service.importFeedback({ workspaceId: 'workspace', feedback: value })).rejects.toThrow(); }
    expect(f.commitFeedback).not.toHaveBeenCalled();
  });
  it('Office正文是真实已保存源，block定位与sourceRevision回传且HTML转义', async () => {
    const f = await fixture(), document = { schemaVersion: 1, kind: 'word', title: '合作说明<script>bad()</script>', blocks: [{ id: 'body', type: 'paragraph', text: '交付数量17套，不包含额外返修。', fontSize: 12, bold: false, italic: false, align: 'left' }] };
    const [office] = await f.artifactStore.exportOffice({ kind: 'word', projectId: 'project', title: '合作说明', text: JSON.stringify({ editorDocument: document }), assets: [] }); f.docs.set(office.id, { document, sourceRevision: 3 });
    const output = await f.create([office]), { html, data } = await f.data(output); expect(html).toContain('交付数量17套'); expect(html).not.toContain('<script>bad()'); expect(html).toContain('&lt;script&gt;bad()');
    expect(JSON.stringify(data)).not.toContain('"blockId"'); expect(JSON.stringify(data)).not.toContain('"sourcePageId"');
    const [locatorId] = Object.keys(data.pages[0].locators), feedback = f.feedback(output, data, { annotations: [{ id: 'word-note', pageId: data.pages[0].id, locatorId, selectedText: '交付数量17套', text: '请改为18套' }] });
    await f.service.importFeedback({ workspaceId: 'workspace', feedback }); expect(f.commitFeedback.mock.calls[0][0].annotations[0]).toMatchObject({ sourceRevision: 3, target: { blockId: 'body', artifactId: office.id }, text: '请改为18套' });
  });
  it('没有绑定源的Office不伪造预览，源文件外改不把旧反馈应用到新稿', async () => {
    const f = await fixture(); const [office] = await f.artifactStore.exportOffice({ kind: 'word', projectId: 'project', title: '说明', text: '真实正文', assets: [] });
    await expect(f.create([office])).rejects.toThrow('没有绑定');
    const output = await f.create(), { data } = await f.data(output), actual = await f.artifactStore.read(f.picture.id); await fs.writeFile(actual.path, Buffer.from('changed'));
    await expect(f.service.importFeedback({ workspaceId: 'workspace', feedback: f.feedback(output, data) })).rejects.toThrow(); expect(f.commitFeedback).not.toHaveBeenCalled();
  });
  it('PPT按真实页面与插图预览且不泄漏讲稿，反馈精确到原始页ID', async () => {
    const f = await fixture(), document = { schemaVersion: 1, kind: 'ppt', title: '产品提案', theme: 'paper', slides: [{ id: 'slide-first', title: '明确的标题', body: '可以执行的完整介绍', notes: '内部讲稿不发送客户', layout: 'image-right', fontSize: 22, align: 'left', imageId: f.picture.id }, { id: 'slide-second', title: '下一步', body: '建议安排试做', notes: '', layout: 'title-body', fontSize: 22, align: 'left' }] };
    const [office] = await f.artifactStore.exportOffice({ kind: 'ppt', projectId: 'project', title: document.title, text: JSON.stringify({ editorDocument: document }), assets: [f.picture.id] }); f.docs.set(office.id, { document, sourceRevision: 2 });
    const output = await f.create([office]), { data, html } = await f.data(output); expect(data.pages).toHaveLength(2); expect(html).toContain('data:image/png;base64,'); expect(html).not.toContain('内部讲稿不发送客户');
    const locatorId = Object.keys(data.pages[1].locators)[0]; await f.service.importFeedback({ workspaceId: 'workspace', feedback: f.feedback(output, data, { annotations: [{ id: 'slide-note', pageId: data.pages[1].id, locatorId, selectedText: '下一步', text: '标题改为执行计划' }] }) });
    expect(f.commitFeedback.mock.calls[0][0].annotations[0]).toMatchObject({ sourceRevision: 2, target: { artifactId: office.id, pageId: 'slide-second' } });
  });
  it('Excel导出真实计算值且单元格意见定位准确，未把公式变成脚本', async () => {
    const f = await fixture(), document = { schemaVersion: 1, kind: 'excel', title: '预算清单', sheets: [{ id: 'sheet-budget', name: '预算', rowCount: 2, columnCount: 2, cells: { A1: { value: 17 }, B1: { value: null, formula: 'A1*2' } } }] };
    const [office] = await f.artifactStore.exportOffice({ kind: 'excel', projectId: 'project', title: document.title, text: JSON.stringify(document), assets: [] }); f.docs.set(office.id, { document, sourceRevision: 4 });
    const output = await f.create([office]), { data } = await f.data(output), locatorId = Object.keys(data.pages[0].locators).find(id => data.pages[0].locators[id].text === '34'); expect(locatorId).toBeTruthy(); expect(data.pages[0].html).not.toContain('A1*2');
    await f.service.importFeedback({ workspaceId: 'workspace', feedback: f.feedback(output, data, { annotations: [{ id: 'cell-note', pageId: data.pages[0].id, locatorId, selectedText: '34', text: '单价需调整' }] }) }); expect(f.commitFeedback.mock.calls[0][0].annotations[0]).toMatchObject({ sourceRevision: 4, target: { artifactId: office.id, sheetId: 'sheet-budget', cellAddress: 'B1', selectedText: '34' } });
  });
  it('取消退出后可恢复服务，错误不把所有后续导出堵住', async () => {
    const f = await fixture(); await f.service.prepareClose(); await expect(f.create()).rejects.toThrow('正在退出'); f.service.resume(); await expect(f.create()).resolves.toHaveProperty('packageId');
  });
  it('原生动图与矢量校样保留格式，脚本SVG和畸形GIF在客户端打开前拒绝', async () => {
    const f = await fixture(), frame = Buffer.from('21f904000a0000002c0000000001000100000202440100', 'hex'), gif = Buffer.concat([Buffer.from('47494638396101000100800000ffffff000000', 'hex'), frame, frame, Buffer.from('3b', 'hex')]);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#39a"/></svg>');
    const files = await Promise.all([{ name: '动作.gif', mimeType: 'image/gif', buffer: gif }, { name: '图标.svg', mimeType: 'image/svg+xml', buffer: svg }].map(file => f.artifactStore.write({ projectId: 'project', ...file })));
    const output = await f.create(files), { html, data } = await f.data(output); expect(data.pages).toHaveLength(2); expect(html).toContain('data:image/gif;base64,'); expect(html).toContain('data:image/svg+xml;base64,');
    const { imageUrl } = require('../../electron/proofing-preview.cjs'); expect(() => imageUrl({ mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>fetch(1)</script></svg>') })).toThrow(); expect(() => imageUrl({ mimeType: 'image/gif', buffer: gif.subarray(0, -1) })).toThrow();
  });
  it('校样工作区备份迁移保留客户包身份、去重回执及文字定位，原稿SHA仍严格核对', async () => {
    const f = await fixture(), document = { schemaVersion: 1, kind: 'word', title: '迁移校样', blocks: [{ id: 'body-old', type: 'paragraph', text: '交付17套', fontSize: 12, bold: false, italic: false, align: 'left' }] };
    const [office] = await f.artifactStore.exportOffice({ kind: 'word', projectId: 'project', title: document.title, text: JSON.stringify({ editorDocument: document }), assets: [] }); f.docs.set(office.id, { document, sourceRevision: 2 });
    const output = await f.create([office]), { data } = await f.data(output), locatorId = Object.keys(data.pages[0].locators)[0], feedback = f.feedback(output, data, { annotations: [{ id: 'migrated-note', pageId: data.pages[0].id, locatorId, selectedText: '17套', text: '改为18套' }] }); await f.service.importFeedback({ workspaceId: 'workspace', feedback });
    const snapshot = await f.service.exportWorkspace('workspace'), { proofBackupFiles, readProofBackups, remapProofBackups, cacheProofReceipt, loadProofReceipt } = require('../../electron/proofing-backup.cjs');
    const files = new Map(proofBackupFiles(snapshot).map(file => [file.name, file.buffer])), manifest = { scope: 'workspaces', proofWorkspaces: ['workspace'], locations: { workspaces: [{ workspaceId: 'workspace' }], projects: [{ projectId: 'project', workspaceId: 'workspace' }] }, artifacts: [{ ...office, sha256: output.files[0].sha256 }] }; expect(readProofBackups(manifest, files)).toHaveLength(1);
    const destination = createArtifactStore({ directory: path.join(f.directory, 'restored-artifacts'), loadModule: load }), copy = await destination.write({ projectId: 'new-project', name: office.name, mimeType: office.mimeType, buffer: (await f.artifactStore.read(office.id)).buffer });
    const [remapped] = remapProofBackups([snapshot], { workspace: 'new-workspace', project: 'new-project', [office.id]: copy.id, 'body-old': 'new-body', order: 'new-order' }, 'backup-id'); const receipts = path.join(f.directory, 'receipts'); const descriptors = await cacheProofReceipt(fs, receipts, 'backup-id', [remapped]); expect(await loadProofReceipt(fs, receipts, 'backup-id', descriptors)).toEqual([remapped]);
    const commit = vi.fn(async () => ({ orderId: 'new-order' })), service = createCustomerProofing({ directory: path.join(f.directory, 'restored'), artifactStore: destination, assertProject: async (projectId, workspaceId) => { if (projectId !== 'new-project' || workspaceId !== 'new-workspace') throw Error('foreign'); }, commitFeedback: commit, loadModule: load }); await service.restoreWorkspace(remapped);
    await expect(service.importFeedback({ workspaceId: 'new-workspace', feedback })).resolves.toMatchObject({ annotations: 0, duplicate: 1, orderId: 'new-order' }); expect(commit).not.toHaveBeenCalled();
    feedback.annotations[0].id = 'migrated-extra'; await service.importFeedback({ workspaceId: 'new-workspace', feedback }); expect(commit.mock.calls[0][0].annotations[0].target).toMatchObject({ artifactId: copy.id, projectId: 'new-project', blockId: 'new-body' }); expect(remapped.packages[0].fingerprint).toBe(output.fingerprint);
    feedback.annotations[0].id = 'after-change'; await fs.writeFile((await destination.read(copy.id)).path, 'changed'); await expect(service.importFeedback({ workspaceId: 'new-workspace', feedback })).rejects.toThrow(); expect(commit).toHaveBeenCalledOnce();
  });
  it('已移入回收站的来源不生成无法恢复的活跃校样映射备份', async () => {
    const f = await fixture(); await f.create(); expect((await f.service.exportWorkspace('workspace')).packages).toHaveLength(1); await f.artifactStore.trash(f.picture.id); expect((await f.service.exportWorkspace('workspace')).packages).toHaveLength(0);
  });
});
