const { imageType, rasterDimensions } = require('./image-output-formats.cjs');

const MAX_BYTES = 32 * 1024 * 1024;
const MAX_PIXELS = 8000000;
const MAX_SIDE = 8192;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function invalid(message) { const error = new Error(message); error.code = 'INVALID_IMAGE_INPUT'; return error; }
function dimensionsAllowed(size) { return Number.isInteger(size.width) && Number.isInteger(size.height) && size.width > 0 && size.height > 0 && size.width <= MAX_SIDE && size.height <= MAX_SIDE && size.width * size.height <= MAX_PIXELS; }

function candidate(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    const end = bytes.lastIndexOf(Buffer.from([255, 217]));
    if (end < 3 || bytes.length - end - 2 > 1024) throw invalid('JPEG缺少完整结束标记，或尾随数据超过可安全修复的范围。');
    return 'jpeg';
  }
  if (bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    if (bytes.readUInt32LE(4) + 8 !== bytes.length) throw invalid('WebP文件长度不完整，请重新导入原图。');
    return 'webp';
  }
  throw invalid('仅能本地修复实际PNG、JPEG或WebP静态参考图，SVG、GIF和未知文件不能按PNG处理。');
}

function staticPng(bytes) {
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
    if (type === 'acTL') throw invalid('动画PNG不能作为静态参考图自动修复，请先另存静态图片。');
    if (length > bytes.length - offset - 12) throw invalid('PNG数据块不完整，请重新导入原图。');
    offset += length + 12;
    if (type === 'IEND') return;
  }
  throw invalid('PNG缺少完整结束标记，请重新导入原图。');
}

function createImageReferenceNormalizer({ nativeImage }) {
  return async function normalizeRasterReference(input) {
    if (!input || !Buffer.isBuffer(input.buffer) || !input.buffer.length || input.buffer.length > MAX_BYTES) throw invalid('参考图为空或超过32MB，未进行本地修复。');
    const bytes = input.buffer, kind = candidate(bytes);
    if (kind === 'png') staticPng(bytes);
    if (kind === 'webp' && bytes.toString('ascii', 12, 16) === 'VP8X' && bytes[20] & 2) throw invalid('动画WebP不能作为静态参考图自动修复，请先另存静态图片。');
    let expected;
    try { expected = rasterDimensions(bytes); } catch { throw invalid('无法识别参考图实际尺寸，请重新导入原图。'); }
    if (!dimensionsAllowed(expected)) throw invalid('参考图超过800万像素或单边8192像素，请先缩小图片。');
    let image, actual, buffer;
    try {
      image = nativeImage.createFromBuffer(bytes);
      if (image.isEmpty()) throw Error('empty');
      actual = image.getSize();
      if (!dimensionsAllowed(actual) || actual.width !== expected.width || actual.height !== expected.height) throw Error('dimensions');
      buffer = image.toPNG();
    } catch { throw invalid('参考图无法完整解码为静态图片，请重新导入或另存原图。'); }
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_BYTES) throw invalid('本地修复后的PNG为空或超过32MB，请先缩小原图。');
    let saved;
    try { if (imageType(buffer).mimeType !== 'image/png') throw Error('type'); saved = rasterDimensions(buffer); }
    catch { throw invalid('本地修复没有得到有效PNG，未继续调用模型。'); }
    if (saved.width !== actual.width || saved.height !== actual.height) throw invalid('本地修复PNG尺寸不一致，未继续调用模型。');
    return { buffer, mimeType: 'image/png', width: saved.width, height: saved.height };
  };
}

module.exports = { createImageReferenceNormalizer };
