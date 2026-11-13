const { createHash } = require('node:crypto');
const { readRasterReferenceSize } = require('./image-reference-normalization.cjs');
const { beadDecodeSource } = require('./bead-raster-orientation.cjs');
const { validId } = require('./commerce-image-document.cjs');
const { active } = require('./commerce-image-store.cjs');
function createCommerceRasterReader({ artifactStore, nativeImage, cpuTasks }) {
  const information = new Map();
  function retain(projectId, source) { const key = `${projectId}/${source.id}`; information.delete(key); information.set(key, { id: source.id, name: source.name, width: source.width, height: source.height, sha256: source.sha256 }); while (information.size > 64) information.delete(information.keys().next().value); }
  async function info(projectId, artifactId, signal) {
    if (![projectId, artifactId].every(validId)) throw Error('请选择本项目图片。'); active(signal);
    const metadata = (await artifactStore.list([artifactId]))[0];
    if (!metadata || metadata.projectId !== projectId || metadata.kind !== 'image' || metadata.trashedAt || metadata.unavailable || !['image/png', 'image/jpeg', 'image/webp'].includes(metadata.mimeType)) throw Error('图片不属于当前项目或已经不可用。');
    const key = `${projectId}/${artifactId}`, cached = information.get(key); if (cached) { information.delete(key); information.set(key, cached); return cached; }
    const file = await artifactStore.read(artifactId); active(signal); const size = readRasterReferenceSize(file.buffer); if (size.width > 8192 || size.height > 8192 || size.width * size.height > 16000000) throw Error('图片超过1600万像素。');
    const value = { id: file.id, name: file.name, width: size.width, height: size.height, sha256: createHash('sha256').update(file.buffer).digest('hex') }; retain(projectId, value); return value;
  }
  async function read(projectId, artifactId, signal) {
    if (![projectId, artifactId].every(validId)) throw Error('请选择本项目图片。'); active(signal);
    const file = await artifactStore.read(artifactId); active(signal);
    if (file.projectId !== projectId || file.kind !== 'image' || file.trashedAt || file.unavailable || !['image/png', 'image/jpeg', 'image/webp'].includes(file.mimeType) || !Buffer.isBuffer(file.buffer) || file.buffer.length > 32 * 1024 * 1024) throw Error('图层只接受本项目32MB以内可读取的PNG、JPEG或WebP。');
    const size = readRasterReferenceSize(file.buffer);
    if (size.width > 8192 || size.height > 8192 || size.width * size.height > 16000000) throw Error('图层图片合计单张最多1600万像素，单边不超过8192像素。');
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    let payload;
    if (file.buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) payload = { buffer: file.buffer };
    else {
      if (!nativeImage) throw Error('当前环境无法解码JPEG/WebP，请使用新版桌面应用。');
      const prepared = beadDecodeSource(file.buffer), image = nativeImage.createFromBuffer(prepared.buffer), actual = image.getSize();
      if (image.isEmpty() || actual.width !== prepared.width || actual.height !== prepared.height) throw Error('原图解码尺寸不一致，请重新导入原始图片。');
      payload = { bitmap: image.toBitmap(), width: actual.width, height: actual.height, orientation: prepared.orientation };
    }
    const result = { id: file.id, name: file.name, width: size.width, height: size.height, sha256, payload }; retain(projectId, result); active(signal); return result;
  }
  async function preview(projectId, artifactId, signal, options = {}) {
    const source = await read(projectId, artifactId, signal);
    if (options.expectedSha256 && options.expectedSha256 !== source.sha256) throw Error('图片原文件已变化，请重新载入工程，未改变导出来源。');
    const result = await cpuTasks.run('commerce-preview', { ...source.payload, ...(options.region ? { region: options.region, maxSide: options.maxSide } : {}) }, { signal }); active(signal);
    const buffer = Buffer.from(result.buffer);
    if (buffer.length > (options.region ? 4 : 2) * 1024 * 1024) throw Error('预览图片过大，请缩小视图后重试；原图与导出来源保持。');
    if (options.region) { const current = await artifactStore.read(artifactId); active(signal); if (current.projectId !== projectId || current.trashedAt || createHash('sha256').update(current.buffer).digest('hex') !== source.sha256) throw Error('预览期间原文件已变化，请重新载入工程。'); }
    return { id: source.id, name: source.name, width: source.width, height: source.height, sha256: source.sha256, previewDataUrl: 'data:image/png;base64,' + buffer.toString('base64'), ...(options.region ? { previewWidth: result.previewWidth, previewHeight: result.previewHeight, crop: result.crop } : {}) };
  }
  return { read, preview, info };
}
module.exports = { createCommerceRasterReader };
