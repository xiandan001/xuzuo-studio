import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
const { createImageThumbnails } = require('../../electron/image-thumbnails.cjs');
const hash = value => createHash('sha256').update(value).digest('hex');
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" fill="blue"/></svg>');
const header = Buffer.from([71,73,70,56,57,97,1,0,1,0,128,0,0,255,0,0,0,0,255]);
const frame = Buffer.from([33,249,4,0,20,0,0,0,44,0,0,0,0,1,0,1,0,0,2,2,68,1,0]);
const gif = Buffer.concat([header, frame, frame, Buffer.from([59])]);
const roots = [];
afterEach(async () => {
  const base = await fs.realpath(os.tmpdir());
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== base || !path.basename(root).startsWith('xuzuo-project-format-') || (await fs.lstat(root)).isSymbolicLink() || await fs.realpath(root) !== root) throw Error('Unowned format fixture');
    await fs.rm(root, { recursive: true });
  }
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'xuzuo-project-format-')); roots.push(root);
  const writeFile = vi.fn(fs.writeFile), nativeImage = { createFromBuffer: vi.fn(() => { throw Error('Do not rasterize animation or vector'); }) };
  const store = createArtifactStore({ directory: path.join(root, 'artifacts') });
  const cache = createImageThumbnails({ directory: path.join(root, 'cache'), nativeImage, fileSystem: { ...fs, writeFile } });
  return { root, store, cache, writeFile, nativeImage };
}

it.each([['image/gif', gif], ['image/svg+xml', svg]])('项目%s通过真实受管来源保持原字节、动画/矢量，不调用位图编解码或写PNG缓存', async (mimeType, buffer) => {
  const f = await fixture(), file = await f.store.write({ name: mimeType === 'image/gif' ? 'animation.gif' : 'vector.svg', mimeType, projectId: 'project', runId: 'run', buffer });
  const original = hash(await fs.readFile(file.path));
  try {
    const first = await f.cache.getFrom(() => f.store.thumbnailSource(file.id));
    expect(first.mimeType).toBe(mimeType); expect(first.dataUrl.startsWith(`data:${mimeType};base64,`)).toBe(true);
    expect(Buffer.from(first.dataUrl.split(',')[1], 'base64')).toEqual(buffer); expect(first.artifact.id).toBe(file.id);
    expect((await f.cache.getFrom(() => f.store.thumbnailSource(file.id))).dataUrl).toBe(first.dataUrl);
    expect(f.nativeImage.createFromBuffer).not.toHaveBeenCalled(); expect(f.writeFile).not.toHaveBeenCalled();
    const status = await f.cache.drain(); expect(status.cacheFailures).toBe(0); expect(status.memoryBytes).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(hash(await fs.readFile(file.path))).toBe(original);
    const changed = Buffer.from(buffer); changed[changed.length - 2] ^= 1; await fs.writeFile(file.path, changed); await fs.utimes(file.path, new Date(), new Date(Date.now() + 1000));
    await expect(f.cache.getFrom(() => f.store.thumbnailSource(file.id))).rejects.toThrow('内容已在应用外改变');
    await fs.writeFile(file.path, buffer); await f.store.trash(file.id); await expect(f.cache.getFrom(() => f.store.thumbnailSource(file.id))).rejects.toThrow('回收站');
  } finally { await f.cache.drain(); await f.store.drain(); }
});

it.each([
  ['image/gif', Buffer.from('GIF89a malformed'), /GIF/],
  ['image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'), /SVG/],
  ['image/gif', (() => { const large = Buffer.from(gif); large.writeUInt16LE(4000, 6); return large; })(), /尺寸/],
])('项目预览拒绝%s非法或过大内容，不转成伪PNG', async (mimeType, buffer, message) => {
  const f = await fixture();
  try {
    await expect(f.cache.get({ key: mimeType + buffer.length, artifact: { kind: 'image', mimeType }, read: async () => ({ mimeType, buffer }) })).rejects.toThrow(message);
    expect(f.nativeImage.createFromBuffer).not.toHaveBeenCalled(); expect(f.writeFile).not.toHaveBeenCalled();
  } finally { await f.cache.drain(); }
});

it('不支持的图片格式在读取和解码前拒绝', async () => {
  const f = await fixture(), read = vi.fn();
  try {
    await expect(f.cache.get({ key: 'unsupported', artifact: { kind: 'image', mimeType: 'image/tiff' }, read })).rejects.toThrow('受管图片');
    expect(read).not.toHaveBeenCalled(); expect(f.nativeImage.createFromBuffer).not.toHaveBeenCalled(); expect(f.writeFile).not.toHaveBeenCalled();
  } finally { await f.cache.drain(); }
});
