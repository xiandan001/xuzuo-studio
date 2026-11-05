import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { createAssetLibrary } = require('../../electron/asset-library.cjs');
const { createWorkspaceStorage } = require('../../electron/workspace-storage.cjs');
const root = fileURLToPath(new URL('../../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
// This watchdog detects waiting on held I/O; absolute latency budgets are measured separately.
async function completedBeforeRelease(promise) {
  let timer;
  try { return await Promise.race([promise.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 2000); })]); }
  finally { clearTimeout(timer); }
}

async function fixture(fileSystem = fs) {
  const directory = await fs.mkdtemp(path.join(root, 'work/asset-list-test-'));
  await fs.writeFile(path.join(directory, '.qa-owner.json'), JSON.stringify({ kind: 'asset-list-test', directory }) + '\n');
  const workspace = path.join(directory, 'workspace'); await fs.mkdir(workspace);
  const storage = createWorkspaceStorage({ directory: path.join(directory, 'control') });
  storage.setArtifactMigrator(async () => undefined);
  await storage.bindRoot({ workspaceId: 'one', name: '列表性能验收', directory: workspace });
  const writes = [], options = { workspaceStorage: storage, artifactStore: { write: async value => { writes.push(value); return value; } }, fileSystem };
  const library = createAssetLibrary(options), source = path.join(directory, 'source.txt');
  await fs.writeFile(source, 'actual-content-END');
  const [asset] = await library.importPaths({ workspaceId: 'one', paths: [source] });
  const files = path.join(workspace, '.xuzuo-assets/files'), index = path.join(workspace, '.xuzuo-assets/library-v1.json');
  const original = JSON.parse(await fs.readFile(index, 'utf8')).assets[0];
  return { directory, workspace, storage, options, library, source, files, index, asset, original, writes };
}

async function seed(f, count) {
  const bytes = await fs.readFile(f.source), records = [f.original];
  for (let index = 1; index < count; index++) {
    const id = `fixture-${index}`, record = { ...f.original, id, name: `资料-${index}.txt`, fileName: `${id}-owned.txt` };
    await fs.writeFile(path.join(f.files, record.fileName), bytes, { flag: 'wx' }); records.push(record);
  }
  await fs.writeFile(f.index, JSON.stringify({ version: 1, assets: records }) + '\n');
  return records;
}

