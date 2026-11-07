import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { createImageReferenceNormalizer } = require('../../electron/image-reference-normalization.cjs');
const { dependencies } = require('./production-test-fixtures.cjs');
const { PNG } = dependencies('pngjs');
// Synthetic nativeImage JPEG; real decoding is checked by the standalone Electron fixture.
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAB//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJgAtOz/2Q==', 'base64');
const WEBP = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
const png = (width = 1, height = 1) => PNG.sync.write(new PNG({ width, height }));
function fixture() {
  const image = { isEmpty: vi.fn(() => false), getSize: vi.fn(() => ({ width: 1, height: 1 })), toPNG: vi.fn(() => png()) };
  const nativeImage = { createFromBuffer: vi.fn(() => image) };
  return { image, nativeImage, normalize: createImageReferenceNormalizer({ nativeImage }) };
}

describe('local raster normalization admission (injected decoder contract)', () => {
  it.each([['PNG', png()], ['JPEG', JPEG], ['WebP', WEBP]])('uses actual %s bytes, ignores stale MIME and never mutates the source', async (_, buffer) => {
    const f = fixture(), input = { buffer, mimeType: 'image/png' }, before = Buffer.from(buffer);
    const result = await f.normalize(input);
    expect(result).toMatchObject({ mimeType: 'image/png', width: 1, height: 1 }); expect(f.nativeImage.createFromBuffer).toHaveBeenCalledWith(buffer);
    expect(buffer).toEqual(before); expect(input.mimeType).toBe('image/png'); expect(PNG.sync.read(result.buffer)).toMatchObject({ width: 1, height: 1 });
  });
  it('admits a complete JPEG with 24 non-empty trailing bytes only after native decode', async () => {
    const f = fixture(), bytes = Buffer.concat([JPEG, Buffer.alloc(24, 65)]), before = Buffer.from(bytes);
    await expect(f.normalize({ buffer: bytes, mimeType: 'image/png' })).resolves.toMatchObject({ mimeType: 'image/png', width: 1, height: 1 });
    expect(f.image.toPNG).toHaveBeenCalledTimes(1); expect(bytes).toEqual(before);
  });
  it.each([Buffer.from('GIF89a'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), Buffer.from('not an image'), Buffer.alloc(0), Buffer.alloc(32 * 1024 * 1024 + 1)])('rejects unknown, animated-vector and oversize byte candidates before native decode', async buffer => {
    const f = fixture(); await expect(f.normalize({ buffer, mimeType: 'image/png' })).rejects.toThrow(); expect(f.nativeImage.createFromBuffer).not.toHaveBeenCalled();
  });
  it('rejects huge image dimensions before any native pixel allocation', async () => {
    const f = fixture(), bytes = png(); bytes.writeUInt32BE(3000, 16); bytes.writeUInt32BE(3000, 20);
    await expect(f.normalize({ buffer: bytes })).rejects.toThrow('800万'); expect(f.nativeImage.createFromBuffer).not.toHaveBeenCalled();
  });
  it('rejects incomplete JPEG/PNG and excessive JPEG trailer before decode', async () => {
    for (const buffer of [JPEG.subarray(0, -2), Buffer.concat([JPEG, Buffer.alloc(1025, 65)]), png().subarray(0, -12)]) {
      const f = fixture(); await expect(f.normalize({ buffer })).rejects.toThrow(); expect(f.nativeImage.createFromBuffer).not.toHaveBeenCalled();
    }
  });
  it('rejects animated PNG and WebP without freezing their first frame', async () => {
    const frameControl = Buffer.alloc(20); frameControl.writeUInt32BE(8); frameControl.write('acTL', 4);
    const bitmap = png(), apng = Buffer.concat([bitmap.subarray(0, 33), frameControl, bitmap.subarray(33)]);
    const webp = Buffer.alloc(30); webp.write('RIFF'); webp.writeUInt32LE(22, 4); webp.write('WEBPVP8X', 8); webp.writeUInt32LE(10, 16); webp[20] = 2;
    for (const buffer of [apng, webp]) { const f = fixture(); await expect(f.normalize({ buffer })).rejects.toThrow('动画'); expect(f.nativeImage.createFromBuffer).not.toHaveBeenCalled(); }
  });
  it.each(['empty', 'throw', 'size', 'output-empty', 'output-type', 'output-size'])('rejects native decoder failure %s instead of forwarding an invalid PNG', async failure => {
    const f = fixture();
    if (failure === 'empty') f.image.isEmpty.mockReturnValue(true);
    if (failure === 'throw') f.nativeImage.createFromBuffer.mockImplementation(() => { throw Error('bad decode'); });
    if (failure === 'size') f.image.getSize.mockReturnValue({ width: 2, height: 1 });
    if (failure === 'output-empty') f.image.toPNG.mockReturnValue(Buffer.alloc(0));
    if (failure === 'output-type') f.image.toPNG.mockReturnValue(JPEG);
    if (failure === 'output-size') f.image.toPNG.mockReturnValue(png(2, 1));
    await expect(f.normalize({ buffer: JPEG })).rejects.toMatchObject({ code: 'INVALID_IMAGE_INPUT' });
  });
});
