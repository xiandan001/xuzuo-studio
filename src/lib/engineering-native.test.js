import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url), { dependencies } = require('./production-test-fixtures.cjs'), { PNG } = dependencies('pngjs');
const { createCpuTasks } = require('../../electron/cpu-tasks.cjs');
const { readEngineeringSource, createEngineeringExporter } = require('../../electron/engineering-export.cjs');
const { fitEngineeringPng } = require('../../electron/wallpaper-worker.cjs');
const { createImageReferenceNormalizer } = require('../../electron/image-reference-normalization.cjs');
const { createIdMap, remap } = require('../../electron/backup-format.cjs');
const hash = buffer => createHash('sha256').update(buffer).digest('hex');
// GDI+ encoded synthetic 64x128 solid-color JPEG; no user image is included.
const { JPEG } = require('./engineering-test-fixtures.cjs');
function png(width = 64, height = 128) { const image = new PNG({ width, height }); for (let at = 0; at < image.data.length; at += 4) image.data.set([255, 0, 0, 128], at); return PNG.sync.write(image); }
const pixel = (image, x, y) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
function fixture() {
  const reference = { id: 'reference', projectId: 'project', kind: 'image', mimeType: 'image/png', buffer: png() };
  const images = [1, 2].map(index => ({ id: `edited-${index}`, projectId: 'project', runId: 'run', kind: 'image', mimeType: 'image/png', buffer: png(4, 2) }));
  const readArtifact = vi.fn(async id => [reference, ...images].find(file => file.id === id)); let writes = 0;
  const writeArtifact = vi.fn(async input => ({ ...input, id: `output-${++writes}`, kind: 'image', bytes: input.buffer.length })), fitEngineering = vi.fn(async input => fitEngineeringPng(input));
  const input = { kind: 'image', projectId: 'project', runId: 'run', title: '工程照片', assets: images, attachmentIds: [reference.id, 'auxiliary'], engineeringReferenceId: reference.id };
  return { reference, images, readArtifact, writeArtifact, fitEngineering, input, exportEngineering: createEngineeringExporter({ readArtifact, writeArtifact, fitEngineering }) };
}
describe('工程主画布真实来源与原图兼容', () => {
  it('keeps the ordinary 8M admission cap while only the explicit native engineering limit accepts a real 16M PNG fixture', async () => {
    const buffer = PNG.sync.write(new PNG({ width: 4000, height: 4000 }));
    const decoder = { isEmpty: () => false, getSize: () => ({ width: 4000, height: 4000 }), toPNG: () => buffer };
    const nativeImage = { createFromBuffer: vi.fn(() => decoder) }, normalize = createImageReferenceNormalizer({ nativeImage });
    await expect(normalize({ buffer, mimeType: 'image/jpeg' })).rejects.toThrow('800万'); expect(nativeImage.createFromBuffer).not.toHaveBeenCalled();
    await expect(normalize({ buffer, mimeType: 'image/jpeg', maxPixels: 16000000 })).resolves.toMatchObject({ width: 4000, height: 4000 }); expect(nativeImage.createFromBuffer).toHaveBeenCalledTimes(1);
    const huge = Buffer.from(buffer); huge.writeUInt32BE(4001, 20); await expect(normalize({ buffer: huge, maxPixels: 16000000 })).rejects.toThrow('1600万');
    for (const maxPixels of [9000000, 16000001, 20000000, '16000000']) await expect(normalize({ buffer, maxPixels })).rejects.toThrow('像素上限无效'); expect(nativeImage.createFromBuffer).toHaveBeenCalledTimes(1);
  }, 15000);
  it('reads exact primary-reference dimensions and SHA while tolerating a JPEG mislabeled PNG with 24 trailer bytes', async () => {
    const f = fixture(); f.reference.buffer = Buffer.concat([JPEG, Buffer.alloc(24, 65)]); const before = Buffer.from(f.reference.buffer);
    expect(await readEngineeringSource(f.readArtifact, { projectId: 'project', referenceId: 'reference', attachmentIds: ['reference', 'auxiliary'] })).toEqual({ referenceId: 'reference', width: 64, height: 128, sha256: hash(before) }); expect(f.reference.buffer).toEqual(before); expect(f.reference.mimeType).toBe('image/png');
  });
  it.each(['not-first', 'foreign', 'gif', 'oversize', 'missing'])('rejects %s as the primary canvas', async reason => {
    const f = fixture(); if (reason === 'foreign') f.reference.projectId = 'other'; if (reason === 'gif') f.reference.buffer = Buffer.from('GIF89a'); if (reason === 'oversize') { f.reference.buffer.writeUInt32BE(8192, 16); f.reference.buffer.writeUInt32BE(8192, 20); } if (reason === 'missing') f.readArtifact.mockRejectedValueOnce(Error('原图不存在'));
    await expect(readEngineeringSource(f.readArtifact, { projectId: 'project', referenceId: 'reference', attachmentIds: [reason === 'not-first' ? 'auxiliary' : 'reference'] })).rejects.toThrow();
    if (reason === 'not-first') expect(f.readArtifact).not.toHaveBeenCalled();
  });
});
describe('工程后台适配保留完整画面与RGBA', () => {
  it('uses the actual CPU worker, keeps alpha and transparent margins without cropping or black fill', async () => {
    const tasks = createCpuTasks(), source = png(4, 2), before = hash(source), buffer = Buffer.from(await tasks.run('engineering', { buffer: source, target: { width: 64, height: 128, fit: 'contain' } })); await tasks.drain();
    const image = PNG.sync.read(buffer); expect([image.width, image.height]).toEqual([64, 128]); expect(pixel(image, 0, 0)).toEqual([0, 0, 0, 0]); expect(pixel(image, 32, 64)).toEqual([255, 0, 0, 128]); expect(hash(source)).toBe(before);
  });
  it('rejects cover instead of silently cropping engineering labels', () => { expect(() => fitEngineeringPng({ buffer: png(), target: { width: 64, height: 64, fit: 'cover' } })).toThrow(); });
  it('exports separate exact-size PNGs using native reference facts and preserves all source files', async () => {
    const f = fixture(), originals = [f.reference, ...f.images].map(file => hash(file.buffer)), outputs = await f.exportEngineering(f.input);
    expect(outputs).toHaveLength(2); expect(outputs.every(file => !['reference', 'edited-1', 'edited-2'].includes(file.id))).toBe(true);
    for (const output of outputs) { const image = PNG.sync.read(output.buffer); expect([image.width, image.height]).toEqual([64, 128]); expect(pixel(image, 32, 64)).toEqual([255, 0, 0, 128]); }
    expect([f.reference, ...f.images].map(file => hash(file.buffer))).toEqual(originals);
  });
  it('rejects a changed reference after fitting before any derivative write', async () => {
    const f = fixture(); f.fitEngineering.mockImplementationOnce(async input => { f.reference.buffer = png(128, 64); return fitEngineeringPng(input); });
    await expect(f.exportEngineering(f.input)).rejects.toThrow(/主原图|主画布/); expect(f.writeArtifact).not.toHaveBeenCalled();
  });
  it('cancelled late fitting cannot commit a derivative and retains earlier local outputs on failure', async () => {
    const f = fixture(), controller = new AbortController(); f.fitEngineering.mockImplementationOnce(async input => { controller.abort(); return fitEngineeringPng(input); });
    await expect(f.exportEngineering({ ...f.input, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError', artifacts: [] }); expect(f.writeArtifact).not.toHaveBeenCalled();
    const other = fixture(); other.fitEngineering.mockImplementationOnce(async input => fitEngineeringPng(input)).mockRejectedValueOnce(Error('工程本地适配失败'));
    await expect(other.exportEngineering(other.input)).rejects.toMatchObject({ artifacts: [{ id: 'output-1' }] });
  });
});
describe('工程备份引用重绑', () => {
  it('remaps engineering canvas and snapshot references in both directions while preserving pixels, SHA and prompt contents', () => {
    const value = { artifacts: [{ id: 'reference', projectId: 'project' }, { id: 'edited' }], workflow: { steps: [{ id: 'fit', engineeringReferenceId: 'reference', prompt: 'reference' }] }, attempts: [{ sourceArtifactIds: ['edited'], engineeringSource: { referenceId: 'reference', width: 64, height: 128, sha256: 'a'.repeat(64) } }], variables: { engineeringReferenceId: 'reference' } };
    const ids = createIdMap(value), restored = remap(value, ids), reversed = remap(restored, Object.fromEntries(Object.entries(ids).map(([oldId, newId]) => [newId, oldId])));
    expect(restored.workflow.steps[0].engineeringReferenceId).toBe(ids.reference); expect(restored.attempts[0].engineeringSource.referenceId).toBe(ids.reference); expect(restored.attempts[0].sourceArtifactIds).toEqual([ids.edited]); expect(restored.attempts[0].engineeringSource).toMatchObject({ width: 64, height: 128, sha256: 'a'.repeat(64) }); expect(restored.workflow.steps[0].prompt).toBe('reference'); expect(restored.variables).toEqual(value.variables); expect(reversed).toEqual(value);
  });
});
