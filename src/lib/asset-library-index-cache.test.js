import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { createAssetLibrary } = require('../../electron/asset-library.cjs');
const { createWorkspaceStorage } = require('../../electron/workspace-storage.cjs');
const root = fileURLToPath(new URL('../../', import.meta.url));
const { PNG } = createRequire(path.join(root, 'work/ui-build/package.json'))('pngjs');
const bitmap = new PNG({ width: 1, height: 1 }); bitmap.data.set([40, 100, 220, 255]);
const png = PNG.sync.write(bitmap);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
afterEach(() => vi.restoreAllMocks());

async function fixture(fileSystem = fs) {
  const directory = await fs.mkdtemp(path.join(root, 'work/asset-index-cache-test-'));
  await fs.writeFile(path.join(directory, '.qa-owner.json'), JSON.stringify({ kind: 'asset-index-cache-test', directory }) + '\n');
  const workspace = path.join(directory, 'workspace'); await fs.mkdir(workspace);
  const storage = createWorkspaceStorage({ directory: path.join(directory, 'control') });
  storage.setArtifactMigrator(async () => undefined);
  await storage.bindRoot({ workspaceId: 'one', name: '索引缓存隔离验收', directory: workspace });
  await storage.ensureProject({ workspaceId: 'one', projectId: 'owned-project', name: '目标项目' });
  const reads = [], writes = [];
  const options = { workspaceStorage: storage, artifactStore: { write: async value => { writes.push(value); return { id: 'actual-copy', ...value }; } }, fileSystem: { ...fileSystem, readFile: async (filename, ...args) => {
    const value = await fileSystem.readFile(filename, ...args);
    if (path.basename(filename) === 'library-v1.json') reads.push({ filename, bytes: Buffer.byteLength(value) });
    return value;
  } } };
  const library = createAssetLibrary(options), source = path.join(directory, 'cache-A.png'); await fs.writeFile(source, png);
  const [asset] = await library.importPaths({ workspaceId: 'one', paths: [source] });
  const index = path.join(workspace, '.xuzuo-assets/library-v1.json'), original = await fs.readFile(index), record = JSON.parse(original).assets[0];
  reads.length = 0;
  return { directory, workspace, storage, options, library, source, asset, index, original, record, reads, writes, files: path.join(workspace, '.xuzuo-assets/files') };
}

function parsedIndexes(assetId) {
  const original = JSON.parse, spy = vi.spyOn(JSON, 'parse').mockImplementation((...args) => original(...args));
  return () => spy.mock.calls.filter(([text]) => typeof text === 'string' && text.includes(assetId) && text.includes('"assets"')).length;
}
const metadata = f => f.library.list({ workspaceId: 'one', availabilityIds: [] });

