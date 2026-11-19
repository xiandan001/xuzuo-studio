import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { dependencies } = require('./production-test-fixtures.cjs');
const { PNG } = dependencies('pngjs');
const { createCpuTasks } = require('../../electron/cpu-tasks.cjs');
const { COVER_TARGET, MAX_JPEG_BYTES, createRedPacketCoverExporter } = require('../../electron/red-packet-cover-export.cjs');
const { cropRedPacketCoverPng } = require('../../electron/wallpaper-worker.cjs');

function artwork() {
  const png = new PNG({ width: 120, height: 80 });
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const pixel = x < 28 || x >= 92 ? [255, 0, 0, 255] : y < 30 ? [20, 30, 40, 0] : [70, 140, 200, 255];
    png.data.set(pixel, (y * png.width + x) * 4);
  }
  return PNG.sync.write(png);
}
function fixture() {
  const source = { id: 'cover-artifact', projectId: 'cover-project', kind: 'image', name: '参考封面.png', path: '/workspace/参考封面.png', mimeType: 'image/png', buffer: artwork() };
  const input = { projectId: source.projectId, sourceArtifactId: source.id };
  const cropped = cropRedPacketCoverPng({ buffer: source.buffer });
  const fakeEncoderJpeg = Buffer.from([255, 216, 255, 224, 0, 2, 255, 192, 0, 11, 8, 4, 254, 3, 189, 1, 1, 17, 0, 255, 217]);
  const toJPEG = vi.fn(quality => quality > 84 ? Buffer.alloc(MAX_JPEG_BYTES + 1) : fakeEncoderJpeg);
  const bitmap = Buffer.alloc(COVER_TARGET.width * COVER_TARGET.height * 4);
  const nativeImage = { createFromBitmap: vi.fn(() => ({ isEmpty: () => false, toJPEG })), createFromBuffer: vi.fn(() => ({ isEmpty: () => false, getSize: () => COVER_TARGET, toBitmap: () => bitmap })) };
  const readArtifact = vi.fn(async () => source), composeBitmap = vi.fn(async () => bitmap);
  const chooseSave = vi.fn(async () => ({ filePath: '/downloads/封面.jpg' }));
  const writeSave = vi.fn(async choice => ({ saved: true, path: choice.filePath }));
  const run = createRedPacketCoverExporter({ readArtifact, composeBitmap, nativeImage, chooseSave, writeSave });
  return { input, source, cropped, fakeEncoderJpeg, toJPEG, nativeImage, readArtifact, composeBitmap, chooseSave, writeSave, run };
}