describe('asset list bounded filesystem probes and ordered metadata', () => {
  it('keeps all metadata and missing-file flags with at most8 concurrent leaves and no repeated ancestor walk', async () => {
    let files, monitoring = false, active = 0, peak = 0, stats = 0;
    const fileSystem = { ...fs, lstat: async filename => {
      if (!monitoring) return fs.lstat(filename);
      stats++;
      if (path.dirname(filename) !== files) return fs.lstat(filename);
      active++; peak = Math.max(peak, active);
      try { await new Promise(resolve => setImmediate(resolve)); return await fs.lstat(filename); } finally { active--; }
    } };
    const f = await fixture(fileSystem); files = f.files;
    const records = await seed(f, 128); await fs.unlink(path.join(files, records[3].fileName)); monitoring = true;
    const listed = await f.library.list({ workspaceId: 'one' });
    expect(listed).toHaveLength(128); expect(listed.filter(item => item.unavailable).map(item => item.id)).toEqual([records[3].id]);
    expect(peak).toBeLessThanOrEqual(8); expect(stats).toBeLessThan(220);
    expect(listed[0]).not.toHaveProperty('fileName'); expect(listed[0]).not.toHaveProperty('sha256');
  });

  it('metadata search returns before held list probes without reading asset bytes', async () => {
    const entered = deferred(), release = deferred(); let files, hold = false;
    const fileSystem = { ...fs, lstat: async filename => {
      if (hold && path.dirname(filename) === files) { entered.resolve(); await release.promise; }
      return fs.lstat(filename);
    } };
    const f = await fixture(fileSystem); files = f.files; hold = true;
    const listing = f.library.list({ workspaceId: 'one' }); await entered.promise;
    const searching = f.library.search({ workspaceId: 'one', query: f.asset.id, limit: 1 });
    let completed;
    try { completed = await completedBeforeRelease(searching); } finally { hold = false; release.resolve(); }
    expect((await listing)[0].unavailable).toBe(false); expect((await searching).items[0].id).toBe(f.asset.id);
    expect(completed).toBe(true);
  });

  it('concurrent update/import remain ordered and the late list includes their committed metadata', async () => {
    const entered = deferred(), release = deferred(); let files, hold = false;
    const fileSystem = { ...fs, lstat: async filename => {
      if (hold && path.dirname(filename) === files) { entered.resolve(); await release.promise; }
      return fs.lstat(filename);
    } };
    const f = await fixture(fileSystem); files = f.files; hold = true;
    const before = await fs.readFile(f.source), listing = f.library.list({ workspaceId: 'one' }); await entered.promise;
    const updating = f.library.update({ workspaceId: 'one', id: f.asset.id, favorite: true });
    const adding = f.library.importPaths({ workspaceId: 'one', paths: [f.source] });
    let completed;
    try { completed = await completedBeforeRelease(Promise.all([updating, adding])); } finally { hold = false; release.resolve(); }
    const [updated, [added], items] = await Promise.all([updating, adding, listing]);
    expect(completed).toBe(true); expect(updated.favorite).toBe(true);
    expect(items.map(item => item.id)).toEqual([added.id, f.asset.id]); expect(items.find(item => item.id === f.asset.id).favorite).toBe(true);
    expect(items.every(item => !item.unavailable)).toBe(true); expect(await fs.readFile(f.source)).toEqual(before);
    expect((await f.library.read({ workspaceId: 'one', id: added.id })).buffer).toEqual(before);
  });

  it('lost commit acknowledgement during a probe retains the committed import in the returned snapshot', async () => {
    const entered = deferred(), release = deferred(); let files, hold = false, loseAck = false;
    const fileSystem = { ...fs,
      lstat: async filename => { if (hold && path.dirname(filename) === files) { entered.resolve(); await release.promise; } return fs.lstat(filename); },
      rename: async (from, to) => { await fs.rename(from, to); if (loseAck && path.basename(to) === 'library-v1.json') { loseAck = false; throw Error('owned lost acknowledgement'); } },
    };
    const f = await fixture(fileSystem); files = f.files; hold = true;
    const listing = f.library.list({ workspaceId: 'one' }); await entered.promise; loseAck = true;
    const adding = f.library.importPaths({ workspaceId: 'one', paths: [f.source] }).catch(error => error);
    let completed;
    try { completed = await completedBeforeRelease(adding); } finally { hold = false; release.resolve(); }
    expect((await adding).message).toBe('owned lost acknowledgement'); expect(completed).toBe(true);
    expect(await listing).toHaveLength(2);
    for (const item of await f.library.list({ workspaceId: 'one' })) expect((await f.library.read({ workspaceId: 'one', id: item.id })).buffer.toString()).toBe('actual-content-END');
  });

  it('existing parent junction is unavailable without probing its external leaves', async () => {
    let files, leafReads = 0, monitoring = false;
    const fileSystem = { ...fs, lstat: async filename => { if (monitoring && path.dirname(filename) === files) leafReads++; return fs.lstat(filename); } };
    const f = await fixture(fileSystem); files = f.files;
    const outside = path.join(f.directory, 'outside'); await fs.mkdir(outside);
    const target = path.join(outside, f.original.fileName); await fs.writeFile(target, 'external-owned-sentinel');
    await fs.rename(files, files + '-original'); await fs.symlink(outside, files, process.platform === 'win32' ? 'junction' : 'dir'); monitoring = true;
    expect((await f.library.list({ workspaceId: 'one' }))[0].unavailable).toBe(true); expect(leafReads).toBe(0);
    await expect(f.library.read({ workspaceId: 'one', id: f.asset.id })).rejects.toThrow(/junction|链接/);
    expect(await fs.readFile(target, 'utf8')).toBe('external-owned-sentinel');
  });

  it('leaf reparse link and non-file entry are unavailable while normal siblings remain available', async () => {
    const f = await fixture(), records = await seed(f, 3);
    const target = path.join(f.directory, 'leaf-target'); await fs.mkdir(target);
    const linked = path.join(f.files, records[1].fileName); await fs.unlink(linked); await fs.symlink(target, linked, process.platform === 'win32' ? 'junction' : 'dir');
    const folder = path.join(f.files, records[2].fileName); await fs.unlink(folder); await fs.mkdir(folder);
    const items = await f.library.list({ workspaceId: 'one' });
    expect(items.map(item => item.unavailable)).toEqual([false, true, true]);
    await expect(f.library.read({ workspaceId: 'one', id: records[1].id })).rejects.toThrow(/链接|普通文件/);
  });

  it('parent junction introduced after a leaf stat invalidates the final result', async () => {
    let files, swap = false, target;
    const fileSystem = { ...fs, lstat: async filename => {
      const stat = await fs.lstat(filename);
      if (swap && path.dirname(filename) === files) { swap = false; await fs.rename(files, files + '-original'); await fs.symlink(target, files, process.platform === 'win32' ? 'junction' : 'dir'); }
      return stat;
    } };
    const f = await fixture(fileSystem); files = f.files; target = path.join(f.directory, 'outside'); await fs.mkdir(target);
    await fs.writeFile(path.join(target, f.original.fileName), 'external-owned-sentinel'); swap = true;
    expect((await f.library.list({ workspaceId: 'one' }))[0].unavailable).toBe(true);
    await expect(f.library.read({ workspaceId: 'one', id: f.asset.id })).rejects.toThrow(/junction|链接/);
  });

  it('replacing the common directory with another regular directory invalidates its earlier observations', async () => {
    let files, replace = false;
    const fileSystem = { ...fs, lstat: async filename => {
      const stat = await fs.lstat(filename);
      if (replace && path.dirname(filename) === files) { replace = false; await fs.rename(files, files + '-original'); await fs.mkdir(files); await fs.copyFile(path.join(files + '-original', path.basename(filename)), filename); }
      return stat;
    } };
    const f = await fixture(fileSystem); files = f.files; replace = true;
    expect((await f.library.list({ workspaceId: 'one' }))[0].unavailable).toBe(true);
    expect((await f.library.list({ workspaceId: 'one' }))[0].unavailable).toBe(false);
  });

  it('flush still waits for an accepted list even though its file probes release the metadata queue', async () => {
    const entered = deferred(), release = deferred(); let files, hold = false;
    const fileSystem = { ...fs, lstat: async filename => { if (hold && path.dirname(filename) === files) { entered.resolve(); await release.promise; } return fs.lstat(filename); } };
    const f = await fixture(fileSystem); files = f.files; hold = true;
    const listing = f.library.list({ workspaceId: 'one' }); await entered.promise;
    let drained = false;
    const flushing = f.library.flush().then(() => { drained = true; });
    await new Promise(resolve => setTimeout(resolve, 10)); expect(drained).toBe(false);
    hold = false; release.resolve(); await listing; await flushing; expect(drained).toBe(true);
  });

  it('foreign workspace/id and same-size content changes cannot bypass read/attach integrity', async () => {
    const f = await fixture(), other = path.join(f.directory, 'other'); await fs.mkdir(other);
    await f.storage.bindRoot({ workspaceId: 'two', name: '其他工作区', directory: other });
    expect(await f.library.list({ workspaceId: 'two' })).toEqual([]);
    await expect(f.library.list({ workspaceId: '../one' })).rejects.toThrow('工作区编号');
    await expect(f.library.list({ workspaceId: 'unknown' })).rejects.toThrow();
    await expect(f.library.read({ workspaceId: 'two', id: f.asset.id })).rejects.toThrow('不存在');
    const file = path.join(f.files, f.original.fileName), bytes = await fs.readFile(file), originalHash = hash(bytes); bytes[0] ^= 1; await fs.writeFile(file, bytes);
    expect((await f.library.list({ workspaceId: 'one' }))[0].unavailable).toBe(false);
    await expect(f.library.read({ workspaceId: 'one', id: f.asset.id })).rejects.toThrow('内容已改变');
    await f.storage.ensureProject({ projectId: 'owned-project', workspaceId: 'one', name: '只读完整性验收' });
    await expect(f.library.attach({ workspaceId: 'one', id: f.asset.id, projectId: 'owned-project' })).rejects.toThrow('内容已改变');
    expect(hash(await fs.readFile(f.source))).toBe(originalHash); expect(f.writes).toEqual([]);
  });
});

