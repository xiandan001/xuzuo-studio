import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { inspectImageReference, readImageReferencePreviews } from '../lib/image-reference-inspection';
import type { WorkflowRunner } from '../configuration-types';

type Reader = Pick<WorkflowRunner, 'previewArtifact' | 'inspectImageArtifact'>;
const refs = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `reference-${index}`, name: `参考${index}.png` }));
const url = (id: string) => `data:image/png;base64,${Buffer.from(id).toString('base64')}`;
const preview = (id: string) => ({ mimeType: 'image/png', dataUrl: url(id) });

describe('reference image checking and transport', () => {
  it('keeps the first original preview and inspects the other references in order', async () => {
    const order: string[] = [];
    const reader: Reader = {
      previewArtifact: vi.fn(async (id: string) => { order.push('preview:' + id); return preview(id); }),
      inspectImageArtifact: vi.fn(async (id: string) => { order.push('inspect:' + id); return { id, mimeType: 'image/png', bytes: 100 }; }),
    };
    expect(await readImageReferencePreviews(refs(3), reader, () => true)).toBe(url('reference-0'));
    expect(order).toEqual(['preview:reference-0', 'inspect:reference-1', 'inspect:reference-2']);
  });

  it('retains full-preview validation when the native inspection capability is absent', async () => {
    const read = vi.fn(async (id: string) => preview(id));
    expect(await readImageReferencePreviews(refs(3), { previewArtifact: read }, () => true)).toBe(url('reference-0'));
    expect(read.mock.calls.map(call => call[0])).toEqual(refs(3).map(item => item.id));
  });

  it('does not schedule remaining reads or return a late first preview after scope cleanup', async () => {
    let release!: (value: ReturnType<typeof preview>) => void, current = true;
    const first = new Promise<ReturnType<typeof preview>>(resolve => { release = resolve; });
    const reader: Reader = { previewArtifact: vi.fn(() => first), inspectImageArtifact: vi.fn() };
    const checking = readImageReferencePreviews(refs(3), reader, () => current);
    current = false; release(preview('reference-0'));
    expect(await checking).toBeUndefined(); expect(reader.inspectImageArtifact).not.toHaveBeenCalled();
    expect(reader.previewArtifact).toHaveBeenCalledTimes(1);
  });

  it('stops scheduling after a pending metadata check leaves its project scope', async () => {
    let release!: (value: { id: string; mimeType: string; bytes: number }) => void, entered!: () => void, current = true;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const pending = new Promise<{ id: string; mimeType: string; bytes: number }>(resolve => { release = resolve; });
    const inspect = vi.fn(() => { entered(); return pending; });
    const checking = readImageReferencePreviews(refs(3), { previewArtifact: async (id: string) => preview(id), inspectImageArtifact: inspect }, () => current);
    await started; current = false; release({ id: 'reference-1', mimeType: 'image/png', bytes: 100 });
    expect(await checking).toBeUndefined(); expect(inspect).toHaveBeenCalledExactlyOnceWith('reference-1');
  });

  it.each([
    { id: 'wrong', mimeType: 'image/png', bytes: 100 },
    { id: 'reference-1', mimeType: 'image/svg+xml', bytes: 100 },
    { id: 'reference-1', mimeType: 'image/png', bytes: 20 * 1024 * 1024 + 1 },
    { id: 'reference-1', mimeType: 'image/png', bytes: 0 },
    { id: 'reference-1', mimeType: 'image/png', bytes: -1 },
  ])('rejects invalid lightweight inspection reply %j without scheduling later references', async inspected => {
    const inspect = vi.fn(async () => inspected);
    await expect(readImageReferencePreviews(refs(3), { previewArtifact: async (id: string) => preview(id), inspectImageArtifact: inspect }, () => true)).rejects.toThrow('检查结果不完整');
    expect(inspect).toHaveBeenCalledTimes(1);
  });

  it('does not replace a bad first original with a metadata-only success', async () => {
    const inspect = vi.fn();
    await expect(readImageReferencePreviews(refs(2), { previewArtifact: async () => ({ mimeType: 'image/png' }), inspectImageArtifact: inspect }, () => true)).rejects.toThrow('参考图片');
    expect(inspect).not.toHaveBeenCalled();
  });

  it('material precheck avoids a duplicate full preview before the first reference is displayed', async () => {
    const read = vi.fn(async (id: string) => preview(id)), inspect = vi.fn(async (id: string) => ({ id, mimeType: 'image/png', bytes: 100 }));
    const reference = refs(1);
    await inspectImageReference(reference[0].id, { previewArtifact: read, inspectImageArtifact: inspect });
    expect(read).not.toHaveBeenCalled();
    expect(await readImageReferencePreviews(reference, { previewArtifact: read, inspectImageArtifact: inspect }, () => true)).toBe(url(reference[0].id));
    expect(inspect).toHaveBeenCalledExactlyOnceWith(reference[0].id); expect(read).toHaveBeenCalledExactlyOnceWith(reference[0].id);
    expect(reference).toEqual(refs(1));
  });

  it.each([1, 6, 12])('records actual managed original reads and reply bytes for %s references', async count => {
    const require = createRequire(import.meta.url);
    const { createArtifactStore } = require('../../electron/artifact-store.cjs');
    const dependencyRoot = path.resolve('work/ui-build/package.json');
    const dependencies = createRequire(require('node:fs').existsSync(dependencyRoot) ? dependencyRoot : path.resolve('package.json'));
    const { PNG } = dependencies('pngjs');
    const image = new PNG({ width: 128, height: 128 }); let seed = 123456;
    for (let offset = 0; offset < image.data.length; offset += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      image.data[offset] = seed & 255; image.data[offset + 1] = seed >>> 8 & 255; image.data[offset + 2] = seed >>> 16 & 255; image.data[offset + 3] = 255;
    }
    const original = PNG.sync.write(image), canonicalTemp = await fs.realpath(os.tmpdir());
    const directory = await fs.mkdtemp(path.join(canonicalTemp, 'xuzuo-reference-transport-'));
    const originals = new Set<string>(); const reads: string[] = [], writes: string[] = [];
    let measurement: { base64Encodes: number } | undefined;
    const fileSystem = {
      ...fs,
      readFile: async (...args: Parameters<typeof fs.readFile>) => {
        const filename = args[0], original = typeof filename === 'string' && originals.has(path.resolve(filename)), counter = measurement;
        if (original) reads.push(filename as string);
        const result = await fs.readFile(...args);
        if (original && counter && Buffer.isBuffer(result)) {
          const toString = result.toString;
          Object.defineProperty(result, 'toString', { value: function (this: Buffer, encoding?: BufferEncoding, start?: number, end?: number) { if (encoding === 'base64') counter.base64Encodes++; return toString.call(this, encoding, start, end); } });
        }
        return result;
      },
      writeFile: async (...args: Parameters<typeof fs.writeFile>) => { writes.push(String(args[0])); return fs.writeFile(...args); },
    };
    const store = createArtifactStore({ directory, fileSystem });
    try {
      const files = [];
      for (let index = 0; index < count; index++) {
        const file = await store.write({ projectId: 'project', name: `reference-${index}.png`, mimeType: 'image/png', buffer: original });
        files.push(file); originals.add(path.resolve(file.path));
      }
      const references = files.map(file => ({ id: file.id, name: file.name }));
      const manifest = await fs.readFile(path.join(directory, 'manifest-v1.json')); writes.length = 0;
      const measure = async (lightweight: boolean) => {
        reads.length = 0; let replyBytes = 0, previews = 0, inspections = 0;
        const counter = { base64Encodes: 0 }; measurement = counter;
        const started = performance.now();
        const previewArtifact = async (id: string) => { const result = await store.preview(id), reply = { mimeType: result.artifact.mimeType, ...result }; previews++; replyBytes += Buffer.byteLength(JSON.stringify(reply)); return reply; };
        const inspectImageArtifact = async (id: string) => { const result = await store.inspectImageArtifact(id); inspections++; replyBytes += Buffer.byteLength(JSON.stringify(result)); return result; };
        try {
          const first = await readImageReferencePreviews(references, { previewArtifact, ...(lightweight ? { inspectImageArtifact } : {}) }, () => true);
          return { first, previews, inspections, base64Encodes: counter.base64Encodes, originalReads: reads.length, replyBytes, elapsedMs: performance.now() - started };
        } finally { measurement = undefined; }
      };
      const before = await measure(false), after = await measure(true);
      expect(after.first).toBe(before.first); expect(before.previews).toBe(count); expect(after.previews).toBe(1); expect(after.inspections).toBe(count - 1);
      expect(before.base64Encodes).toBe(count); expect(after.base64Encodes).toBe(1);
      expect(before.originalReads).toBe(count); expect(after.originalReads).toBe(count);
      if (count > 1) expect(after.replyBytes).toBeLessThan(before.replyBytes / (count - 1)); else expect(after.replyBytes).toBe(before.replyBytes);
      console.log('REFERENCE_TRANSPORT_MEASUREMENT ' + JSON.stringify({ count, fileBytes: original.length, before: { ...before, first: undefined }, after: { ...after, first: undefined }, scope: 'Actual managed-file checks and serialized replies; not Native UI latency' }));
      expect(writes).toEqual([]); expect(await fs.readFile(path.join(directory, 'manifest-v1.json'))).toEqual(manifest);
      for (const file of files) expect(await fs.readFile(file.path)).toEqual(original);
    } finally {
      await store.drain();
      expect(path.dirname(directory)).toBe(canonicalTemp); expect(path.basename(directory)).toMatch(/^xuzuo-reference-transport-/); expect((await fs.lstat(directory)).isSymbolicLink()).toBe(false);
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