describe('微信红包封面本地导出', () => {
  it('后台固定成品尺寸，保留可见画面和白底透明像素', async () => {
    const queue = createCpuTasks();
    try {
      const original = artwork();
      const cropped = Buffer.from(await queue.run('red-packet-cover', { buffer: original, target: { width: 512, height: 512 } }));
      const image = PNG.sync.read(cropped);
      expect([image.width, image.height]).toEqual([957, 1278]);
      const pixel = (x, y) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
      expect(pixel(10, 170)).toEqual([255, 255, 255, 255]);
      expect(pixel(478, 900)).toEqual([70, 140, 200, 255]);
      expect(pixel(0, 900)).toEqual(pixel(956, 900));
      expect(original).toEqual(artwork());
    } finally { await queue.drain(); }
  });
  it('降低质量直至 JPEG 满足大小限制，保存经过验证的新文件', async () => {
    const f = fixture();
    const result = await f.run(f.input), written = f.writeSave.mock.calls[0][1];
    expect(result).toEqual({ saved: true, path: '/downloads/封面.jpg', width: 957, height: 1278, bytes: written.length });
    expect(f.toJPEG.mock.calls).toEqual([[92], [84]]);
    expect(f.chooseSave.mock.calls[0][0].defaultPath).toBe('参考封面-微信红包封面-957x1278.jpg');
    expect(written.includes(Buffer.from('ICC_PROFILE\0'))).toBe(true);
    expect(f.writeSave).toHaveBeenCalledExactlyOnceWith({ filePath: '/downloads/封面.jpg' }, written);
    expect(f.source.buffer).toEqual(artwork());
  });
  it('拒绝其他项目或错误格式的源图，取消即不写入', async () => {
    const f = fixture();
    await expect(f.run({ ...f.input, projectId: 'another-project' })).rejects.toThrow('本项目');
    f.readArtifact.mockResolvedValueOnce({ ...f.source, mimeType: 'image/jpeg' });
    await expect(f.run(f.input)).rejects.toThrow('静态 PNG 或 JPEG');
    expect(f.composeBitmap).not.toHaveBeenCalled();
    f.chooseSave.mockResolvedValueOnce({ canceled: true });
    expect(await f.run(f.input)).toEqual({ saved: false });
    expect(f.writeSave).not.toHaveBeenCalled();
  });
  it('拒绝错误尺寸、伪造 JPEG 及覆盖原图', async () => {
    const f = fixture();
    f.toJPEG.mockReturnValueOnce(f.cropped);
    await expect(f.run(f.input)).rejects.toThrow('尺寸和体积要求');
    f.composeBitmap.mockResolvedValueOnce(Buffer.alloc(100 * 100 * 4));
    await expect(f.run(f.input)).rejects.toThrow('排版尺寸');
    const source = { ...f.source, name: '参考封面.jpg', path: '/workspace/参考封面.jpg', mimeType: 'image/jpeg', buffer: f.fakeEncoderJpeg };
    f.readArtifact.mockResolvedValue(source);
    f.chooseSave.mockResolvedValueOnce({ filePath: source.path });
    await expect(f.run(f.input)).rejects.toThrow('避免覆盖封面原图');
    expect(f.writeSave).not.toHaveBeenCalled();
  });
  it('并行准备仅排版一次，预览、提示与保存内容来自同一份 JPEG', async () => {
    const f = fixture();
    const [a, b] = await Promise.all([f.run.prepare(f.input), f.run.prepare(f.input)]);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ width: 957, height: 1278, sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    const displayed = Buffer.from(a.dataUrl.split(',')[1], 'base64');
    expect(a.bytes).toBe(displayed.length);
    const confirmed = { ...f.input, preparedSha256: a.sha256, sourceSha256: a.sourceSha256 };
    await Promise.all([f.run(confirmed), f.run(confirmed)]);
    expect(f.composeBitmap).toHaveBeenCalledOnce();
    expect(f.chooseSave).toHaveBeenCalledOnce();
    expect(f.writeSave).toHaveBeenCalledOnce();
    expect(f.writeSave.mock.calls[0][1]).toEqual(displayed);
    expect(f.chooseSave.mock.calls[0][0].title).toContain(displayed.length + ' 字节');
  });
  it('预览失效时不打开保存窗口，保存窗口期间源发生变化时不写文件', async () => {
    const f = fixture(), preview = await f.run.prepare(f.input);
    await expect(f.run({ ...f.input, preparedSha256: '0'.repeat(64) })).rejects.toThrow('重新预览');
    const raster = PNG.sync.read(f.source.buffer);
    raster.data[0] ^= 1;
    const changed = { ...f.source, buffer: PNG.sync.write(raster) };
    f.readArtifact.mockResolvedValueOnce(changed);
    await expect(f.run({ ...f.input, preparedSha256: preview.sha256, sourceSha256: preview.sourceSha256 })).rejects.toThrow('重新预览');
    expect(f.chooseSave).not.toHaveBeenCalled();
    f.readArtifact.mockResolvedValueOnce(f.source).mockResolvedValueOnce(changed);
    await expect(f.run(f.input)).rejects.toThrow('原图已变化');
    expect(f.writeSave).not.toHaveBeenCalled();
  });
});
