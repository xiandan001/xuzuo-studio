import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url), { beadDecodeSource, orientBeadBitmap } = require('../../electron/bead-raster-orientation.cjs');
const { createBeadSource } = require('../../electron/bead-source.cjs'), { JPEG } = require('./engineering-test-fixtures.cjs'), { fakeImage, image, dependencies } = require('./bead-native-fixtures.cjs'), { PNG } = dependencies('pngjs'), { imageSize } = dependencies('image-size');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function exifJpeg(orientation) {
  const payload = Buffer.alloc(32); payload.write('Exif\0\0', 0, 'binary'); payload.write('II', 6, 'ascii'); payload.writeUInt16LE(42, 8); payload.writeUInt32LE(8, 10); payload.writeUInt16LE(1, 14); payload.writeUInt16LE(0x0112, 16); payload.writeUInt16LE(3, 18); payload.writeUInt32LE(1, 20); payload.writeUInt16LE(orientation, 24);
  const segment = Buffer.alloc(4); segment.writeUInt16BE(0xffe1); segment.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([JPEG.subarray(0, 2), segment, payload, JPEG.subarray(2)]);
}
const directions = [
  [1, [[1, 2], [3, 4], [5, 6]]], [2, [[2, 1], [4, 3], [6, 5]]],
  [3, [[6, 5], [4, 3], [2, 1]]], [4, [[5, 6], [3, 4], [1, 2]]],
  [5, [[1, 3, 5], [2, 4, 6]]], [6, [[5, 3, 1], [6, 4, 2]]],
  [7, [[6, 4, 2], [5, 3, 1]]], [8, [[2, 4, 6], [1, 3, 5]]],
];

describe('拼豆EXIF方向与原图保护', () => {
  it.each(directions)('maps every asymmetric 2×3 BGRA coordinate for EXIF %i', (orientation, rows) => {
    const pixels = Buffer.from([1, 2, 3, 4, 5, 6].flatMap(value => [value, value + 10, value + 20, 128])), before = hash(pixels);
    const result = orientBeadBitmap({ pixels, width: 2, height: 3 }, orientation);
    expect([result.width, result.height]).toEqual([rows[0].length, rows.length]);
    expect([...result.pixels]).toEqual(rows.flat().flatMap(value => [value, value + 10, value + 20, 128]));
    expect(hash(pixels)).toBe(before);
  });

  it.each(directions)('reads EXIF %i from a real JPEG without changing its original bytes or compressed image body', orientation => {
    const original = exifJpeg(orientation), before = hash(original), result = beadDecodeSource(original);
    expect(result).toMatchObject({ width: 64, height: 128, orientation });
    expect(imageSize(result.buffer)).toMatchObject({ width: 64, height: 128 });
    if (orientation !== 1) { expect(result.buffer.equals(JPEG)).toBe(true); expect(imageSize(result.buffer).orientation).toBeUndefined(); }
    expect(hash(original)).toBe(before);
  });

  it('uses oriented pixels for both raster and PNG preview when the decoder returns raw JPEG dimensions', async () => {
    const original = exifJpeg(6), before = hash(original), bitmap = image(64, 128, [0, 0, 0, 255]);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 64; x++) bitmap.data.set([x, y, 0, 255], (y * 64 + x) * 4);
    const nativeImage = { createFromBuffer(bytes) { expect(bytes.equals(JPEG)).toBe(true); return fakeImage(bitmap); }, createFromBitmap(bytes, { width, height }) { const output = image(width, height); for (let at = 0; at < bytes.length; at += 4) output.data.set([bytes[at + 2], bytes[at + 1], bytes[at], bytes[at + 3]], at); return fakeImage(output); } };
    const source = createBeadSource({ nativeImage, artifactStore: { read: async () => ({ id: 'reference', projectId: 'project', kind: 'image', mimeType: 'image/jpeg', name: 'oriented.jpg', buffer: original }) } });
    const result = await source.read({ projectId: 'project', referenceId: 'reference' }), preview = PNG.sync.read(Buffer.from(result.preview.dataUrl.split(',')[1], 'base64'));
    expect(result.preview).toMatchObject({ originalWidth: 128, originalHeight: 64, sourceSha256: before }); expect(result.raster).toMatchObject({ width: 128, height: 64, format: 'bgra', premultiplied: true });
    expect([preview.width, preview.height]).toEqual([128, 64]);
    expect([...preview.data.subarray(0, 4)]).toEqual([0, 127, 0, 255]); expect([...result.raster.pixels.subarray(0, 4)]).toEqual([0, 127, 0, 255]);
    expect([...preview.data.subarray(preview.data.length - 4)]).toEqual([63, 0, 0, 255]); expect(hash(original)).toBe(before);
  });

  it('retains bounded legacy JPEG trailing bytes while removing only the EXIF segment from the decode copy', () => {
    const trailer = Buffer.alloc(24, 65), original = Buffer.concat([exifJpeg(6), trailer]), before = hash(original);
    expect(beadDecodeSource(original).buffer.equals(Buffer.concat([JPEG, trailer]))).toBe(true); expect(hash(original)).toBe(before);
  });

  it('refuses to rotate a full-resolution bitmap beyond the bounded 1024-side sample', () => {
    expect(() => orientBeadBitmap({ pixels: Buffer.alloc(4), width: 4000, height: 4000 }, 6)).toThrow('采样');
  });
});
