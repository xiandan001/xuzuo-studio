import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), { createImageThumbnails } = require('../../electron/image-thumbnails.cjs');
const base = path.resolve('work'), roots = [], hash = bytes => createHash('sha256').update(bytes).digest('hex');
const adapter = { createFromBuffer: () => ({ isEmpty: () => false, getSize: () => ({ width: 8, height: 8 }), resize: () => ({ toPNG: () => Buffer.from('owned-thumbnail'), toBitmap: () => Buffer.from([0, 0, 0, 255]) }) }) };
const source = key => ({ key, artifact: { id: key, kind: 'image', mimeType: 'image/png' }, read: async () => ({ buffer: Buffer.from('owned-original') }) });
afterEach(async () => { for (const root of roots.splice(0)) { if (path.dirname(root) !== base) throw Error('Unowned fixture'); await fs.rm(root, { recursive: true, force: true }); } });
async function fixture(count = 120) {
  await fs.mkdir(base, { recursive: true }); const root = await fs.mkdtemp(path.join(base, 'thumbnail-prune-')); roots.push(root);
  const directory = path.join(root, 'cache'); await fs.mkdir(directory);
  for (let index = 0; index < count; index++) {
    const key = hash('seed-' + index); await fs.writeFile(path.join(directory, key + '.png'), 'cached'); await fs.writeFile(path.join(directory, key + '.json'), '{}');
  }
  await fs.writeFile(path.join(directory, 'user-notes.txt'), 'preserve'); return { root, directory };
}

describe('thumbnail cache pruning preserves path protection with bounded leaf work', () => {
  it('a full120-entry cache stays within budget without repeated ancestor walks for every entry', async () => {
    const f = await fixture(); let lstat = 0, active = 0, peak = 0;
    const fileSystem = { ...fs, lstat: async (...args) => { lstat++; active++; peak = Math.max(peak, active); try { return await fs.lstat(...args); } finally { active--; } } };
    await createImageThumbnails({ directory: f.directory, nativeImage: adapter, fileSystem }).get(source('new'));
    expect((await fs.readdir(f.directory)).filter(name => name.endsWith('.png'))).toHaveLength(120);
    expect(await fs.readFile(path.join(f.directory, 'user-notes.txt'), 'utf8')).toBe('preserve');
    expect(lstat).toBeLessThan(600); expect(peak).toBeLessThanOrEqual(8);
  });
  it('leaf links stop cleanup and preserve their outside targets', async () => {
    const f = await fixture(0), outside = path.join(f.root, 'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'keep.txt'), 'outside');
    const link = path.join(f.directory, hash('linked') + '.png'); await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(createImageThumbnails({ directory: f.directory, nativeImage: adapter }).get(source('new'))).rejects.toThrow();
    expect(await fs.readFile(path.join(outside, 'keep.txt'), 'utf8')).toBe('outside'); await fs.unlink(link);
  });
  it('a directory replaced during the scan cannot delete any files through the new path', async () => {
    const f = await fixture(2), outside = path.join(f.root, 'outside'); await fs.mkdir(outside); let moved = false;
    const fileSystem = { ...fs, readdir: async (...args) => {
      const names = await fs.readdir(...args);
      if (args[0] === f.directory && !moved) {
        moved = true; await fs.rename(f.directory, f.directory + '-original');
        for (const name of names) await fs.copyFile(path.join(f.directory + '-original', name), path.join(outside, name));
        await fs.symlink(outside, f.directory, process.platform === 'win32' ? 'junction' : 'dir');
      }
      return names;
    } };
    await expect(createImageThumbnails({ directory: f.directory, nativeImage: adapter, fileSystem, maxEntries: 1 }).get(source('new'))).rejects.toThrow();
    expect((await fs.readdir(outside)).filter(name => name.endsWith('.png'))).toHaveLength(3);
    expect(await fs.readFile(path.join(outside, 'user-notes.txt'), 'utf8')).toBe('preserve'); await fs.unlink(f.directory);
  });
});