describe('asset index cache reuses only fully read and content-verified metadata', () => {
  it('reuses one parse while every lookup still reads the complete index bytes', async () => {
    const f = await fixture(), parses = parsedIndexes(f.asset.id);
    await metadata(f); await metadata(f);
    await f.library.search({ workspaceId: 'one', query: 'cache-A', limit: 1 });
    await f.library.probe({ workspaceId: 'one', ids: [f.asset.id] });
    const source = await f.library.thumbnailSource({ workspaceId: 'one', id: f.asset.id });
    expect((await source.read()).buffer).toEqual(png);
    expect((await f.library.read({ workspaceId: 'one', id: f.asset.id })).buffer).toEqual(png);
    expect(f.reads).toHaveLength(7); expect(f.reads.every(read => read.bytes === f.original.length)).toBe(true);
    expect(parses()).toBe(1);
  });

  it('same-size external changes are observed even when the old modification time is restored', async () => {
    const f = await fixture(), parses = parsedIndexes(f.asset.id); await metadata(f);
    const before = await fs.stat(f.index), data = JSON.parse(f.original); data.assets[0].name = 'cache-B.png';
    const changed = Buffer.from(JSON.stringify(data, null, 2) + '\n'); expect(changed.length).toBe(f.original.length);
    await fs.writeFile(f.index, changed); await fs.utimes(f.index, before.atime, before.mtime);
    expect((await metadata(f))[0].name).toBe('cache-B.png'); expect(parses()).toBe(2);
    expect((await f.library.read({ workspaceId: 'one', id: f.asset.id })).buffer).toEqual(png);
  });

  it('a corrupt index after a warm read rejects instead of falling back to cached metadata', async () => {
    const f = await fixture(); await metadata(f); await fs.writeFile(f.index, '{owned-broken-index');
    await expect(metadata(f)).rejects.toThrow('索引无法读取');
    await expect(f.library.read({ workspaceId: 'one', id: f.asset.id })).rejects.toThrow('索引无法读取');
    await fs.writeFile(f.index, f.original); expect((await metadata(f))[0].id).toBe(f.asset.id);
    expect(await fs.readFile(f.source)).toEqual(png);
  });

  it('failed updates do not mutate a shared warm snapshot and a later successful update still applies', async () => {
    let deny = false;
    const fileSystem = { ...fs, rename: async (from, to) => { if (deny && path.basename(to) === 'library-v1.json') throw Error('owned commit rejected'); return fs.rename(from, to); } };
    const f = await fixture(fileSystem), previous = await metadata(f); deny = true;
    await expect(f.library.update({ workspaceId: 'one', id: f.asset.id, favorite: true })).rejects.toThrow('owned commit rejected');
    expect(await fs.readFile(f.index)).toEqual(f.original); expect(previous[0].favorite).toBe(false); expect((await metadata(f))[0].favorite).toBe(false);
    deny = false;
    expect((await f.library.update({ workspaceId: 'one', id: f.asset.id, favorite: true })).favorite).toBe(true);
    expect((await metadata(f))[0].favorite).toBe(true); expect(previous[0].favorite).toBe(false);
    expect((await f.library.update({ workspaceId: 'one', id: f.asset.id, archived: true })).archivedAt).toEqual(expect.any(String));
    await expect(f.library.read({ workspaceId: 'one', id: f.asset.id })).rejects.toThrow('回收站');
    await f.library.update({ workspaceId: 'one', id: f.asset.id, archived: false }); expect((await f.library.read({ workspaceId: 'one', id: f.asset.id })).buffer).toEqual(png);
  });

  it('a committed update with a lost acknowledgement is visible after the error', async () => {
    let lose = false;
    const fileSystem = { ...fs, rename: async (from, to) => { await fs.rename(from, to); if (lose && path.basename(to) === 'library-v1.json') { lose = false; throw Error('owned lost acknowledgement'); } } };
    const f = await fixture(fileSystem); await metadata(f); lose = true;
    await expect(f.library.update({ workspaceId: 'one', id: f.asset.id, favorite: true })).rejects.toThrow('owned lost acknowledgement');
    expect((await metadata(f))[0].favorite).toBe(true); expect(await fs.readFile(f.source)).toEqual(png);
  });

  it('keeps a single index snapshot per factory and never reuses it as another workspace', async () => {
    const f = await fixture(), second = path.join(f.directory, 'second'); await fs.mkdir(second);
    await f.storage.bindRoot({ workspaceId: 'two', name: '第二工作区', directory: second });
    const secondFiles = path.join(second, '.xuzuo-assets/files'); await fs.mkdir(secondFiles, { recursive: true });
    await fs.writeFile(path.join(second, '.xuzuo-assets/library-v1.json'), f.original); await fs.writeFile(path.join(secondFiles, f.record.fileName), png);
    const parses = parsedIndexes(f.asset.id);
    expect((await metadata(f))[0].workspaceId).toBe('one');
    expect((await f.library.list({ workspaceId: 'two', availabilityIds: [] }))[0].workspaceId).toBe('two');
    expect((await metadata(f))[0].workspaceId).toBe('one'); expect(parses()).toBe(3);
    await createAssetLibrary(f.options).list({ workspaceId: 'one', availabilityIds: [] }); expect(parses()).toBe(4);
    await expect(f.library.read({ workspaceId: 'unknown', id: f.asset.id })).rejects.toThrow();
  });

  it('does not retain indexes larger than8MiB', async () => {
    const f = await fixture(), data = JSON.parse(f.original); data.assets[0].ownedLargeMetadata = 'x'.repeat(8 * 1024 * 1024);
    await fs.writeFile(f.index, JSON.stringify(data) + '\n'); const parses = parsedIndexes(f.asset.id);
    await metadata(f); await metadata(f); expect(parses()).toBe(2);
  });

  it('a warm metadata cache still rejects missing files, leaf links and a replaced common directory', async () => {
    const f = await fixture(); await metadata(f);
    const file = path.join(f.files, f.record.fileName); await fs.unlink(file);
    expect(await f.library.probe({ workspaceId: 'one', ids: [f.asset.id] })).toEqual([{ id: f.asset.id, unavailable: true }]);
    await expect(f.library.read({ workspaceId: 'one', id: f.asset.id })).rejects.toThrow();
    const outside = path.join(f.directory, 'outside'); await fs.mkdir(outside);
    await fs.symlink(outside, file, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(f.library.read({ workspaceId: 'one', id: f.asset.id })).rejects.toThrow(/链接|普通文件/);
    await fs.rename(f.files, f.files + '-original'); await fs.symlink(outside, f.files, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(f.library.read({ workspaceId: 'one', id: f.asset.id })).rejects.toThrow(/junction|链接/);
    expect(await f.library.probe({ workspaceId: 'one', ids: [f.asset.id] })).toEqual([{ id: f.asset.id, unavailable: true }]);
  });

  it('a warm cache still checks original bytes SHA on every read and attach', async () => {
    const f = await fixture(); await metadata(f);
    const original = await f.library.read({ workspaceId: 'one', id: f.asset.id });
    const file = path.join(f.files, f.record.fileName), changed = Buffer.from(original.buffer); changed[changed.length - 10] ^= 1; await fs.writeFile(file, changed);
    await expect(f.library.read({ workspaceId: 'one', id: f.asset.id })).rejects.toThrow('内容已改变');
    await expect(f.library.attach({ workspaceId: 'one', id: f.asset.id, projectId: 'owned-project' })).rejects.toThrow('内容已改变'); expect(f.writes).toEqual([]);
    await fs.writeFile(file, original.buffer); await f.library.attach({ workspaceId: 'one', id: f.asset.id, projectId: 'owned-project' });
    expect(f.writes).toHaveLength(1); expect(digest(f.writes[0].buffer)).toBe(digest(png)); expect(await fs.readFile(f.source)).toEqual(png);
  });

  it('mutating returned provenance cannot change cached metadata or later read/search results', async () => {
    const f = await fixture(), data = JSON.parse(f.original);
    const provenance = { builtinId: 'owned-license', packId: 'fixture', origin: 'open-source', author: 'Owned Author', licenseId: 'MIT', licenseName: 'MIT', licenseUrl: 'https://example.com/license', sourceUrl: 'https://example.com/source', usageNote: 'Keep attribution', licenseNotice: 'Original notice' };
    data.assets[0].provenance = provenance; await fs.writeFile(f.index, JSON.stringify(data) + '\n');
    const [first] = await metadata(f); first.provenance.author = 'Changed caller value'; first.provenance.licenseNotice = 'Changed caller notice';
    const found = await f.library.search({ workspaceId: 'one', query: f.asset.id, limit: 1 });
    expect(found.items[0].provenance).toEqual(provenance);
    const read = await f.library.read({ workspaceId: 'one', id: f.asset.id }); read.provenance.author = 'Changed read result';
    expect((await metadata(f))[0].provenance).toEqual(provenance);
    const source = await f.library.thumbnailSource({ workspaceId: 'one', id: f.asset.id }); source.artifact.provenance.author = 'Changed thumbnail metadata';
    expect((await source.read()).provenance).toEqual(provenance);
    expect(JSON.parse(await fs.readFile(f.index, 'utf8')).assets[0].provenance).toEqual(provenance);
  });
});
