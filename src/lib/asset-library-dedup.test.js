import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, expect, it } from 'vitest';
const require = createRequire(import.meta.url), { createAssetLibrary } = require('../../electron/asset-library.cjs'), { createWorkspaceStorage } = require('../../electron/workspace-storage.cjs'), { createArtifactStore } = require('../../electron/artifact-store.cjs');
const owned = [];
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-asset-dedup-')); owned.push(directory);
  const root = path.join(directory, 'workspace'); await fs.mkdir(root);
  const workspaceStorage = createWorkspaceStorage({ directory: path.join(directory, 'control') });
  const artifactStore = createArtifactStore({ directory: path.join(directory, 'artifacts'), workspaceStorage }); workspaceStorage.setArtifactMigrator((id, target) => artifactStore.migrateProject(id, target));
  await workspaceStorage.bindRoot({ workspaceId: 'workspace', name: '素材复用', directory: root }); await workspaceStorage.ensureProject({ projectId: 'project', workspaceId: 'workspace', name: '原项目' });
  const library = createAssetLibrary({ workspaceStorage, artifactStore }), source = path.join(directory, '资料.txt'); await fs.writeFile(source, '真实可复用资料-END');
  return { directory, root, source, library, artifactStore, options: { workspaceStorage, artifactStore }, files: path.join(root, '.xuzuo-assets/files'), index: path.join(root, '.xuzuo-assets/library-v1.json') };
}
afterEach(async () => { for (const directory of owned.splice(0)) { expect(path.dirname(await fs.realpath(directory))).toBe(await fs.realpath(os.tmpdir())); expect(path.basename(directory)).toMatch(/^xuzuo-asset-dedup-/); await fs.rm(directory, { recursive: true, force: true }); } });
const add = (f, extra = {}) => f.library.importPaths({ workspaceId: 'workspace', paths: [f.source], ...extra });
it('重复内容沿用真实素材ID、收藏和引用，不重写索引或额外文件', async () => {
  const f = await fixture(), [first] = await add(f); await f.library.update({ workspaceId: 'workspace', id: first.id, favorite: true }); const reference = await f.library.attach({ workspaceId: 'workspace', projectId: 'project', id: first.id });
  const before = await fs.readFile(f.index), files = await fs.readdir(f.files), renamed = path.join(f.directory, '另一个名字.txt'); await fs.copyFile(f.source, renamed);
  const probe = await f.library.inspectImportPaths({ workspaceId: 'workspace', paths: [renamed] }); expect(probe[0].existing.id).toBe(first.id);
  const [same] = await add(f, { paths: [renamed], expected: probe }); expect(same).toMatchObject({ id: first.id, reused: true, favorite: true }); expect(await fs.readFile(f.index)).toEqual(before); expect(await fs.readdir(f.files)).toEqual(files); expect((await f.artifactStore.read(reference.id)).buffer.toString()).toBe('真实可复用资料-END');
});
it('同名不同内容独立保存，明确选择新副本也不会覆盖旧文件', async () => {
  const f = await fixture(), [first] = await add(f), [copy] = await add(f, { duplicates: 'copy' }); expect(copy.id).not.toBe(first.id);
  await fs.writeFile(f.source, '已经修改的新资料-END'); const [changed] = await add(f); expect(changed.id).not.toBe(first.id); expect((await f.library.read({ workspaceId: 'workspace', id: first.id })).buffer.toString()).toBe('真实可复用资料-END'); expect(await fs.readdir(f.files)).toHaveLength(3);
});
it('同一次选择的相同内容可只存一份，选择副本时保留两个独立ID', async () => {
  const f = await fixture(), second = path.join(f.directory, '第二份.txt'); await fs.copyFile(f.source, second);
  const probe = await f.library.inspectImportPaths({ workspaceId: 'workspace', paths: [f.source, second] }); expect(probe[1].duplicateSelection).toBe(true);
  expect(await add(f, { paths: [f.source, second], expected: probe })).toHaveLength(1);
  const copies = await add(f, { paths: [f.source, second], duplicates: 'copy' }); expect(new Set(copies.map(row => row.id)).size).toBe(2);
});
it('并发导入串行核验去重，重启后仍只登记一份真实文件', async () => {
  const f = await fixture(), [a, b] = await Promise.all([add(f), add(f)]); expect(a[0].id).toBe(b[0].id); expect(await fs.readdir(f.files)).toHaveLength(1);
  const reopened = createAssetLibrary(f.options); expect(await reopened.list({ workspaceId: 'workspace' })).toHaveLength(1);
});
it('损坏或丢失的旧文件保留记录，正确源文件可另建，确认期间改源会中止', async () => {
  const f = await fixture(), [first] = await add(f), index = JSON.parse(await fs.readFile(f.index, 'utf8')), old = path.join(f.files, index.assets[0].fileName); await fs.writeFile(old, '损坏字节');
  const [recovered] = await add(f); expect(recovered.id).not.toBe(first.id); expect(await fs.readFile(old, 'utf8')).toBe('损坏字节');
  const probe = await f.library.inspectImportPaths({ workspaceId: 'workspace', paths: [f.source] }), count = (await fs.readdir(f.files)).length; await fs.writeFile(f.source, '确认后外部已修改');
  await expect(add(f, { expected: probe })).rejects.toThrow('确认期间'); expect(await fs.readdir(f.files)).toHaveLength(count);
});
