import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), { createAssetLibrary } = require('../../electron/asset-library.cjs'), { createWorkspaceStorage } = require('../../electron/workspace-storage.cjs');
const owned = [];
afterEach(async () => { for (const directory of owned.splice(0)) { if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('xuzuo-asset-search-')) throw Error('Unowned test directory'); await fs.rm(directory, { recursive: true, force: true }); } });
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-asset-search-')); owned.push(directory);
  const root = path.join(directory, 'workspace'); await fs.mkdir(root);
  const workspace = createWorkspaceStorage({ directory: path.join(directory, 'control') }); workspace.setArtifactMigrator(async () => undefined); await workspace.bindRoot({ workspaceId: 'one', name: '素材搜索', directory: root });
  const original = createAssetLibrary({ workspaceStorage: workspace, artifactStore: {} });
  const source = path.join(directory, '宣传方案.txt'); await fs.writeFile(source, '仅导入使用的正文，不得在搜索时读取');
  const [asset] = await original.importPaths({ workspaceId: 'one', paths: [source] });
  const reads = [], stats = [], fileSystem = { ...fs, readFile: async (name, ...options) => { reads.push(String(name)); return fs.readFile(name, ...options); }, lstat: async (...args) => { stats.push(String(args[0])); return fs.lstat(...args); } };
  return { directory, root, asset, reads, stats, original, library: createAssetLibrary({ workspaceStorage: workspace, artifactStore: {}, fileSystem }) };
}
describe('素材搜索仅读受控索引metadata，不扫描原文件', () => {
  it('名称和ID可定位，返回限制和workspace正确且不读取素材bytes', async () => {
    const f = await fixture(), result = await f.library.search({ workspaceId: 'one', query: '宣传', limit: 1 });
    expect(result.total).toBe(1); expect(result.items[0]).toMatchObject({ id: f.asset.id, workspaceId: 'one', name: '宣传方案.txt' }); expect(result.items[0]).not.toHaveProperty('fileName'); expect(result.items[0]).not.toHaveProperty('sha256');
    expect(f.reads.every(name => path.basename(name) === 'library-v1.json')).toBe(true); expect(f.stats.some(name => path.dirname(name).endsWith(path.sep + 'files'))).toBe(false);
    expect((await f.library.search({ workspaceId: 'one', query: f.asset.id, limit: 1 })).items[0].id).toBe(f.asset.id);
  });
  it('外部文件消失仍可搜索登记项，点击预览时才严查；归档后不出现', async () => {
    const f = await fixture(), names = await fs.readdir(path.join(f.root, '.xuzuo-assets', 'files')); await fs.unlink(path.join(f.root, '.xuzuo-assets', 'files', names[0]));
    expect((await f.library.search({ workspaceId: 'one', query: '宣传', limit: 6 })).total).toBe(1); await expect(f.library.read({ workspaceId: 'one', id: f.asset.id })).rejects.toThrow();
    await f.original.update({ workspaceId: 'one', id: f.asset.id, archived: true }); expect((await f.library.search({ workspaceId: 'one', query: '', limit: 6 })).total).toBe(0);
  });
  it('错误workspace、超长查询与过大limit拒绝，不创建空索引覆盖', async () => {
    const f = await fixture(); await expect(f.library.search({ workspaceId: 'foreign', query: '', limit: 6 })).rejects.toThrow(); await expect(f.library.search({ workspaceId: 'one', query: 'x'.repeat(121), limit: 6 })).rejects.toThrow('120'); await expect(f.library.search({ workspaceId: 'one', query: '', limit: 99 })).rejects.toThrow('1–50');
  });
  it('轻量名称查询不重复带许可证长文，但点击精确ID定位保留完整来源', async () => {
    const f = await fixture(), filename = path.join(f.root, '.xuzuo-assets', 'library-v1.json'), index = JSON.parse(await fs.readFile(filename, 'utf8'));
    index.assets[0].provenance = { builtinId: 'fixture-license', packId: 'fixture', origin: 'open-source', author: 'Fixture Authors', licenseId: 'ISC', licenseName: 'ISC', licenseUrl: 'https://example.com/license', sourceUrl: 'https://example.com/source', usageNote: '请保留授权', licenseNotice: '完整来源和授权文本，不得丢失。' };
    await fs.writeFile(filename, JSON.stringify(index) + '\n', 'utf8');
    expect((await f.library.search({ workspaceId: 'one', query: '宣传', limit: 1 })).items[0].provenance).toBeUndefined();
    expect((await f.library.search({ workspaceId: 'one', query: f.asset.id, limit: 1 })).items[0].provenance.licenseNotice).toBe('完整来源和授权文本，不得丢失。');
  });
});
