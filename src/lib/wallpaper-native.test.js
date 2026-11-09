import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { describe, expect, it, vi } from 'vitest';
import { parseWallpaperTarget, wallpaperGenerationSize } from './wallpaper-target';
const require = createRequire(import.meta.url);
const { dependencies } = require('./production-test-fixtures.cjs');
const { PNG } = dependencies('pngjs');
const { createCpuTasks } = require('../../electron/cpu-tasks.cjs');
const { fitWallpaperPng } = require('../../electron/wallpaper-worker.cjs');
const { wallpaperTargetError, createWallpaperExporter } = require('../../electron/wallpaper-export.cjs');
const hash = value => createHash('sha256').update(value).digest('hex');
function picture() {
  const image = new PNG({ width: 4, height: 2 });
  for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) image.data.set(x < 2 ? [255, 0, 0, 128] : [0, 0, 255, 255], (y * 4 + x) * 4);
  return PNG.sync.write(image);
}
const pixel = (image, x, y) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
const target = { width: 64, height: 64, fit: 'cover' };

describe('真实 PNG 壁纸后台适配', () => {
  it.each([
    ['iPad Pro 11 M5', 2420, 1668],
    ['iPad Pro 11 M5 竖屏', 1668, 2420],
  ])('keeps parsed %s direction through model sizing and the actual PNG worker', async (text, width, height) => {
    const parsed = parseWallpaperTarget(text); expect(parsed.status).toBe('resolved');
    expect(parsed.target).toMatchObject({ width, height, deviceId: 'ipad-pro-11-m5' });
    const original = picture(), before = hash(original), tasks = createCpuTasks();
    for (const model of ['gpt-image-2.5-sunburst', 'gpt-image-2.6-sunburst']) {
      const [requestWidth, requestHeight] = wallpaperGenerationSize(parsed.target, model).split('x').map(Number);
      expect(requestWidth > requestHeight).toBe(width > height);
    }
    try {
      const output = PNG.sync.read(Buffer.from(await tasks.run('wallpaper', { buffer: original, target: parsed.target })));
      expect([output.width, output.height]).toEqual([width, height]);
      expect(hash(original)).toBe(before);
    } finally { await tasks.drain(); }
  });
  it('uses the actual CPU worker, keeps aspect and alpha-flattens without changing source bytes', async () => {
    const tasks = createCpuTasks(), buffer = picture(), before = hash(buffer);
    const output = Buffer.from(await tasks.run('wallpaper', { buffer, target })); await tasks.drain();
    const image = PNG.sync.read(output);
    expect([image.width, image.height]).toEqual([64, 64]); expect(pixel(image, 0, 0)).toEqual([128, 0, 0, 255]); expect(pixel(image, 63, 63)).toEqual([0, 0, 255, 255]); expect(hash(buffer)).toBe(before);
  });
  it('contain keeps the full source centered on opaque black rather than stretching it', () => {
    const image = PNG.sync.read(fitWallpaperPng({ buffer: picture(), target: { ...target, fit: 'contain' } }));
    expect(pixel(image, 0, 0)).toEqual([0, 0, 0, 255]); expect(pixel(image, 0, 16)).toEqual([128, 0, 0, 255]); expect(pixel(image, 63, 47)).toEqual([0, 0, 255, 255]); expect(pixel(image, 63, 63)).toEqual([0, 0, 0, 255]);
  });
  it.each([[1179, 2556], [2556, 1179], [2064, 2752]])('writes exact %ix%i pixels for device and rotated tablet targets', (width, height) => {
    const image = PNG.sync.read(fitWallpaperPng({ buffer: picture(), target: { width, height, fit: 'cover' } })); expect([image.width, image.height]).toEqual([width, height]); expect(pixel(image, 0, 0)[3]).toBe(255);
  });
  it.each([undefined, { width: 0, height: 64, fit: 'cover' }, { width: 64.5, height: 64, fit: 'cover' }, { width: 8193, height: 64, fit: 'cover' }, { width: 8192, height: 8192, fit: 'cover' }, { width: 64, height: 64, fit: 'stretch' }])('rejects invalid or unbounded targets before decoding', value => {
    expect(wallpaperTargetError(value)).toBeTypeOf('string'); expect(() => fitWallpaperPng({ buffer: picture(), target: value })).toThrow();
  });
  it('rejects fake/truncated PNG, vector/animation and huge source dimensions', () => {
    for (const buffer of [Buffer.from('GIF89a'), Buffer.from('<svg/>'), picture().subarray(0, 40)]) expect(() => fitWallpaperPng({ buffer, target })).toThrow();
    const huge = picture(); huge.writeUInt32BE(8192, 16); huge.writeUInt32BE(8192, 20); expect(() => fitWallpaperPng({ buffer: huge, target })).toThrow('像素');
  });
  it('never spawns a cancelled queued job and keeps the existing image-alpha queue usable', async () => {
    const created = [], controller = new AbortController();
    const tasks = createCpuTasks({ createWorker(file, options) { created.push(options.workerData.task); return new Worker(file, options); } });
    const first = tasks.run('image-alpha', { bitmap: Buffer.from([0, 0, 0, 255]), width: 1, height: 1 });
    const cancelled = tasks.run('wallpaper', { buffer: picture(), target }, { signal: controller.signal }); controller.abort();
    const results = await Promise.allSettled([first, cancelled]);
    expect(results[0]).toMatchObject({ status: 'fulfilled', value: { transparency: 'opaque' } }); expect(results[1]).toMatchObject({ status: 'rejected', reason: { name: 'AbortError' } }); expect(created).toEqual(['image-alpha']);
    expect(await tasks.run('image-alpha', { bitmap: Buffer.from([0, 0, 0, 0]), width: 1, height: 1 })).toMatchObject({ transparency: 'present' });
  });
  it('terminates an active wallpaper worker and releases the serial queue', async () => {
    let started; const admission = new Promise(resolve => { started = resolve; }), controller = new AbortController();
    const tasks = createCpuTasks({ createWorker(file, options) { const worker = new Worker(file, options); started(); return worker; } });
    const running = tasks.run('wallpaper', { buffer: picture(), target: { width: 3000, height: 3000, fit: 'cover' } }, { signal: controller.signal });
    const settled = running.catch(error => error); await admission; controller.abort(); expect(await settled).toMatchObject({ name: 'AbortError' });
    expect(await tasks.run('image-alpha', { bitmap: Buffer.from([0, 0, 0, 255]), width: 1, height: 1 })).toMatchObject({ transparency: 'opaque' });
  });
});

