const path = require('node:path');
const { imageType, rasterDimensions } = require('./image-output-formats.cjs');

const COVER_TARGET = Object.freeze({ width: 957, height: 1278, fit: 'cover' });
const MAX_JPEG_BYTES = 500000;
const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(value);
const sourceError = () => Error('请选择本项目中可读取的静态 PNG 或 JPEG 原图。');

async function readSource(readArtifact, input) {
  const source = await readArtifact(input.sourceArtifactId);
  if (source.id !== input.sourceArtifactId || source.projectId !== input.projectId || source.kind !== 'image' || source.trashedAt || source.unavailable
    || !Buffer.isBuffer(source.buffer) || !source.buffer.length || source.buffer.length > MAX_SOURCE_BYTES || !['image/png', 'image/jpeg'].includes(source.mimeType)) {
    throw sourceError();
  }
  try {
    if (imageType(source.buffer).mimeType !== source.mimeType) throw sourceError();
    const { width, height } = rasterDimensions(source.buffer);
    if (width > 8192 || height > 8192 || width * height > 16000000) throw sourceError();
  } catch { throw sourceError(); }
  return source;
}

function encodeCoverJpeg(nativeImage, croppedPng) {
  const image = nativeImage.createFromBuffer(croppedPng);
  const { width, height } = image.getSize();
  if (image.isEmpty() || width !== COVER_TARGET.width || height !== COVER_TARGET.height) throw Error('微信红包封面裁切尺寸校验未通过。');
  for (const quality of [92, 84, 76, 68, 60, 52, 44, 36, 28, 20, 12, 5, 1]) {
    const buffer = image.toJPEG(quality);
    if (buffer.length > MAX_JPEG_BYTES) continue;
    try {
      const size = rasterDimensions(buffer);
      if (imageType(buffer).mimeType === 'image/jpeg' && size.width === width && size.height === height) return buffer;
    } catch { /* A partial encoder result cannot be saved. */ }
    break;
  }
  throw Error('未能生成符合尺寸和体积要求的微信红包封面 JPEG。');
}

function createRedPacketCoverExporter({ readArtifact, cropPng, nativeImage, chooseSave, writeSave }) {
  return async function exportRedPacketCover(input) {
    if (!input || !validId(input.projectId) || !validId(input.sourceArtifactId)) throw sourceError();
    const source = await readSource(readArtifact, input);
    let png = source.buffer;
    if (source.mimeType === 'image/jpeg') {
      const decoded = nativeImage.createFromBuffer(source.buffer);
      if (decoded.isEmpty()) throw sourceError();
      png = decoded.toPNG();
    }
    const jpeg = encodeCoverJpeg(nativeImage, Buffer.from(await cropPng({ buffer: png })));
    const stem = Array.from(source.name.replace(/\.(?:png|jpe?g)$/i, '')).slice(0, 48).join('');
    const name = `${stem}-微信红包封面-${COVER_TARGET.width}x${COVER_TARGET.height}.jpg`;
    const choice = await chooseSave({ title: '导出微信红包封面', defaultPath: name, filters: [{ name: '微信红包封面 JPEG', extensions: ['jpg', 'jpeg'] }] });
    if (choice.canceled || !choice.filePath) return { saved: false };
    if (!/\.jpe?g$/i.test(choice.filePath)) throw Error('请使用 .jpg 或 .jpeg 扩展名保存微信红包封面。');
    const current = await readSource(readArtifact, input);
    if (path.resolve(choice.filePath).normalize('NFC').toLowerCase() === path.resolve(current.path).normalize('NFC').toLowerCase()) throw Error('请选择新的保存位置，避免覆盖封面原图。');
    if (current.sha256 !== source.sha256 || !current.buffer.equals(source.buffer)) throw Error('封面原图已变化，请重新选择原图后再导出。');
    return writeSave(choice, jpeg);
  };
}

module.exports = { COVER_TARGET, MAX_JPEG_BYTES, createRedPacketCoverExporter };
