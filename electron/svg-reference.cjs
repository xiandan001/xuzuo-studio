const { createHash } = require('node:crypto');
const { validateSvg, imageType, rasterDimensions } = require('./image-output-formats.cjs');

const MAX_PNG_BYTES = 20 * 1024 * 1024;
const MAX_SIDE = 2048;
const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(value);
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function targetDimensions(buffer) {
  validateSvg(buffer);
  const source = rasterDimensions(buffer);
  if (!Number.isFinite(source.width) || !Number.isFinite(source.height) || source.width <= 0 || source.height <= 0 || source.width > 16384 || source.height > 16384 || source.width * source.height > 16777216) throw Error('SVG画布尺寸无效或过大，请先缩小原矢量画布。');
  const scale = MAX_SIDE / Math.max(source.width, source.height);
  return { sourceWidth: source.width, sourceHeight: source.height, width: Math.max(1, Math.round(source.width * scale)), height: Math.max(1, Math.round(source.height * scale)) };
}

function checkedPng(value, target, loadModule) {
  if (!(value instanceof Uint8Array) && !(value instanceof ArrayBuffer)) throw Error('SVG参考图需要PNG二进制内容。');
  if (!value.byteLength || value.byteLength > MAX_PNG_BYTES) throw Error('SVG参考PNG为空或超过20MB。');
  const buffer = Buffer.from(value instanceof ArrayBuffer ? new Uint8Array(value) : value);
  if (imageType(buffer).mimeType !== 'image/png') throw Error('SVG参考图必须是真实的PNG文件。');
  const size = rasterDimensions(buffer);
  if (size.width !== target.width || size.height !== target.height) throw Error('SVG参考PNG尺寸与预定画布不一致，请重新转换。');
  let bitmap;
  try { bitmap = loadModule('pngjs').PNG.sync.read(buffer); }
  catch { throw Error('SVG参考PNG无法完整解码，请重新转换。'); }
  if (bitmap.width !== target.width || bitmap.height !== target.height || bitmap.data.length !== target.width * target.height * 4) throw Error('SVG参考PNG的实际画布不一致。');
  return buffer;
}

function createSvgReference({ artifactStore, loadModule = require }) {
  return async function prepare(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || !validId(input.projectId) || !validId(input.sourceArtifactId)) throw Error('请重新选择本项目的静态SVG原文件。');
    const saving = input.pngBytes !== undefined;
    if ((saving || input.sourceSha256 !== undefined) && !validHash(input.sourceSha256)) throw Error('SVG来源校验信息无效，请重新读取原文件。');
    const source = await artifactStore.read(input.sourceArtifactId);
    if (source.id !== input.sourceArtifactId || source.projectId !== input.projectId || source.mimeType !== 'image/svg+xml' || source.trashedAt || source.unavailable) throw Error('请选择本项目仍可用的静态SVG原文件。');
    const dimensions = targetDimensions(source.buffer);
    const sourceSha256 = createHash('sha256').update(source.buffer).digest('hex');
    if (input.sourceSha256 !== undefined && input.sourceSha256 !== sourceSha256) throw Error('原SVG内容已变化，请重新读取后再转换。');
    const context = { sourceArtifactId: source.id, sourceSha256, mimeType: 'image/svg+xml', ...dimensions };
    if (!saving) return { ...context, sourceBytes: Uint8Array.from(source.buffer) };
    const buffer = checkedPng(input.pngBytes, dimensions, loadModule);
    const reference = await artifactStore.write({ projectId: input.projectId, name: `${source.name.replace(/\.svg$/i, '')}-参考.png`, mimeType: 'image/png', buffer });
    return { ...context, reference };
  };
}

module.exports = { createSvgReference };
