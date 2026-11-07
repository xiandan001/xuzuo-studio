const { createHash } = require('node:crypto');
const { readRasterReferenceSize } = require('./image-reference-normalization.cjs');
const { imageType } = require('./image-output-formats.cjs');
const { beadDecodeSource, orientBeadBitmap } = require('./bead-raster-orientation.cjs');
const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,120}$/.test(value);
const abortError = () => Object.assign(new Error('拼豆操作已取消，原图和已保存图纸保留。'), { name: 'AbortError' });
function ensureBeadActive(signal) { if (signal?.aborted) throw abortError(); }
function raceBeadAbort(task, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', abort), abort = () => { cleanup(); reject(abortError()); };
    Promise.resolve(task).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  });
}
function createBeadSource({ artifactStore, nativeImage, maxEntries = 2, maxBytes = 8 * 1024 * 1024 }) {
  const cache = new Map(); let bytes = 0;
  function retain(key, value) {
    if (cache.has(key)) { bytes -= cache.get(key).cost; cache.delete(key); }
    const cost = value.raster.pixels.byteLength + value.preview.dataUrl.length * 2 + 512;
    if (cost <= maxBytes) { cache.set(key, { ...value, cost }); bytes += cost; }
    while (cache.size > maxEntries || bytes > maxBytes) { const first = cache.keys().next().value; bytes -= cache.get(first).cost; cache.delete(first); }
    return value;
  }
  async function read({ projectId, referenceId }, signal) {
    if (!validId(projectId) || !validId(referenceId)) throw Error('请先选择本项目的一张拼豆底图。');
    ensureBeadActive(signal); const file = await artifactStore.read(referenceId); ensureBeadActive(signal);
    if (file.id !== referenceId || file.projectId !== projectId || file.kind !== 'image' || file.trashedAt || file.unavailable || !['image/png', 'image/jpeg', 'image/webp'].includes(file.mimeType)) throw Error('拼豆底图必须是本项目可读取的静态PNG、JPEG或WebP，SVG/GIF不能直接制图。');
    const dimensions = readRasterReferenceSize(file.buffer);
    if (!Number.isInteger(dimensions.width) || !Number.isInteger(dimensions.height) || dimensions.width < 1 || dimensions.height < 1 || dimensions.width > 8192 || dimensions.height > 8192 || dimensions.width * dimensions.height > 16000000) throw Error('底图最大支持8192单边、1600万像素，请缩小后重新选择。');
    const sourceSha256 = createHash('sha256').update(file.buffer).digest('hex'), key = `${projectId}/${referenceId}/${sourceSha256}`;
    if (cache.has(key)) { const value = cache.get(key); cache.delete(key); cache.set(key, value); return value; }
    const prepared = beadDecodeSource(file.buffer), image = nativeImage.createFromBuffer(prepared.buffer), actual = image.getSize();
    if (image.isEmpty() || actual.width !== prepared.width || actual.height !== prepared.height) throw Error('底图不能完整解码或显示方向尺寸不一致，请另存为PNG后重新导入；原文件保留。');
    const ratio = Math.min(1, 1024 / actual.width, 1024 / actual.height), width = Math.max(1, Math.round(actual.width * ratio)), height = Math.max(1, Math.round(actual.height * ratio));
    const sampled = ratio < 1 ? image.resize({ width, height, quality: 'good' }) : image, pixels = Buffer.from(sampled.toBitmap());
    if (pixels.length !== width * height * 4) throw Error('底图采样像素不完整，请重新选择图片。');
    const oriented = orientBeadBitmap({ pixels, width, height }, prepared.orientation), display = prepared.orientation === 1 ? sampled : nativeImage.createFromBitmap(oriented.pixels, { width: oriented.width, height: oriented.height });
    const previewRatio = Math.min(1, 512 / oriented.width, 512 / oriented.height), previewImage = previewRatio < 1 ? display.resize({ width: Math.max(1, Math.round(oriented.width * previewRatio)), height: Math.max(1, Math.round(oriented.height * previewRatio)), quality: 'good' }) : display;
    const previewBytes = previewImage.toPNG();
    if (!previewBytes.length || previewBytes.length > 2 * 1024 * 1024 || imageType(previewBytes).mimeType !== 'image/png') throw Error('底图缩略预览生成失败，未返回原图大文件。');
    ensureBeadActive(signal);
    return retain(key, { preview: { referenceId, name: file.name, sourceSha256, originalWidth: dimensions.width, originalHeight: dimensions.height, dataUrl: `data:image/png;base64,${previewBytes.toString('base64')}` }, raster: { ...oriented, format: 'bgra', premultiplied: true } });
  }
  return { read, clear() { cache.clear(); bytes = 0; }, stats: () => ({ entries: cache.size, bytes, maxEntries, maxBytes }) };
}
module.exports = { createBeadSource, validId, ensureBeadActive, abortError, raceBeadAbort };