describe('explicit metadata-first lists and visible availability probes', () => {
  it('metadata-only lists return every own record without unavailable claims or any asset leaf checks', async () => {
    let files, monitor = false, leaves = 0;
    const fileSystem = { ...fs, lstat: async filename => { if (monitor && path.dirname(filename) === files) leaves++; return fs.lstat(filename); } };
    const f = await fixture(fileSystem); files = f.files; await seed(f, 128); monitor = true;
    const items = await f.library.list({ workspaceId: 'one', availabilityIds: [] });
    expect(items).toHaveLength(128); expect(leaves).toBe(0);
    expect(items.every(item => item.workspaceId === 'one' && !Object.hasOwn(item, 'unavailable'))).toBe(true);
    expect(items[0]).not.toHaveProperty('fileName'); expect(items[0]).not.toHaveProperty('sha256');
  });

  it('explicit ids check only visible active files; missing files and archived items return true in input order', async () => {
    let files, monitor = false, leaves = 0;
    const fileSystem = { ...fs, lstat: async filename => { if (monitor && path.dirname(filename) === files) leaves++; return fs.lstat(filename); } };
    const f = await fixture(fileSystem); files = f.files; const records = await seed(f, 5);
    await fs.unlink(path.join(files, records[1].fileName)); await f.library.update({ workspaceId: 'one', id: records[2].id, archived: true }); monitor = true;
    const ids = [records[1].id, records[2].id, records[0].id];
    const items = await f.library.list({ workspaceId: 'one', availabilityIds: ids });
    expect(items).toHaveLength(5); expect(leaves).toBe(2);
    expect(items.map(item => item.unavailable)).toEqual([false, true, true, undefined, undefined]);
    leaves = 0;
    expect(await f.library.probe({ workspaceId: 'one', ids })).toEqual([{ id: ids[0], unavailable: true }, { id: ids[1], unavailable: true }, { id: ids[2], unavailable: false }]);
    expect(leaves).toBe(2);
    expect(await f.library.probe({ workspaceId: 'one', ids: [] })).toEqual([]);
  });

  it('invalid, duplicate, excessive and foreign ids never probe another workspace or return foreign metadata', async () => {
    let files, monitor = false, leaves = 0;
    const fileSystem = { ...fs, lstat: async filename => { if (monitor && path.dirname(filename) === files) leaves++; return fs.lstat(filename); } };
    const f = await fixture(fileSystem); files = f.files;
    const other = path.join(f.directory, 'other'); await fs.mkdir(other); await f.storage.bindRoot({ workspaceId: 'two', name: '其他工作区', directory: other });
    const otherFiles = await fs.readdir(other); monitor = true;
    for (const ids of [null, undefined, 'not-an-array', ['../escape'], [f.asset.id, f.asset.id], Array.from({ length: 101 }, (_, index) => `item-${index}`)]) await expect(f.library.probe({ workspaceId: 'one', ids })).rejects.toThrow('最多100');
    await expect(f.library.list({ workspaceId: 'one', availabilityIds: null })).rejects.toThrow('最多100');
    await expect(f.library.probe({ workspaceId: 'two', ids: [f.asset.id] })).rejects.toThrow('不属于当前工作区或已移除');
    await expect(f.library.list({ workspaceId: 'one', availabilityIds: ['missing-owned-id'] })).rejects.toThrow('不属于当前工作区或已移除');
    await expect(f.library.probe({ workspaceId: '../one', ids: [] })).rejects.toThrow('工作区编号');
    expect(leaves).toBe(0); expect(await fs.readdir(other)).toEqual(otherFiles);
  });

  it('metadata bypasses a held legacy full scan and visible probes get8 fair slots before that scan finishes', async () => {
    const entered = deferred(), release = deferred(), probeReady = deferred(); let files, hold = false, active = 0, peak = 0, blocked = false, probeParents = 0;
    const fileSystem = { ...fs, lstat: async filename => {
      if (path.dirname(filename) !== files) {
        const stat = await fs.lstat(filename);
        if (hold && blocked && filename === files && ++probeParents === 2) probeReady.resolve();
        return stat;
      }
      active++; peak = Math.max(peak, active);
      try { if (hold) { blocked = true; entered.resolve(); await release.promise; } return await fs.lstat(filename); } finally { active--; }
    } };
    const f = await fixture(fileSystem); files = f.files; const records = await seed(f, 128); hold = true;
    let fullDone = false;
    const listing = f.library.list({ workspaceId: 'one' }).then(result => { fullDone = true; return result; }); await entered.promise;
    const metadata = f.library.list({ workspaceId: 'one', availabilityIds: [] });
    const ids = records.slice(-24).map(item => item.id), probing = f.library.probe({ workspaceId: 'one', ids });
    let metadataCompleted;
    try { metadataCompleted = await completedBeforeRelease(metadata); if (metadataCompleted) { await probeReady.promise; await new Promise(resolve => setImmediate(resolve)); } } finally { hold = false; release.resolve(); }
    const visible = await probing;
    expect(metadataCompleted).toBe(true); expect(fullDone).toBe(false); expect(visible).toEqual(ids.map(id => ({ id, unavailable: false })));
    expect(await listing).toHaveLength(128); expect(peak).toBeLessThanOrEqual(8);
  });

  it('probe retries an intervening archive/import commit and returns availability fields only', async () => {
    const entered = deferred(), release = deferred(); let files, hold = false;
    const fileSystem = { ...fs, lstat: async filename => { if (hold && path.dirname(filename) === files) { entered.resolve(); await release.promise; } return fs.lstat(filename); } };
    const f = await fixture(fileSystem); files = f.files; hold = true;
    const probing = f.library.probe({ workspaceId: 'one', ids: [f.asset.id] }); await entered.promise;
    await f.library.update({ workspaceId: 'one', id: f.asset.id, archived: true });
    const [added] = await f.library.importPaths({ workspaceId: 'one', paths: [f.source] });
    hold = false; release.resolve();
    expect(await probing).toEqual([{ id: f.asset.id, unavailable: true }]);
    expect((await f.library.list({ workspaceId: 'one', availabilityIds: [] })).map(item => item.id)).toEqual([added.id, f.asset.id]);
    await expect(f.library.read({ workspaceId: 'one', id: f.asset.id })).rejects.toThrow('回收站');
  });

  it('probe revalidates common/leaf links and flush waits for its accepted checks', async () => {
    const entered = deferred(), release = deferred(); let files, hold = false;
    const fileSystem = { ...fs, lstat: async filename => { if (hold && path.dirname(filename) === files) { entered.resolve(); await release.promise; } return fs.lstat(filename); } };
    const f = await fixture(fileSystem); files = f.files; hold = true;
    const probing = f.library.probe({ workspaceId: 'one', ids: [f.asset.id] }); await entered.promise;
    let drained = false; const flushing = f.library.flush().then(() => { drained = true; });
    await new Promise(resolve => setTimeout(resolve, 10)); expect(drained).toBe(false);
    const original = files + '-original', outside = path.join(f.directory, 'outside'); await fs.mkdir(outside);
    await fs.rename(files, original); await fs.symlink(outside, files, process.platform === 'win32' ? 'junction' : 'dir');
    hold = false; release.resolve();
    expect(await probing).toEqual([{ id: f.asset.id, unavailable: true }]); await flushing; expect(drained).toBe(true);
    expect(await f.library.list({ workspaceId: 'one', availabilityIds: [] })).toHaveLength(1);
    await expect(f.library.read({ workspaceId: 'one', id: f.asset.id })).rejects.toThrow(/junction|链接/);
  });
});
