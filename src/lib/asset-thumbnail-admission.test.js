import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url), root = fileURLToPath(new URL('../../', import.meta.url));
const { createAssetLibrary } = require('../../electron/asset-library.cjs');
const { createWorkspaceStorage } = require('../../electron/workspace-storage.cjs');
const { PNG } = createRequire(path.join(root, 'work/ui-build/package.json'))('pngjs');
const image = color => { const png = new PNG({ width: 1, height: 1 }); png.data.set(color); return PNG.sync.write(png); };
const blue = image([30, 100, 220, 255]), green = image([40, 170, 70, 255]);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const beforeRelease = promise => Promise.race([promise.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 1000))]);

async function fixture(fileSystem = fs) {
  const directory = await fs.mkdtemp(path.join(root, 'work/asset-thumbnail-admission-'));
  await fs.writeFile(path.join(directory, '.qa-owner.json'), JSON.stringify({ kind: 'asset-thumbnail-admission', directory }) + '\n');
  const workspace = path.join(directory, 'workspace'); await fs.mkdir(workspace);
  const storage = createWorkspaceStorage({ directory: path.join(directory, 'control') }); storage.setArtifactMigrator(async () => undefined);
  await storage.bindRoot({ workspaceId: 'one', name: '缩略图入队验收', directory: workspace });
  const source = path.join(directory, 'owned.png'); await fs.writeFile(source, blue);
  const library = createAssetLibrary({ workspaceStorage: storage, artifactStore: {}, fileSystem });
  await library.importPaths({ workspaceId: 'one', paths: Array.from({ length: 12 }, () => source) });
  await library.importPaths({ workspaceId: 'one', paths: Array.from({ length: 12 }, () => source) });
  const items = await library.list({ workspaceId: 'one', availabilityIds: [] });
  return { directory, workspace, storage, library, items, source };
}

async function heldBurst(kind) {
  const context = new AsyncLocalStorage(), release = deferred(); let hold = false, starts = 0, startsAtMetadata;
  const fileSystem = { ...fs, readFile: async (filename, ...args) => {
    if (path.basename(filename) === 'library-v1.json') {
      if (context.getStore() === kind) { starts++; if (hold && starts > 2) await release.promise; }
      if (context.getStore() === 'metadata') startsAtMetadata = starts;
    }
    return fs.readFile(filename, ...args);
  } };
  const f = await fixture(fileSystem), ids = f.items.map(item => item.id);
  const sources = kind === 'read' ? await Promise.all(ids.map(id => f.library.thumbnailSource({ workspaceId: 'one', id }))) : undefined;
  hold = true;
  const burst = Promise.all(ids.map((id, index) => context.run(kind, () => kind === 'read' ? sources[index].read() : f.library.thumbnailSource({ workspaceId: 'one', id }))));
  const metadata = context.run('metadata', () => f.library.list({ workspaceId: 'one', availabilityIds: [] }));
  const search = context.run('search', () => f.library.search({ workspaceId: 'one', query: 'owned', limit: 1 }));
  let continued;
  try { continued = await beforeRelease(Promise.all([metadata, search])); } finally { hold = false; release.resolve(); }
  const values = await burst; await metadata; await search;
  expect(continued).toBe(true); expect(startsAtMetadata).toBeLessThanOrEqual(2); expect(values).toHaveLength(24);
  if (kind === 'read') expect(values.every(value => value.buffer.equals(blue))).toBe(true);
}

