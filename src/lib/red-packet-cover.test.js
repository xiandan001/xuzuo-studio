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
  const nativeImage = { createFromBuffer: vi.fn(() => ({ getSize: () => COVER_TARGET, isEmpty: () => false, toJPEG })) };
  const readArtifact = vi.fn(async () => source), cropPng = vi.fn(async () => cropped);
  const chooseSave = vi.fn(async () => ({ filePath: '/downloads/封面.jpg' }));
  const writeSave = vi.fn(async choice => ({ saved: true, path: choice.filePath }));
  const run = createRedPacketCoverExporter({ readArtifact, cropPng, nativeImage, chooseSave, writeSave });
  return { input, source, cropped, fakeEncoderJpeg, toJPEG, nativeImage, readArtifact, cropPng, chooseSave, writeSave, run };
}

describe('微信红包封面本地导出', () => {
  it('在后台线程做固定尺寸中心裁剪，透明区域以白色填充', async () => {
    const queue = createCpuTasks();
    try {
      const original = artwork();
      const cropped = Buffer.from(await queue.run('red-packet-cover', { buffer: original, target: { width: 512, height: 512 } }));
      const image = PNG.sync.read(cropped);
      expect([image.width, image.height]).toEqual([957, 1278]);
      const pixel = (x, y) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
      expect(pixel(0, 200)).toEqual([255, 255, 255, 255]);
      expect(pixel(0, 900)).toEqual([70, 140, 200, 255]);
      expect(pixel(956, 900)).toEqual([70, 140, 200, 255]);
      expect(original).toEqual(artwork());
    } finally { await queue.drain(); }
  });
  it('降低质量直至 JPEG 满足大小限制，保存经过验证的新文件', async () => {
    const f = fixture();
    expect(await f.run(f.input)).toEqual({ saved: true, path: '/downloads/封面.jpg' });
    expect(f.toJPEG.mock.calls).toEqual([[92], [84]]);
    expect(f.chooseSave.mock.calls[0][0].defaultPath).toBe('参考封面-微信红包封面-957x1278.jpg');
    expect(f.writeSave).toHaveBeenCalledExactlyOnceWith({ filePath: '/downloads/封面.jpg' }, f.fakeEncoderJpeg);
    expect(f.source.buffer).toEqual(artwork());
  });
  it('拒绝其他项目或错误格式的源图，取消即不写入', async () => {
    const f = fixture();
    await expect(f.run({ ...f.input, projectId: 'another-project' })).rejects.toThrow('本项目');
    f.readArtifact.mockResolvedValueOnce({ ...f.source, mimeType: 'image/jpeg' });
    await expect(f.run(f.input)).rejects.toThrow('静态 PNG 或 JPEG');
    expect(f.cropPng).not.toHaveBeenCalled();
    f.chooseSave.mockResolvedValueOnce({ canceled: true });
    expect(await f.run(f.input)).toEqual({ saved: false });
    expect(f.writeSave).not.toHaveBeenCalled();
  });
  it('拒绝错误尺寸、伪造 JPEG 及覆盖原图', async () => {
    const f = fixture();
    f.toJPEG.mockReturnValueOnce(f.cropped);
    await expect(f.run(f.input)).rejects.toThrow('尺寸和体积要求');
    f.nativeImage.createFromBuffer.mockReturnValueOnce({ getSize: () => ({ width: 100, height: 100 }), isEmpty: () => false });
    await expect(f.run(f.input)).rejects.toThrow('裁切尺寸');
    const source = { ...f.source, name: '参考封面.jpg', path: '/workspace/参考封面.jpg', mimeType: 'image/jpeg', buffer: f.fakeEncoderJpeg };
    f.readArtifact.mockResolvedValue(source);
    f.nativeImage.createFromBuffer.mockReturnValueOnce({ isEmpty: () => false, toPNG: () => f.source.buffer });
    f.chooseSave.mockResolvedValueOnce({ filePath: source.path });
    await expect(f.run(f.input)).rejects.toThrow('避免覆盖封面原图');
    expect(f.writeSave).not.toHaveBeenCalled();
  });
});
