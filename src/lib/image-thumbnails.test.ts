import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const { createImageThumbnails } = require('../../electron/image-thumbnails.cjs');
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
const roots: string[] = [], base = path.resolve('work');
afterEach(async () => { for (const root of roots.splice(0)) { if (path.dirname(root) !== base || !(await fs.realpath(root)).toLowerCase().startsWith(base.toLowerCase() + path.sep)) throw Error('Unowned fixture'); await fs.rm(root, { recursive: true, force: true }); } });
async function fixture() { const root = await fs.mkdtemp(path.join(base, 'thumbnail-test-')); roots.push(root); return root; }
function imageAdapter() {
  return { createFromBuffer: vi.fn((buffer: Buffer) => { const source = JSON.parse(buffer.toString()); return { isEmpty: () => false, getSize: () => ({ width: source.width, height: source.height }), resize: ({ width, height }: { width: number; height: number }) => ({ toPNG: () => Buffer.from(`thumb:${width}:${height}:${source.name}`), toBitmap: () => Buffer.from([0, 0, 0, source.alpha ? 100 : 255]) }) }; }) };
}
function source(key: string, alpha = false) { return { key, artifact: { id: key, kind: 'image', mimeType: 'image/png' }, read: vi.fn(async () => ({ buffer: Buffer.from(JSON.stringify({ width: 1200, height: 600, name: key, alpha })) })) }; }

describe('受管缩略图保持比例、隔离缓存且保留原始完整性检查', () => {
  it('并发只生成一次，320像素小图持久化后可不重读原图，透明标记仅正向', async () => {
    const root = await fixture(), adapter = imageAdapter(), first = source('one', true), cache = createImageThumbnails({ directory: path.join(root, 'cache'), nativeImage: adapter });
    const result = await Promise.all([cache.get(first), cache.get(first)]); expect(first.read).toHaveBeenCalledTimes(1);
    expect(result[0]).toMatchObject({ width: 320, height: 160, originalWidth: 1200, originalHeight: 600, transparency: 'present', thumbnail: true });
    await cache.drain();
    const restarted = createImageThumbnails({ directory: path.join(root, 'cache'), nativeImage: imageAdapter() }), same = source('one'); await restarted.get(same); expect(same.read).not.toHaveBeenCalled();
    const opaque = await restarted.get(source('two')); expect(opaque.transparency).toBe('unknown'); await restarted.drain();
  });
  it('条数预算只清理可识别缓存文件，不碰原图和其他文件；缓存损坏可重建', async () => {
    const root = await fixture(), directory = path.join(root, 'cache'); await fs.mkdir(directory); const sentinel = path.join(directory, 'user-notes.txt'); await fs.writeFile(sentinel, 'preserve');
    const cache = createImageThumbnails({ directory, nativeImage: imageAdapter(), maxEntries: 2, maxBytes: 1024 });
    for (const id of ['a', 'b', 'c']) await cache.get(source(id));
    await cache.drain();
    expect((await fs.readdir(directory)).filter(name => name.endsWith('.png'))).toHaveLength(2); expect(await fs.readFile(sentinel, 'utf8')).toBe('preserve');
    const key = createHash('sha256').update('c').digest('hex'); await fs.writeFile(path.join(directory, key + '.json'), '{bad');
    const next = source('c'), restarted = createImageThumbnails({ directory, nativeImage: imageAdapter() }); await restarted.get(next); expect(next.read).toHaveBeenCalledTimes(1); await restarted.drain();
  });
  it('缓存不能绕过外部删改、大小/Hash不符和回收状态', async () => {
    const root = await fixture(), store = createArtifactStore({ directory: path.join(root, 'artifacts') }), cache = createImageThumbnails({ directory: path.join(root, 'cache'), nativeImage: imageAdapter() });
    const file = await store.write({ name: 'actual.png', mimeType: 'image/png', buffer: Buffer.from(JSON.stringify({ width: 1200, height: 600, name: 'original' })) });
    await cache.get(await store.thumbnailSource(file.id));
    const original = await fs.readFile(file.path); await fs.writeFile(file.path, Buffer.alloc(original.length, 120));
    await expect(cache.get(await store.thumbnailSource(file.id))).rejects.toThrow('内容已在应用外改变');
    await fs.writeFile(file.path, original); await store.trash(file.id); await expect(store.thumbnailSource(file.id)).rejects.toThrow('回收站');
    await cache.drain();
  });
  it('缓存目录链接被拒绝，外部目标不写入', async () => {
    const root = await fixture(), outside = path.join(root, 'outside'), directory = path.join(root, 'cache'); await fs.mkdir(outside);
    await fs.symlink(outside, directory, process.platform === 'win32' ? 'junction' : 'dir');
    const item = source('safe'); await expect(createImageThumbnails({ directory, nativeImage: imageAdapter() }).get(item)).rejects.toThrow();
    expect(await fs.readdir(outside)).toEqual([]); expect(item.read).not.toHaveBeenCalled(); await fs.unlink(directory);
  });
});
