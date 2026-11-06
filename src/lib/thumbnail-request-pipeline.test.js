import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url), { createImageThumbnails } = require('../../electron/image-thumbnails.cjs');
const hash = value => createHash('sha256').update(value).digest('hex');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const adapter = { createFromBuffer: buffer => {
  const item = JSON.parse(buffer.toString());
  return { isEmpty: () => false, getSize: () => ({ width: 8, height: 8 }), resize: () => ({ toPNG: () => Buffer.from('thumbnail:' + item.id), toBitmap: () => Buffer.from([0, 0, 0, 255]) }) };
} };
const source = id => ({ key: id, artifact: { id, kind: 'image', mimeType: 'image/png' }, read: async () => ({ buffer: Buffer.from(JSON.stringify({ id })) }) });

async function fixture({ entries = 3, maxEntries = 3, fileSystem = fs } = {}) {
  const root = await fs.mkdtemp(path.join(path.resolve('work'), 'thumbnail-pipeline-')), directory = path.join(root, 'cache');
  await fs.writeFile(path.join(root, '.qa-owner.json'), JSON.stringify({ kind: 'thumbnail-pipeline', root }) + '\n'); await fs.mkdir(directory);
  for (let index = 0; index < entries; index++) {
    const key = hash('seed-' + index), bytes = Buffer.from('seed-thumbnail');
    await fs.writeFile(path.join(directory, key + '.png'), bytes);
    await fs.writeFile(path.join(directory, key + '.json'), JSON.stringify({ version: 1, key, width: 8, height: 8, originalWidth: 8, originalHeight: 8, transparency: 'unknown', sha256: hash(bytes) }) + '\n');
  }
  await fs.writeFile(path.join(directory, 'user-notes.txt'), 'owned sentinel');
  return { root, directory, cache: createImageThumbnails({ directory, nativeImage: adapter, maxEntries, maxBytes: 1024, fileSystem }) };
}
async function budget(directory) {
  const names = await fs.readdir(directory), cacheFiles = names.filter(name => /^[a-f0-9]{64}\.(png|json)$/.test(name));
  let bytes = 0; for (const name of cacheFiles) bytes += (await fs.lstat(path.join(directory, name))).size;
  return { pngs: cacheFiles.filter(name => name.endsWith('.png')).length, bytes, temporary: names.filter(name => name.endsWith('.tmp')).length };
}

