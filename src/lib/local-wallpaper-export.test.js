import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url), { dependencies } = require('./production-test-fixtures.cjs');
const { PNG } = dependencies('pngjs');
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
const { createCpuTasks } = require('../../electron/cpu-tasks.cjs');
const { createLocalWallpaperExporter } = require('../../electron/local-wallpaper-export.cjs');
const directories = [], workers = [];
beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => { throw Error('4K adaptation must not call a provider'); })));
afterEach(async () => {
  expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
  for (const queue of workers.splice(0)) await queue.drain();
  for (const directory of directories.splice(0)) { expect(path.dirname(path.resolve(directory))).toBe(path.resolve(os.tmpdir())); expect(path.basename(directory).startsWith('xuzuo-4k-')).toBe(true); await fs.rm(directory, { recursive: true, force: true }); }
});
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-4k-')); directories.push(directory);
  const store = createArtifactStore({ directory, loadModule: dependencies }), queue = createCpuTasks(); workers.push(queue);
  const image = new PNG({ width: 80, height: 160 });
  for (let at = 0; at < image.data.length; at += 4) image.data.set([230, 40, 100, 255], at);
  const bytes = PNG.sync.write(image), source = await store.write({ projectId: 'project', runId: 'original-run', name: '原壁纸.png', mimeType: 'image/png', buffer: bytes });
  const onExport = vi.fn(async () => {}), fitWallpaper = vi.fn((input, options) => queue.run('wallpaper', input, options));
  const run = createLocalWallpaperExporter({ artifactStore: store, fitWallpaper, onExport });
  return { store, queue, source, bytes, onExport, fitWallpaper, run, input: { projectId: 'project', sourceArtifactId: source.id, orientation: 'portrait', fit: 'contain' } };
}
describe('actual local 4K wallpaper download preparation', () => {
  it.each([['portrait', 2160, 3840], ['landscape', 3840, 2160]])('creates a genuine %s 4K PNG in the production worker and keeps the original bytes', async (orientation, width, height) => {
    const f = await fixture(), result = await f.run({ ...f.input, orientation });
    const saved = await f.store.read(result.artifact.id), actual = PNG.sync.read(saved.buffer);
    expect([actual.width, actual.height]).toEqual([width, height]); expect(result.locallyAdapted).toBe(true);
    const center = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
    expect([...actual.data.subarray(center, center + 4)]).toEqual([230, 40, 100, 255]);
    expect((await f.store.read(f.source.id)).buffer).toEqual(f.bytes); expect(result.artifact.id).not.toBe(f.source.id); expect(result.artifact.runId).not.toBe('original-run');
    expect(f.onExport).toHaveBeenCalledOnce(); expect(f.onExport.mock.calls[0][0]).toMatchObject({ sourceArtifactId: f.source.id, target: { width, height }, runId: result.artifact.runId });
  });
  it('rejects foreign sources and invalid directions before doing expensive processing', async () => {
    const f = await fixture();
    await expect(f.run({ ...f.input, projectId: 'other' })).rejects.toThrow('本项目');
    await expect(f.run({ ...f.input, orientation: 'automatic' })).rejects.toThrow('方向'); expect(f.fitWallpaper).not.toHaveBeenCalled();
  });
  it('does not write a falsely labelled 4K file when the worker returns the wrong dimensions', async () => {
    const f = await fixture(), write = vi.spyOn(f.store, 'write');
    f.fitWallpaper.mockResolvedValue(f.bytes);
    await expect(f.run(f.input)).rejects.toThrow('尺寸'); expect(write).not.toHaveBeenCalled(); expect(f.onExport).not.toHaveBeenCalled();
  });
  it('honours cancellation before admission and after an in-flight fit without a late file or record', async () => {
    const f = await fixture(), first = new AbortController(); first.abort();
    await expect(f.run(f.input, { signal: first.signal })).rejects.toMatchObject({ name: 'AbortError' }); expect(f.fitWallpaper).not.toHaveBeenCalled();
    let release; f.fitWallpaper.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const write = vi.spyOn(f.store, 'write'), controller = new AbortController(), pending = f.run(f.input, { signal: controller.signal });
    await vi.waitFor(() => expect(f.fitWallpaper).toHaveBeenCalledOnce()); controller.abort(); release(new Uint8Array([1, 2]));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); expect(write).not.toHaveBeenCalled(); expect(f.onExport).not.toHaveBeenCalled();
  });
});
