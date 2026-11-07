import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
const { createSvgReference } = require('../../electron/svg-reference.cjs');
const { dependencies } = require('./production-test-fixtures.cjs');
const { PNG } = dependencies('pngjs');
const directories = [];
const svg = (width = 1024, height = 32) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><path fill="red" d="M0 0h10v10H0z"/></svg>`);
function png(width = 2048, height = 64) { return PNG.sync.write(new PNG({ width, height })); }
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-svg-reference-')); directories.push(directory);
  const artifactStore = createArtifactStore({ directory, loadModule: dependencies });
  const sourceBytes = svg(), source = await artifactStore.write({ projectId: 'project', name: '导入的矢量图.svg', mimeType: 'image/svg+xml', buffer: sourceBytes });
  const write = vi.spyOn(artifactStore, 'write'), prepare = createSvgReference({ artifactStore, loadModule: dependencies });
  const input = { projectId: 'project', sourceArtifactId: source.id };
  return { directory, artifactStore, sourceBytes, source, write, prepare, input };
}
afterEach(async () => { for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });

describe('local SVG reference admission and managed PNG derivation', () => {
  it('accepts imported static SVG without producer records, returns original bytes and bounded target', async () => {
    const f = await fixture(), result = await f.prepare(f.input);
    expect(result).toMatchObject({ sourceArtifactId: f.source.id, mimeType: 'image/svg+xml', width: 2048, height: 64, sourceSha256: createHash('sha256').update(f.sourceBytes).digest('hex') });
    expect(Buffer.from(result.sourceBytes)).toEqual(f.sourceBytes); expect(f.write).not.toHaveBeenCalled();
    const icon = await f.artifactStore.write({ projectId: 'project', name: '图标.svg', mimeType: 'image/svg+xml', buffer: svg(24, 24) });
    expect(await f.prepare({ ...f.input, sourceArtifactId: icon.id })).toMatchObject({ width: 2048, height: 2048 });
  });
  it('writes a separate validated PNG and keeps source bytes, source record and no runId', async () => {
    const f = await fixture(), context = await f.prepare(f.input), bytes = png();
    const result = await f.prepare({ ...f.input, sourceSha256: context.sourceSha256, pngBytes: Uint8Array.from(bytes) });
    expect(result.reference).toMatchObject({ projectId: 'project', mimeType: 'image/png', kind: 'image' });
    expect(result.reference.id).not.toBe(f.source.id); expect(result.reference.runId).toBeUndefined(); expect(result.sourceBytes).toBeUndefined();
    expect((await f.artifactStore.read(result.reference.id)).buffer).toEqual(bytes); expect((await f.artifactStore.read(f.source.id)).buffer).toEqual(f.sourceBytes);
    expect(f.write).toHaveBeenCalledTimes(1);
  });
  it('rejects a source changed between phases even when its new registration is valid', async () => {
    const f = await fixture(), context = await f.prepare(f.input), changed = svg(1024, 32).toString().replace('red', 'blue');
    const source = { ...f.source, buffer: Buffer.from(changed) };
    vi.spyOn(f.artifactStore, 'read').mockResolvedValue(source);
    await expect(f.prepare({ ...f.input, sourceSha256: context.sourceSha256, pngBytes: png() })).rejects.toThrow('内容已变化'); expect(f.write).not.toHaveBeenCalled();
  });
  it('rejects foreign, removed, disguised and unsafe sources before returning SVG bytes', async () => {
    const f = await fixture();
    await expect(f.prepare({ ...f.input, projectId: 'foreign' })).rejects.toThrow('本项目');
    const read = vi.spyOn(f.artifactStore, 'read');
    for (const changes of [{ trashedAt: 'now' }, { unavailable: true }, { mimeType: 'image/png' }, { buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>bad()</script></svg>') }, { buffer: svg(999999, 999999) }]) {
      read.mockResolvedValueOnce({ ...f.source, buffer: f.sourceBytes, ...changes }); await expect(f.prepare(f.input)).rejects.toThrow();
    }
    expect(f.write).not.toHaveBeenCalled();
  });
  it('requires the verified source hash and exact PNG target dimensions in phase two', async () => {
    const f = await fixture(), context = await f.prepare(f.input);
    for (const changes of [{ sourceSha256: undefined, pngBytes: png() }, { sourceSha256: 'a'.repeat(64), pngBytes: png() }, { sourceSha256: context.sourceSha256, pngBytes: png(1024, 32) }, { sourceSha256: context.sourceSha256, pngBytes: f.sourceBytes }, { sourceSha256: context.sourceSha256, pngBytes: 'data:image/png;base64,AA==' }]) await expect(f.prepare({ ...f.input, ...changes })).rejects.toThrow();
    expect(f.write).not.toHaveBeenCalled();
  });
  it('fully decodes PNG rather than accepting a plausible header and tail', async () => {
    const f = await fixture(), context = await f.prepare(f.input), broken = png(); broken[broken.length - 18] ^= 255;
    await expect(f.prepare({ ...f.input, sourceSha256: context.sourceSha256, pngBytes: broken })).rejects.toThrow(); expect(f.write).not.toHaveBeenCalled();
  });
});