describe('thumbnail readonly admission keeps interactive metadata responsive', () => {
  it('admits at most2 thumbnail lookups before metadata while the remaining burst can stay held', async () => {
    await heldBurst('source');
  });

  it('source.read shares the same admission bound and keeps every original byte verified', async () => {
    await heldBurst('read');
  });

  it('failed lookups and original reads release their slots for later requests', async () => {
    const f = await fixture();
    const values = await Promise.allSettled([...Array.from({ length: 4 }, () => f.library.thumbnailSource({ workspaceId: 'one', id: 'missing-owned-id' })), ...f.items.slice(0, 4).map(item => f.library.thumbnailSource({ workspaceId: 'one', id: item.id }))]);
    expect(values.filter(value => value.status === 'rejected')).toHaveLength(4);
    const sources = values.filter(value => value.status === 'fulfilled').map(value => value.value);
    await f.library.update({ workspaceId: 'one', id: f.items[0].id, archived: true });
    await expect(sources[0].read()).rejects.toThrow('回收站'); expect((await sources[1].read()).buffer).toEqual(blue);
    await f.library.flush();
  });

  it('flush waits for accepted lookup requests that have not reached the serial queue yet', async () => {
    const context = new AsyncLocalStorage(), entered = deferred(), release = deferred(); let hold = false;
    const fileSystem = { ...fs, readFile: async (filename, ...args) => { if (hold && context.getStore() === 'source' && path.basename(filename) === 'library-v1.json') { entered.resolve(); await release.promise; } return fs.readFile(filename, ...args); } };
    const f = await fixture(fileSystem); hold = true; let finished = 0;
    const requests = f.items.map(item => context.run('source', () => f.library.thumbnailSource({ workspaceId: 'one', id: item.id })).then(value => { finished++; return value; }));
    await entered.promise; let drained = false; const flushing = f.library.flush().then(() => { drained = true; });
    await new Promise(resolve => setTimeout(resolve, 10)); expect(drained).toBe(false);
    hold = false; release.resolve(); await flushing; expect(finished).toBe(24); await Promise.all(requests);
  });

  it('a rejected thumbnail does not let flush finish before other accepted requests drain', async () => {
    const context = new AsyncLocalStorage(), entered = deferred(), release = deferred(); let hold = false;
    const fileSystem = { ...fs, readFile: async (filename, ...args) => { if (hold && context.getStore() === 'held' && path.basename(filename) === 'library-v1.json') { entered.resolve(); await release.promise; } return fs.readFile(filename, ...args); } };
    const f = await fixture(fileSystem); hold = true;
    const bad = f.library.thumbnailSource({ workspaceId: 'one', id: 'missing-owned-id' }).catch(error => error);
    const requests = f.items.slice(0, 6).map(item => context.run('held', () => f.library.thumbnailSource({ workspaceId: 'one', id: item.id })));
    let state = 'waiting'; const flushing = f.library.flush().then(() => { state = 'drained'; }, () => { state = 'failed-early'; });
    await entered.promise; await bad; await new Promise(resolve => setTimeout(resolve, 10)); expect(state).toBe('waiting');
    hold = false; release.resolve(); await Promise.all(requests); await flushing; expect(state).toBe('drained');
  });

  it('mutation order is retained and queued lookups observe an archive completed before their admission', async () => {
    const context = new AsyncLocalStorage(), entered = deferred(), release = deferred(); let hold = false;
    const fileSystem = { ...fs, readFile: async (filename, ...args) => { if (hold && context.getStore() === 'source' && path.basename(filename) === 'library-v1.json') { entered.resolve(); await release.promise; } return fs.readFile(filename, ...args); } };
    const f = await fixture(fileSystem); hold = true;
    const requests = f.items.map(item => context.run('source', () => f.library.thumbnailSource({ workspaceId: 'one', id: item.id })).then(value => ({ value }), error => ({ error })));
    await entered.promise;
    const archived = f.library.update({ workspaceId: 'one', id: f.items.at(-1).id, archived: true });
    hold = false; release.resolve(); await archived;
    const values = await Promise.all(requests); expect(values.at(-1).error?.message).toMatch(/已回收/); expect(values.filter(value => value.error)).toHaveLength(1);
    const existing = values[0].value; await f.library.update({ workspaceId: 'one', id: f.items[0].id, archived: true });
    await expect(existing.read()).rejects.toThrow('回收站');
  });

  it('same-id requests across workspaces keep their own source path, content and thumbnail key', async () => {
    const f = await fixture(), other = path.join(f.directory, 'other'); await fs.mkdir(other);
    await f.storage.bindRoot({ workspaceId: 'two', name: '第二工作区', directory: other });
    const index = JSON.parse(await fs.readFile(path.join(f.workspace, '.xuzuo-assets/library-v1.json'), 'utf8')), record = { ...index.assets[0], sha256: createHash('sha256').update(green).digest('hex'), bytes: green.length };
    await fs.mkdir(path.join(other, '.xuzuo-assets/files'), { recursive: true }); await fs.writeFile(path.join(other, '.xuzuo-assets/library-v1.json'), JSON.stringify({ version: 1, assets: [record] }) + '\n'); await fs.writeFile(path.join(other, '.xuzuo-assets/files', record.fileName), green);
    const requests = await Promise.all(Array.from({ length: 12 }, (_, index) => f.library.thumbnailSource({ workspaceId: index % 2 ? 'two' : 'one', id: record.id })));
    const files = await Promise.all(requests.map(source => source.read()));
    for (let index = 0; index < files.length; index++) { expect(files[index].workspaceId).toBe(index % 2 ? 'two' : 'one'); expect(files[index].buffer).toEqual(index % 2 ? green : blue); }
    expect(requests[0].key).not.toBe(requests[1].key);
    await expect(f.library.thumbnailSource({ workspaceId: 'unknown', id: record.id })).rejects.toThrow();
  });
});
