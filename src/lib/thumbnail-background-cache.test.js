import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), { createImageThumbnails } = require('../../electron/image-thumbnails.cjs');
const base = path.resolve('work'), hash = value => createHash('sha256').update(value).digest('hex');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function fixture(fileSystem = fs, options = {}) {
  const { testPngSize, ...cacheOptions } = options;
  const root = await fs.mkdtemp(path.join(base, 'thumbnail-background-')), directory = path.join(root, 'cache'); let reads = 0, decodes = 0;
  const adapter = { createFromBuffer: bytes => { decodes++; const name = bytes.toString(); return { isEmpty: () => false, getSize: () => ({ width: 1600, height: 900 }), resize: ({ width, height, quality }) => { expect({ width, height, quality }).toEqual({ width: 320, height: 180, quality: 'good' }); return { toPNG: () => testPngSize ? Buffer.alloc(testPngSize, 1) : Buffer.from('preview:' + name), toBitmap: () => Buffer.from([0, 0, 0, 255]) }; } }; } };
  const cache = createImageThumbnails({ directory, nativeImage: adapter, fileSystem, ...cacheOptions });
  return { root, directory, cache, source: key => ({ key, artifact: { id: key, kind: 'image', mimeType: 'image/png' }, read: async () => { reads++; return { buffer: Buffer.from(key) }; } }), stats: () => ({ reads, decodes }) };
}
async function dispose(f) { await f.cache.drain(); if (path.dirname(f.root) !== base || (await fs.realpath(f.root)).toLowerCase() !== f.root.toLowerCase()) throw Error('Unowned fixture'); await fs.rm(f.root, { recursive: true, force: true }); }

