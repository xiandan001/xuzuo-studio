const { randomUUID, createHash } = require('node:crypto');
const { imageType, rasterDimensions } = require('./image-output-formats.cjs');
const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(value);
function active(signal) { if (signal?.aborted) throw Object.assign(Error('4K适配已取消，原图和已有费用保留。'), { name: 'AbortError' }); }

function createLocalWallpaperExporter({ artifactStore, fitWallpaper, onExport }) {
  return async function exportWallpaper4K(input, { signal } = {}) {
    if (!input || !validId(input.projectId) || !validId(input.sourceArtifactId) || !['portrait', 'landscape'].includes(input.orientation) || !['cover', 'contain'].includes(input.fit)) throw Error('请选择本项目的静态PNG壁纸和4K方向。');
    active(signal);
    const source = await artifactStore.read(input.sourceArtifactId);
    if (source.id !== input.sourceArtifactId || source.projectId !== input.projectId || source.kind !== 'image' || source.mimeType !== 'image/png' || source.trashedAt || source.unavailable || !Buffer.isBuffer(source.buffer) || !source.buffer.length || source.buffer.length > 32 * 1024 * 1024) throw Error('4K另存需要本项目可读取的PNG壁纸，原文件没有改变。');
    const size = rasterDimensions(source.buffer);
    if (imageType(source.buffer).mimeType !== 'image/png' || size.width > 8192 || size.height > 8192 || size.width * size.height > 16000000) throw Error('壁纸原文件格式或像素尺寸超出安全范围，请重新选择。');
    const target = { width: input.orientation === 'portrait' ? 2160 : 3840, height: input.orientation === 'portrait' ? 3840 : 2160, fit: input.fit, label: input.orientation === 'portrait' ? '4K竖屏' : '4K横屏' };
    active(signal);
    const buffer = Buffer.from(await fitWallpaper({ buffer: source.buffer, target }, { signal }));
    active(signal);
    const actual = rasterDimensions(buffer);
    if (!buffer.length || buffer.length > 32 * 1024 * 1024 || imageType(buffer).mimeType !== 'image/png' || actual.width !== target.width || actual.height !== target.height) throw Error('本地4K文件尺寸校验未通过，原壁纸仍保留。');
    const runId = randomUUID(), sourceSha256 = createHash('sha256').update(source.buffer).digest('hex');
    const artifact = await artifactStore.write({ projectId: input.projectId, runId, name: `${source.name.replace(/\.png$/i, '')}-${target.label}.png`, mimeType: 'image/png', buffer });
    try { if (onExport) await onExport({ projectId: input.projectId, sourceArtifactId: source.id, sourceSha256, artifact, target, runId }); }
    catch (error) { error.artifacts = [artifact]; throw error; }
    return { artifact, target, locallyAdapted: true };
  };
}
module.exports = { createLocalWallpaperExporter };