describe('壁纸导出只写本项目新产物', () => {
  function fixture() {
    const original = picture(), files = [1, 2].map(index => ({ id: `source-${index}`, projectId: 'project', runId: 'run', name: `原图-${index}.png`, kind: 'image', mimeType: 'image/png', buffer: original }));
    const readArtifact = vi.fn(async id => files.find(file => file.id === id));
    const writeArtifact = vi.fn(async input => ({ ...input, id: `derived-${writeArtifact.mock.calls.length}`, kind: 'image', bytes: input.buffer.length }));
    const fitWallpaper = vi.fn(async input => fitWallpaperPng(input));
    const exportWallpaper = createWallpaperExporter({ readArtifact, writeArtifact, fitWallpaper });
    const input = { kind: 'image', projectId: 'project', runId: 'run', title: '设备壁纸', assets: files, wallpaperTarget: target };
    return { files, input, readArtifact, writeArtifact, fitWallpaper, exportWallpaper, original };
  }
  it('returns two new timestamp-ready PNGs while keeping source buffers and metadata untouched', async () => {
    const f = fixture(), before = hash(f.original), outputs = await f.exportWallpaper(f.input);
    expect(outputs).toHaveLength(2); expect(outputs.map(file => file.id)).toEqual(['derived-1', 'derived-2']); expect(f.fitWallpaper).toHaveBeenCalledTimes(2); expect(f.files.every(file => hash(file.buffer) === before && file.mimeType === 'image/png')).toBe(true);
    for (const output of outputs) expect(PNG.sync.read(output.buffer)).toMatchObject({ width: 64, height: 64 });
  });
  it.each(['foreign-project', 'foreign-run', 'format', 'duplicate'])('blocks %s before any adaptation or write', async reason => {
    const f = fixture(); if (reason === 'foreign-project') f.files[1].projectId = 'other'; if (reason === 'foreign-run') f.files[1].runId = 'other'; if (reason === 'format') f.files[1].mimeType = 'image/gif'; if (reason === 'duplicate') f.input.assets = [f.files[0], f.files[0]];
    await expect(f.exportWallpaper(f.input)).rejects.toThrow(); expect(f.fitWallpaper).not.toHaveBeenCalled(); expect(f.writeArtifact).not.toHaveBeenCalled();
  });
  it('retains completed local outputs if a later fit fails; never mutates paid originals', async () => {
    const f = fixture(), before = hash(f.original); f.fitWallpaper.mockImplementationOnce(async input => fitWallpaperPng(input)).mockRejectedValueOnce(Error('本地适配失败'));
    await expect(f.exportWallpaper(f.input)).rejects.toMatchObject({ message: '本地适配失败', artifacts: [{ id: 'derived-1' }] }); expect(f.writeArtifact).toHaveBeenCalledTimes(1); expect(hash(f.original)).toBe(before);
  });
  it('does not write a late fit result after the export was cancelled', async () => {
    const f = fixture(), controller = new AbortController(); let finish;
    const held = new Promise(resolve => { finish = resolve; }); f.fitWallpaper.mockImplementationOnce(async () => held);
    const pending = f.exportWallpaper({ ...f.input, signal: controller.signal }); const caught = pending.catch(error => error);
    await vi.waitFor(() => expect(f.fitWallpaper).toHaveBeenCalledTimes(1)); controller.abort(); finish(fitWallpaperPng({ buffer: f.original, target }));
    expect(await caught).toMatchObject({ name: 'AbortError', artifacts: [] }); expect(f.writeArtifact).not.toHaveBeenCalled();
  });
});
