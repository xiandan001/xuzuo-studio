import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url), { fixture, PNG } = require('./production-test-fixtures.cjs'), { createProjectTemplates } = require('../../electron/project-templates.cjs');
const { validateTemplateSnapshotSources, remapTemplateBackupsSources } = require('../../electron/project-template-backup.cjs');
const roots = [];
async function setup() { const f = await fixture(); roots.push(f); await f.workspaceStorage.ensureProject({ projectId: 'source', workspaceId: 'production-workspace', name: 'source' }); const source = await f.artifactStore.write({ projectId: 'source', name: '原图.png', mimeType: 'image/png', buffer: PNG }), templates = createProjectTemplates({ ...f, directory: f.directory, loadModule: f.loadModule }); await templates.save({ workspaceId: 'production-workspace', sourceProjectId: 'source', sourceArtifactId: source.id, kind: 'image', name: '流式模板', retain: { assets: true } }); return { ...f, templates }; }
afterEach(async () => { vi.restoreAllMocks(); for (const f of roots.splice(0)) { await f.engine.shutdown(); await Promise.all([f.editorStore.drain(), f.spreadsheetStore.drain(), f.artifactStore.drain()]); const target = await fs.realpath(f.directory); if (path.dirname(target) !== await fs.realpath(os.tmpdir()) || !path.basename(target).startsWith('xuzuo-production-')) throw Error('Unowned fixture'); await fs.rm(target, { recursive: true, force: true }); } });
function sources(snapshot, change) { return { ...snapshot, files: snapshot.files.map(file => ({ templateId: file.templateId, id: file.id, source: { kind: 'xuzuo-stream-file', bytes: file.bytes, sha256: file.sha256, readBytes: vi.fn(() => { throw Error('must not materialize template binary'); }), copyTo: change || vi.fn((target, options) => { expect(options.exclusive).toBe(true); return fs.copyFile(file.path, target, constants.COPYFILE_EXCL); }) } })) }; }
describe('模板逐文件流式备份与恢复', () => {
  it('导出只返回经过真实SHA校验的路径描述，恢复逐个copyTo；旧Buffer接口仍可读', async () => {
    const f = await setup(), original = fs.readFile.bind(fs), reads = vi.spyOn(fs, 'readFile').mockImplementation((file, ...args) => { if (String(file).endsWith('.bin')) throw Error('template material buffer forbidden'); return original(file, ...args); });
    const snapshot = await f.templates.exportWorkspaceSources('production-workspace'); expect(snapshot.files).toHaveLength(1); expect(snapshot.files[0].buffer).toBeUndefined(); expect(path.isAbsolute(snapshot.files[0].path)).toBe(true);
    const ready = sources(snapshot), remapped = remapTemplateBackupsSources([ready], { 'production-workspace': 'restored-workspace' })[0]; validateTemplateSnapshotSources(remapped); await f.templates.restoreWorkspaceSources(remapped);
    expect(ready.files[0].source.readBytes).not.toHaveBeenCalled(); expect(ready.files[0].source.copyTo).toHaveBeenCalledTimes(1); expect(await f.templates.restoreWorkspaceSources(remapped)).toEqual({ restored: 1 }); expect(ready.files[0].source.copyTo).toHaveBeenCalledTimes(1);
    reads.mockRestore(); const legacy = await f.templates.exportWorkspace('restored-workspace'); expect(legacy.files[0].buffer).toEqual(PNG); expect(legacy.items[0].materials[0].fileName).toBe(`${legacy.items[0].id}-${legacy.files[0].id}.bin`);
  });
  it('真实文件在描述符读取后改变时拒绝恢复，保留partial诊断且不公布坏模板', async () => {
    const f = await setup(), snapshot = await f.templates.exportWorkspaceSources('production-workspace'), ready = sources(snapshot, async target => fs.writeFile(target, Buffer.from('tampered'), { flag: 'wx' })), remapped = remapTemplateBackupsSources([ready], { 'production-workspace': 'failed-workspace' })[0];
    await expect(f.templates.restoreWorkspaceSources(remapped)).rejects.toThrow(/大小|摘要/); expect(await f.templates.list('failed-workspace')).toEqual([]); const folder = path.join(f.directory, 'project-templates-v1', 'failed-workspace', 'files'); expect((await fs.readdir(folder)).some(file => file.endsWith('.partial'))).toBe(true); expect((await f.templates.exportWorkspace('production-workspace')).files[0].buffer).toEqual(PNG);
  });
  it('完整preflight拒绝冲突，不调用源copyTo覆盖用户已有字节', async () => {
    const f = await setup(), ready = sources(await f.templates.exportWorkspaceSources('production-workspace')), remapped = remapTemplateBackupsSources([ready], { 'production-workspace': 'conflict-workspace' })[0], item = remapped.items[0], folder = path.join(f.directory, 'project-templates-v1', 'conflict-workspace', 'files'); await fs.mkdir(folder, { recursive: true }); const filename = path.join(folder, item.materials[0].fileName); await fs.writeFile(filename, Buffer.from('owned preexisting data'));
    await expect(f.templates.restoreWorkspaceSources(remapped)).rejects.toThrow(); expect(ready.files[0].source.copyTo).not.toHaveBeenCalled(); expect((await fs.readFile(filename)).toString()).toBe('owned preexisting data');
  });
  it('creative元数据的素材引用随备份ID重映射，项目归属始终是无客户占位', async () => {
    const f = await setup(), snapshot = sources(await f.templates.exportWorkspaceSources('production-workspace')), item = snapshot.items[0], material = item.materials[0]; item.imageSettings = { width: 16, height: 16, mimeType: 'image/png' }; item.creative = { version: 1, kind: 'commerce', document: { type: 'xuzuo-commerce-image', version: 1, id: 'template-layout', projectId: 'template-project', sourceArtifactId: material.id, sourceSha256: material.sha256, revision: 0, title: '空白模板', width: 16, height: 16, background: '#FFFFFF', layers: [{ id: 'slot', name: '主体', type: 'image', role: 'product', artifactId: material.id, x: 0, y: 0, width: 16, height: 16, opacity: 1, visible: true, locked: false }], updatedAt: '2000-01-01T00:00:00.000Z' } };
    item.creative.document.layers[0].templatePlaceholder = true;
    const result = remapTemplateBackupsSources([snapshot], { 'production-workspace': 'creative-restored', 'template-project': 'must-not-be-a-project' })[0]; expect(result.items[0].creative.document.projectId).toBe('template-project'); expect(result.items[0].creative.document.sourceArtifactId).toBe(result.files[0].id); expect(result.items[0].creative.document.layers[0].artifactId).toBe(result.files[0].id); expect(result.items[0].creative.document.layers[0].templatePlaceholder).toBe(true); expect(result.files[0].source).toBe(snapshot.files[0].source); await f.templates.restoreWorkspaceSources(result);
  });
});
