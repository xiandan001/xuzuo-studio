import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url), root = fileURLToPath(new URL('../../', import.meta.url));
const deps = createRequire(path.join(root, 'work/ui-build/package.json'));
const { createBuiltinAssets } = require('../../electron/builtin-assets.cjs');
const { createAssetLibrary } = require('../../electron/asset-library.cjs');
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
const { createWorkspaceStorage } = require('../../electron/workspace-storage.cjs');
const pack = path.join(root, 'assets/library');
const catalog = JSON.parse(await fs.readFile(path.join(pack, 'catalog.json'), 'utf8'));
async function fixture(extra = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-builtin-'));
  const first = path.join(directory, 'workspace-one'), second = path.join(directory, 'workspace-two'); await fs.mkdir(first); await fs.mkdir(second);
  const storage = createWorkspaceStorage({ directory: path.join(directory, 'control') });
  const storeOptions = { directory: path.join(directory, 'artifacts'), workspaceStorage: storage, loadModule: deps }, store = createArtifactStore(storeOptions);
  storage.setArtifactMigrator((id, target) => store.migrateProject(id, target));
  await storage.bindRoot({ workspaceId: 'one', name: '一', directory: first }); await storage.bindRoot({ workspaceId: 'two', name: '二', directory: second });
  await storage.ensureProject({ projectId: 'project-one', workspaceId: 'one', name: '项目一' }); await storage.ensureProject({ projectId: 'project-two', workspaceId: 'two', name: '项目二' });
  const libraryOptions = { workspaceStorage: storage, artifactStore: store }, library = createAssetLibrary(libraryOptions);
  const service = createBuiltinAssets({ directory: pack, workspaceStorage: storage, artifactStore: store, assetLibrary: library, loadModule: deps, ...extra });
  return { directory, first, second, service, library, store, storeOptions, libraryOptions };
}

describe('可信内置素材与独立工作区副本', () => {
  it('仅在操作时读取目录元数据，链接查询不读取任何PNG，不使用请求中的路径或URL', async () => {
    const reads = [], fileSystem = { ...fs, readFile: async (...args) => { reads.push(args[0]); return fs.readFile(...args); } };
    const f = await fixture({ fileSystem }); expect(reads).toEqual([]);
    const icon = catalog.assets.find(item => item.origin === 'open-source');
    expect(await f.service.link({ id: icon.id, kind: 'source', url: 'https://untrusted.invalid' })).toBe(icon.sourceUrl);
    expect(reads.map(file => path.basename(file))).toEqual(['catalog.json']);
    await expect(f.service.link({ id: '../outside', kind: 'source' })).rejects.toThrow('有效');
    await expect(f.service.link({ id: icon.id, kind: 'command' })).rejects.toThrow('类型');
  });
  it('保存副本去重，重开后授权保留，复制进项目独立可用且不因素材归档损坏', async () => {
    const f = await fixture(), icon = catalog.assets.find(item => item.origin === 'open-source');
    const own = await f.service.import({ workspaceId: 'one', id: icon.id });
    expect((await f.service.import({ workspaceId: 'one', id: icon.id })).id).toBe(own.id);
    expect(await f.library.list({ workspaceId: 'one' })).toHaveLength(1);
    const reopened = createAssetLibrary(f.libraryOptions); expect((await reopened.list({ workspaceId: 'one' }))[0].provenance).toMatchObject({ builtinId: icon.id, licenseId: 'ISC', origin: 'open-source' });
    const project = await f.library.attach({ workspaceId: 'one', id: own.id, projectId: 'project-one' });
    await f.library.update({ workspaceId: 'one', id: own.id, archived: true });
    const artifact = await createArtifactStore(f.storeOptions).read(project.id);
    expect(artifact.provenance).toMatchObject({ builtinId: icon.id, licenseId: 'ISC' }); expect(artifact.buffer).toEqual(await fs.readFile(path.join(pack, icon.path)));
    expect((await f.library.list({ workspaceId: 'two' }))).toEqual([]);
  });
  it('直接复制到项目受工作区约束，原PNG携带完整许可证，不触碰API或账本', async () => {
    const f = await fixture(), item = catalog.assets.find(item => item.origin === 'open-source');
    await expect(f.service.attach({ workspaceId: 'one', projectId: 'project-two', id: item.id })).rejects.toThrow(/不属于|工作区/);
    const file = await f.service.attach({ workspaceId: 'one', projectId: 'project-one', id: item.id });
    const actual = await f.store.read(file.id); expect(actual.provenance.licenseNotice).toContain('Permission to use');
    expect(actual.buffer.includes(Buffer.from('Permission to use'))).toBe(true);
    expect(actual.path.startsWith(f.first)).toBe(true); expect(await f.library.list({ workspaceId: 'one' })).toEqual([]);
  });
  it('素材包包含实际PNG、可编辑SVG、完整许可和来源说明，原作不伪造网络来源', async () => {
    const f = await fixture(), item = catalog.assets[0], result = await f.service.bundle({ id: item.id });
    const zip = await deps('jszip').loadAsync(result.buffer);
    expect(Object.keys(zip.files).sort()).toEqual([`${item.id}.png`, `${item.id}.svg`, 'LICENSE.txt', '素材说明.txt'].sort());
    expect(await zip.file(`${item.id}.png`).async('nodebuffer')).toEqual(await fs.readFile(path.join(pack, item.path)));
    expect(await zip.file('LICENSE.txt').async('string')).toContain('CC0'); expect(await zip.file('素材说明.txt').async('string')).toContain('序作原创');
    await expect(f.service.link({ id: item.id, kind: 'source' })).rejects.toThrow('原创');
  });
  it('同长度内容篡改、源文件链接与未知ID被拒绝，不创建素材索引或项目副本', async () => {
    const target = catalog.assets[0];
    const corruptedFs = { ...fs, readFile: async (...args) => { const buffer = await fs.readFile(...args); if (String(args[0]).endsWith(target.path.replaceAll('/', path.sep))) { const changed = Buffer.from(buffer); changed[changed.length - 1] ^= 1; return changed; } return buffer; } };
    const f = await fixture({ fileSystem: corruptedFs });
    await expect(f.service.import({ workspaceId: 'one', id: target.id })).rejects.toThrow('完整性');
    await expect(fs.lstat(path.join(f.first, '.xuzuo-assets'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(f.service.read({ id: 'unknown' })).rejects.toThrow('不存在');
    const linkedFs = { ...fs, lstat: async file => { const stat = await fs.lstat(file); if (String(file).endsWith(target.path.replaceAll('/', path.sep))) stat.isSymbolicLink = () => true; return stat; } };
    const linked = await fixture({ fileSystem: linkedFs }); await expect(linked.service.read({ id: target.id })).rejects.toThrow('无效');
  });
});
