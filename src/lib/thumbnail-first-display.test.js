import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createImageThumbnails } = require('../../electron/image-thumbnails.cjs');
const adapter = { createFromBuffer: () => ({ isEmpty: () => false, getSize: () => ({ width: 8, height: 8 }), resize: () => ({ toPNG: () => Buffer.from('validated-preview'), toBitmap: () => Buffer.from([0, 0, 0, 255]) }) }) };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

describe('thumbnail preview and optional cache have separate completion boundaries', () => {
  it('a slow cache rename does not hold a validated preview, while drain still waits', async () => {
    const base = path.resolve('work'); await fs.mkdir(base, { recursive: true });
    const root = await fs.mkdtemp(path.join(base, 'thumbnail-first-display-'));
    const directory = path.join(root, 'cache'), key = 'preview-before-cache';
    const target = path.join(directory, createHash('sha256').update(key).digest('hex') + '.png');
    const entered = deferred(), release = deferred();
    const fileSystem = { ...fs, rename: async (from, to) => { if (to === target) { entered.resolve(); await release.promise; } return fs.rename(from, to); } };
    const service = createImageThumbnails({ directory, nativeImage: adapter, fileSystem });
    let delivered = false, drained = false, originalReads = 0, drain;
    const request = service.get({ key, artifact: { id: 'owned-original', kind: 'image', mimeType: 'image/png' }, read: async () => { originalReads++; return { buffer: Buffer.from('verified-owned-original') }; } });
    request.then(() => { delivered = true; }, () => undefined);
    try {
      await entered.promise;
      drain = service.drain().then(() => { drained = true; });
      await new Promise(resolve => setImmediate(resolve));
      expect(originalReads).toBe(1);
      expect(delivered, 'optional disk-cache rename must not delay the preview response').toBe(true);
      expect(drained, 'shutdown must still account for unfinished cache persistence').toBe(false);
      const preview = await request;
      expect(preview.dataUrl).toBe('data:image/png;base64,' + Buffer.from('validated-preview').toString('base64'));
      expect(preview.originalWidth).toBe(8);
    } finally {
      release.resolve();
      await Promise.allSettled([request, ...(drain ? [drain] : [])]);
      await service.drain();
      if (path.dirname(root) !== base || await fs.realpath(root) !== root) throw Error('Unexpected fixture path');
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