describe('thumbnail source admission and bounded deferred cleanup', () => {
  it('getFrom holds at most2 whole pipelines and drain includes unadmitted loaders', async () => {
    const f = await fixture(), entered = deferred(), release = deferred(); let loaded = 0;
    const requests = Array.from({ length: 8 }, (_, index) => f.cache.getFrom(async () => {
      loaded++; const item = source('source-' + index), read = item.read;
      item.read = async () => { entered.resolve(); await release.promise; return read(); }; return item;
    }));
    await entered.promise; expect(loaded).toBe(2);
    let drained = false; const draining = f.cache.drain().then(() => { drained = true; });
    await new Promise(resolve => setTimeout(resolve, 10)); expect(drained).toBe(false); expect(loaded).toBe(2);
    release.resolve(); const values = await Promise.all(requests); await draining;
    expect(values).toHaveLength(8); expect(loaded).toBe(8); expect((await budget(f.directory)).pngs).toBeLessThanOrEqual(3);
  });

  it('a24-write burst merges scans and never adds more than7 png/metadata pairs', async () => {
    let directory, scans = 0, peakPng = 0, peakMeta = 0;
    const fileSystem = { ...fs,
      readdir: async (...args) => { if (args[0] === directory) scans++; return fs.readdir(...args); },
      rename: async (from, to) => { await fs.rename(from, to); if (path.dirname(to) === directory) { const names = await fs.readdir(directory); peakPng = Math.max(peakPng, names.filter(name => name.endsWith('.png')).length); peakMeta = Math.max(peakMeta, names.filter(name => name.endsWith('.json')).length); } },
    };
    const f = await fixture({ fileSystem }); directory = f.directory;
    await Promise.all(Array.from({ length: 24 }, (_, index) => f.cache.get(source('burst-' + index))));
    await f.cache.drain();
    expect(scans).toBeLessThanOrEqual(5); expect(peakPng).toBeLessThanOrEqual(10); expect(peakMeta).toBeLessThanOrEqual(10);
    const final = await budget(directory); expect(final.pngs).toBeLessThanOrEqual(3); expect(final.bytes).toBeLessThanOrEqual(1024); expect(final.temporary).toBe(0);
    expect(await fs.readFile(path.join(directory, 'user-notes.txt'), 'utf8')).toBe('owned sentinel');
  });

  it('sequential direct get with explicit cache drain keeps the original entry-budget semantics', async () => {
    const f = await fixture({ entries: 2, maxEntries: 2 });
    for (let index = 0; index < 10; index++) { await f.cache.get(source('sequential-' + index)); await f.cache.drain(); expect((await budget(f.directory)).pngs).toBeLessThanOrEqual(2); }
  });

  it.each(['loader-error', 'invalid-source', 'read-error'])('last%s settles deferred cleanup even without a successful final image', async kind => {
    const written = deferred(); let metadataWrites = 0;
    const fileSystem = { ...fs, rename: async (...args) => { await fs.rename(...args); if (args[1].endsWith('.json') && ++metadataWrites === 3) written.resolve(); } };
    const f = await fixture({ fileSystem }), release = deferred();
    const good = Array.from({ length: 3 }, (_, index) => f.cache.getFrom(async () => source('good-' + index)));
    const last = f.cache.getFrom(async () => {
      await release.promise;
      if (kind === 'loader-error') throw Error('owned loader failed');
      if (kind === 'invalid-source') return { artifact: { kind: 'text' } };
      return { ...source('read-failed'), read: async () => { throw Error('owned read failed'); } };
    }).catch(error => error);
    await Promise.all(good); await written.promise; expect((await budget(f.directory)).pngs).toBeGreaterThan(3);
    release.resolve(); expect(await last).toBeInstanceOf(Error);
    await f.cache.drain();
    const final = await budget(f.directory); expect(final.pngs).toBeLessThanOrEqual(3); expect(final.temporary).toBe(0);
  });

  it('a partial metadata write failure cannot exceed the temporary bound or bypass final cleanup', async () => {
    let directory, peakPng = 0;
    const failName = hash('partial-6') + '.json';
    const fileSystem = { ...fs, rename: async (from, to) => {
      if (path.basename(to) === failName) throw Error('owned metadata commit failed');
      await fs.rename(from, to); if (path.dirname(to) === directory) peakPng = Math.max(peakPng, (await fs.readdir(directory)).filter(name => name.endsWith('.png')).length);
    } };
    const f = await fixture({ fileSystem }); directory = f.directory;
    const results = await Promise.allSettled(Array.from({ length: 24 }, (_, index) => f.cache.get(source('partial-' + index))));
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(0);
    const status = await f.cache.drain(); expect(status.cacheFailures).toBe(1); expect(status.errors.some(error => error.key === hash('partial-6'))).toBe(true); expect(peakPng).toBeLessThanOrEqual(10); const final = await budget(directory); expect(final.pngs).toBeLessThanOrEqual(3); expect(final.temporary).toBe(0);
  });

  it('drain enforces budget without prior generation and does not create an absent cache directory', async () => {
    const f = await fixture({ entries: 6, maxEntries: 2 }); await f.cache.drain(); expect((await budget(f.directory)).pngs).toBeLessThanOrEqual(2);
    const absent = path.join(f.root, 'not-created'), cache = createImageThumbnails({ directory: absent, nativeImage: adapter }); await cache.drain();
    await expect(fs.lstat(absent)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('source lookup failures release admission and cannot end drain before successful queued requests', async () => {
    const f = await fixture(), entered = deferred(), release = deferred();
    const bad = f.cache.getFrom(async () => { throw Error('owned lookup failed'); }).catch(error => error);
    const good = Array.from({ length: 6 }, (_, index) => f.cache.getFrom(async () => { entered.resolve(); await release.promise; return source('after-error-' + index); }));
    await entered.promise; await bad; let done = false; const draining = f.cache.drain().then(() => { done = true; });
    await new Promise(resolve => setTimeout(resolve, 10)); expect(done).toBe(false);
    release.resolve(); await Promise.all(good); await draining; expect(done).toBe(true); expect((await budget(f.directory)).pngs).toBeLessThanOrEqual(3);
  });
});