describe('bounded optional thumbnail cache persistence', () => {
  it('reserves no more than8 encoded buffers before source read/decode and drain includes all waiting requests', async () => {
    const entered = deferred(), release = deferred(); let first = true;
    const f = await fixture({ ...fs, rename: async (...args) => { if (first) { first = false; entered.resolve(); await release.promise; } return fs.rename(...args); } });
    const requests = Array.from({ length: 12 }, (_, index) => f.cache.get(f.source('bounded-' + index))); let drained = false;
    try {
      await entered.promise; await Promise.all(requests.slice(0, 8)); const draining = f.cache.drain().then(status => { drained = true; return status; });
      await new Promise(resolve => setImmediate(resolve)); expect(f.stats()).toEqual({ reads: 8, decodes: 8 }); expect(f.cache.cacheStatus()).toMatchObject({ pendingWrites: 8, reservedWrites: 8 }); expect(drained).toBe(false);
      release.resolve(); await Promise.all(requests); const status = await draining; expect(status).toMatchObject({ pendingWrites: 0, reservedWrites: 0, cacheFailures: 0, budgetVerified: true }); expect(f.stats().decodes).toBe(12);
    } finally { release.resolve(); await Promise.allSettled(requests); await dispose(f); }
  });
  it('same-key requests reuse the verified encoded result even after memory clear, with one read/decode/commit', async () => {
    const entered = deferred(), release = deferred(); let pngCommits = 0;
    const f = await fixture({ ...fs, rename: async (from, to) => { if (to.endsWith('.png')) { pngCommits++; entered.resolve(); await release.promise; } return fs.rename(from, to); } });
    try {
      const first = await f.cache.get(f.source('duplicate')); await entered.promise; f.cache.clear(); const other = await f.cache.get(f.source('duplicate')); expect(other.dataUrl).toBe(first.dataUrl); expect(f.stats()).toEqual({ reads: 1, decodes: 1 }); expect(pngCommits).toBe(1); expect(f.cache.cacheStatus().pendingWrites).toBe(1);
      release.resolve(); const status = await f.cache.drain(); expect(status.cacheFailures).toBe(0); expect(pngCommits).toBe(1);
    } finally { release.resolve(); await dispose(f); }
  });
  it('an already validated memory preview is not queued behind writer backpressure for other keys', async () => {
    const entered = deferred(), release = deferred(); let hold = false;
    const f = await fixture({ ...fs, rename: async (...args) => { if (hold) { entered.resolve(); await release.promise; } return fs.rename(...args); } }); let requests = [];
    try { await f.cache.get(f.source('warm-memory')); await f.cache.drain(); hold = true; requests = Array.from({ length: 10 }, (_, index) => f.cache.get(f.source('cold-pressure-' + index))); await entered.promise; await Promise.all(requests.slice(0, 8)); const ready = await Promise.race([f.cache.get(f.source('warm-memory')).then(() => true), new Promise(resolve => setImmediate(() => resolve(false)))]); expect(ready).toBe(true); }
    finally { hold = false; release.resolve(); await Promise.allSettled(requests); await dispose(f); }
  });
  it('cache commit failure keeps valid preview and resolves drain with bounded diagnostics and no temporary files', async () => {
    const f = await fixture({ ...fs, rename: async (from, to) => { if (to.endsWith('.json')) throw Object.assign(Error('owned metadata rename denied'), { code: 'EIO' }); return fs.rename(from, to); } });
    try { const preview = await f.cache.get(f.source('valid-before-failure')); expect(preview.originalWidth).toBe(1600); const status = await f.cache.drain(); expect(status.cacheFailures).toBe(1); expect(status.errors[0]).toMatchObject({ operation: 'write', code: 'EIO' }); expect(status.errors[0].message).toContain('owned metadata'); expect(status.budgetVerified).toBe(true); expect((await fs.readdir(f.directory)).filter(name => name.endsWith('.tmp'))).toEqual([]); }
    finally { await dispose(f); }
  });
  it('many failures retain at most8 bounded messages and do not lock future valid previews or shutdown', async () => {
    let failing = true;
    const f = await fixture({ ...fs, rename: async (...args) => { if (failing) throw Error('owned-' + 'x'.repeat(1000)); return fs.rename(...args); } });
    try { await Promise.all(Array.from({ length: 18 }, (_, index) => f.cache.get(f.source('failed-' + index)))); const failed = await f.cache.drain(); expect(failed.cacheFailures).toBe(18); expect(failed.errors).toHaveLength(8); expect(failed.errors.every(error => error.message.length <= 500)).toBe(true); failing = false; expect((await f.cache.get(f.source('recovered'))).width).toBe(320); const done = await f.cache.drain(); expect(done.pendingWrites).toBe(0); expect(done.budgetVerified).toBe(true); }
    finally { failing = false; await dispose(f); }
  });
  it('source failures still reject and release reserved capacity, without turning them into cache-success diagnostics', async () => {
    const f = await fixture();
    try { await expect(f.cache.get({ ...f.source('source-failed'), read: async () => { throw Error('original SHA mismatch'); } })).rejects.toThrow('original SHA mismatch'); expect(f.cache.cacheStatus().reservedWrites).toBe(0); expect((await f.cache.get(f.source('after-source-error'))).thumbnail).toBe(true); expect((await f.cache.drain()).cacheFailures).toBe(0); }
    finally { await dispose(f); }
  });
  it('budgetVerified does not reuse a prior clean snapshot while a new accepted source has reserved a writer slot', async () => {
    const f = await fixture();
    try { expect((await f.cache.drain()).budgetVerified).toBe(true); const item = f.source('new-budget-work'), read = item.read; item.read = async () => { expect(f.cache.cacheStatus().budgetVerified).toBe(false); return read(); }; await f.cache.get(item); expect((await f.cache.drain()).budgetVerified).toBe(true); }
    finally { await dispose(f); }
  });
  it('drain waits for an already scheduled idle prune after preview and writer have both finished', async () => {
    const entered = deferred(), release = deferred(); let first = true;
    const f = await fixture({ ...fs, readdir: async (...args) => { if (first) { first = false; entered.resolve(); await release.promise; } return fs.readdir(...args); } });
    try { await f.cache.get(f.source('prune-held')); await entered.promise; expect(f.cache.cacheStatus().pendingWrites).toBe(0); let done = false; const draining = f.cache.drain().then(status => { done = true; return status; }); await new Promise(resolve => setImmediate(resolve)); expect(done).toBe(false); release.resolve(); expect((await draining).budgetVerified).toBe(true); }
    finally { release.resolve(); await dispose(f); }
  });
  it('background buffering does not expand the existing32-entry/4MiB memory LRU', async () => {
    const f = await fixture(fs, { testPngSize: 120000 });
    try { await Promise.all(Array.from({ length: 20 }, (_, index) => f.cache.get(f.source('pressure-' + index)))); const status = await f.cache.drain(); expect(status.memoryEntries).toBeLessThan(20); expect(status.memoryEntries).toBeLessThanOrEqual(32); expect(status.memoryBytes).toBeLessThanOrEqual(4 * 1024 * 1024); expect(status.pendingPngBytes).toBe(0); expect(status.budgetVerified).toBe(true); }
    finally { await dispose(f); }
  });
  it('directory replacement after a temporary write never renames or cleans through the outside junction', async () => {
    let directory, outside, swapped = false, foreignTemporary;
    const fileSystem = { ...fs, writeFile: async (filename, ...args) => {
      const result = await fs.writeFile(filename, ...args);
      if (!swapped && directory && path.dirname(filename) === directory && filename.includes('.png.') && filename.endsWith('.tmp')) {
        swapped = true; await fs.rename(directory, directory + '-original'); foreignTemporary = path.join(outside, path.basename(filename)); await fs.writeFile(foreignTemporary, 'foreign temporary sentinel'); await fs.writeFile(path.join(outside, hash('directory-swap') + '.png'), 'foreign final sentinel'); await fs.symlink(outside, directory, process.platform === 'win32' ? 'junction' : 'dir');
      }
      return result;
    } };
    const f = await fixture(fileSystem); directory = f.directory; outside = path.join(f.root, 'outside'); await fs.mkdir(outside);
    try { expect((await f.cache.get(f.source('directory-swap'))).thumbnail).toBe(true); const status = await f.cache.drain(); expect(swapped).toBe(true); expect(status.cacheFailures).toBeGreaterThan(0); expect(status.budgetVerified).toBe(false); expect(await fs.readFile(foreignTemporary, 'utf8')).toBe('foreign temporary sentinel'); expect(await fs.readFile(path.join(outside, hash('directory-swap') + '.png'), 'utf8')).toBe('foreign final sentinel'); expect((await fs.readdir(outside)).length).toBe(2); }
    finally { if (swapped) await fs.unlink(directory); await dispose(f); }
  });
  it('exclusive temporary collision does not remove a file the writer did not create', async () => {
    let collision;
    const f = await fixture({ ...fs, writeFile: async (filename, bytes, options) => { if (filename.includes('.png.') && filename.endsWith('.tmp')) { await fs.writeFile(filename, 'foreign collision'); collision = filename; throw Object.assign(Error('owned injected collision'), { code: 'EEXIST' }); } return fs.writeFile(filename, bytes, options); } });
    try { await f.cache.get(f.source('collision')); const status = await f.cache.drain(); expect(status.cacheFailures).toBe(1); expect(await fs.readFile(collision, 'utf8')).toBe('foreign collision'); }
    finally { await dispose(f); }
  });
  it('successful rename consumes its temporary path and must not clean a newly created foreign file there', async () => {
    const recreated = [], cleanupAttempts = [];
    const f = await fixture({ ...fs, rename: async (from, to) => { await fs.rename(from, to); await fs.writeFile(from, 'foreign after successful rename', { flag: 'wx' }); recreated.push(from); }, unlink: async filename => { if (recreated.includes(filename)) cleanupAttempts.push(filename); return fs.unlink(filename); } });
    try { await f.cache.get(f.source('successful-rename')); const status = await f.cache.drain(); expect(status.cacheFailures).toBe(0); expect(recreated).toHaveLength(2); expect(cleanupAttempts).toEqual([]); for (const filename of recreated) expect(await fs.readFile(filename, 'utf8')).toBe('foreign after successful rename'); }
    finally { await dispose(f); }
  });
});
