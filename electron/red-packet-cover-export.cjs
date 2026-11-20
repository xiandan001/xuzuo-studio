const path = require('node:path');
const { createHash } = require('node:crypto');
const { setImmediate: yieldToWindow } = require('node:timers/promises');
const { imageType, rasterDimensions } = require('./image-output-formats.cjs');
const { canvas } = require('./red-packet-cover-layout.json');
const { COVER_RECIPE } = require('./red-packet-cover-delivery.cjs');

const COVER_TARGET = Object.freeze({ ...canvas, fit: 'cover' });
const MAX_JPEG_BYTES = 500000;
const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(value);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceError = () => Error('请选择本项目中可读取的静态 PNG 或 JPEG 原图。');
const iccSignature = Buffer.from('ICC_PROFILE\0', 'ascii');
let srgbSegment;

function taggedSrgbJpeg(buffer) {
  let insertAt = 2;
  for (let offset = 2; offset + 4 < buffer.length && buffer[offset] === 0xff;) {
    const marker = buffer[offset + 1], length = buffer.readUInt16BE(offset + 2);
    if (marker === 0xda || length < 2 || offset + length + 2 > buffer.length) break;
    if (marker === 0xe2 && iccSignature.equals(buffer.subarray(offset + 4, offset + 4 + iccSignature.length))) return buffer;
    if (marker === 0xe0 && offset === 2) insertAt = offset + length + 2;
    offset += length + 2;
  }
  if (!srgbSegment) {
    // The colour-managed bitmap is already sRGB; some Skia builds omit the
    // ICC marker for raw bitmaps. Use the standard LittleCMS sRGB profile.
    const profile = require('node:fs').readFileSync(path.join(__dirname, 'srgb.icc'));
    const header = Buffer.from([0xff, 0xe2, 0, 0]);
    header.writeUInt16BE(2 + iccSignature.length + 2 + profile.length, 2);
    srgbSegment = Buffer.concat([header, iccSignature, Buffer.from([1, 1]), profile]);
  }
  return Buffer.concat([buffer.subarray(0, insertAt), srgbSegment, buffer.subarray(insertAt)]);
}

async function readSource(readArtifact, input) {
  const source = await readArtifact(input.sourceArtifactId);
  if (!source || source.id !== input.sourceArtifactId || source.projectId !== input.projectId || source.kind !== 'image' || source.trashedAt || source.unavailable
    || !Buffer.isBuffer(source.buffer) || !source.buffer.length || source.buffer.length > MAX_SOURCE_BYTES || !['image/png', 'image/jpeg'].includes(source.mimeType)) {
    throw sourceError();
  }
  try {
    if (imageType(source.buffer).mimeType !== source.mimeType) throw sourceError();
    const { width, height } = rasterDimensions(source.buffer);
    if (!width || !height || width > 8192 || height > 8192 || width * height > 16000000) throw sourceError();
  } catch { throw sourceError(); }
  return source;
}

function needsColorConversion(source) {
  if (source.mimeType === 'image/jpeg') return true;
  let managed = false;
  for (let offset = 8; offset + 12 <= source.buffer.length;) {
    const length = source.buffer.readUInt32BE(offset), type = source.buffer.toString('ascii', offset + 4, offset + 8);
    if (length > source.buffer.length - offset - 12 || type === 'acTL') throw sourceError();
    if (type === 'IDAT') return managed;
    if (['iCCP', 'cICP', 'cHRM', 'gAMA'].includes(type)) managed = true;
    offset += length + 12;
  }
  throw sourceError();
}
function rasterInput(source, nativeImage) {
  if (!needsColorConversion(source)) return { buffer: source.buffer };
  // Electron's bitmap readback converts the embedded profile to sRGB. toPNG()
  // preserves Display P3 channel values, which pngjs would interpret as sRGB.
  const decoded = nativeImage.createFromBuffer(source.buffer);
  if (decoded.isEmpty()) throw sourceError();
  const { width, height } = decoded.getSize();
  return { bitmap: decoded.toBitmap(), width, height };
}
async function encodeCoverJpeg(nativeImage, bitmap) {
  const { width, height } = COVER_TARGET;
  if (!(bitmap instanceof Uint8Array) || bitmap.byteLength !== width * height * 4) throw Error('微信红包封面排版尺寸校验未通过。');
  const pixels = Buffer.from(bitmap.buffer, bitmap.byteOffset, bitmap.byteLength);
  const image = nativeImage.createFromBitmap(pixels, { width, height, scaleFactor: 1 });
  if (image.isEmpty()) throw Error('微信红包封面排版像素不可用。');
  for (const quality of [92, 84, 76, 68, 60, 52, 44, 36, 28, 20, 12, 5, 1]) {
    await yieldToWindow();
    const buffer = image.toJPEG(quality);
    if (buffer.length > MAX_JPEG_BYTES) continue;
    try {
      const size = rasterDimensions(buffer);
      if (imageType(buffer).mimeType === 'image/jpeg' && size.width === width && size.height === height) {
        const jpeg = taggedSrgbJpeg(buffer);
        if (jpeg.length <= MAX_JPEG_BYTES) return jpeg;
        continue;
      }
    } catch { /* A partial encoder result cannot be saved. */ }
    break;
  }
  throw Error('未能生成符合尺寸和体积要求的微信红包封面 JPEG。');
}

function createRedPacketCoverExporter({ readArtifact, composeBitmap, nativeImage, chooseSave, writeSave, readDeliveryProof, writeDelivery }) {
  const cached = new Map(), preparing = new Map(), saving = new Map();
  let tail = Promise.resolve();
  function bytesFor(input) {
    if (!input || !validId(input.projectId) || !validId(input.sourceArtifactId)) return Promise.reject(sourceError());
    const key = input.projectId + '/' + input.sourceArtifactId;
    if (preparing.has(key)) return preparing.get(key);
    // Queued calls retain only IDs. At most one decoded source is in flight.
    const task = tail.then(async () => {
      const read = input.recoverLocal ? id => input.recoverLocal(() => readArtifact(id)) : readArtifact;
      const source = await readSource(read, input), sourceSha256 = source.sha256 || digest(source.buffer);
      const proof = source.mimeType === 'image/jpeg' && source.runId && await readDeliveryProof?.(source);
      const previous = cached.get(key);
      if (previous?.sourceSha256 === sourceSha256 && previous.proofSha256 === proof?.sha256) return previous;
      let jpeg;
      if (proof) {
        const size = rasterDimensions(source.buffer);
        if (proof.sha256 !== sourceSha256 || source.buffer.length !== proof.bytes || proof.bytes > MAX_JPEG_BYTES || size.width !== canvas.width || size.height !== canvas.height) throw Error('已保存的红包成品与交付记录不一致。');
        jpeg = source.buffer;
      } else {
        jpeg = await encodeCoverJpeg(nativeImage, await composeBitmap(rasterInput(source, nativeImage)));
      }
      const value = { jpeg, sha256: digest(jpeg), sourceSha256, name: source.name, runId: source.runId, sourceType: source.mimeType, proofSha256: proof?.sha256, originalArtifactId: proof?.sourceArtifactId };
      cached.delete(key);
      cached.set(key, value);
      if (cached.size > 2) cached.delete(cached.keys().next().value);
      return value;
    }).finally(() => preparing.delete(key));
    preparing.set(key, task);
    tail = task.then(() => undefined, () => undefined);
    return task;
  }
  async function prepare(input) {
    const { jpeg, sha256, sourceSha256, originalArtifactId } = await bytesFor(input);
    return { ...canvas, bytes: jpeg.length, sha256, sourceSha256, ...(originalArtifactId ? { originalArtifactId } : {}), dataUrl: 'data:image/jpeg;base64,' + jpeg.toString('base64') };
  }
  async function savePrepared(input, result) {
    const { jpeg } = result;
    const stem = Array.from(result.name.replace(/\.(?:png|jpe?g)$/i, '')).slice(0, 48).join('');
    const name = `${stem}-微信红包封面-${COVER_TARGET.width}x${COVER_TARGET.height}.jpg`;
    const choice = await chooseSave({ title: `导出微信红包封面 · ${canvas.width} × ${canvas.height} · ${jpeg.length.toLocaleString('zh-CN')} 字节`, defaultPath: name, filters: [{ name: '微信红包封面 JPEG', extensions: ['jpg', 'jpeg'] }] });
    if (choice.canceled || !choice.filePath) return { saved: false };
    if (!/\.jpe?g$/i.test(choice.filePath)) throw Error('请使用 .jpg 或 .jpeg 扩展名保存微信红包封面。');
    const current = await readSource(readArtifact, input);
    if (path.resolve(choice.filePath).normalize('NFC').toLowerCase() === path.resolve(current.path).normalize('NFC').toLowerCase()) throw Error('请选择新的保存位置，避免覆盖封面原图。');
    if ((current.sha256 || digest(current.buffer)) !== result.sourceSha256) throw Error('封面原图已变化，请重新选择原图后再导出。');
    const saved = await writeSave(choice, jpeg);
    return saved.saved ? { ...saved, ...canvas, bytes: jpeg.length } : saved;
  }
  async function exportRedPacketCover(input) {
    const result = await bytesFor(input);
    if ((input.preparedSha256 !== undefined && input.preparedSha256 !== result.sha256)
      || (input.sourceSha256 !== undefined && input.sourceSha256 !== result.sourceSha256)) throw Error('封面版本已变化，请重新预览后导出。');
    const key = [input.projectId, input.sourceArtifactId, result.sourceSha256, result.sha256].join('/');
    if (!saving.has(key)) saving.set(key, savePrepared(input, result).finally(() => saving.delete(key)));
    return saving.get(key);
  }
  async function archive(input) {
    const result = await bytesFor(input);
    if (result.runId !== input.runId || result.sourceType !== 'image/png') throw Error('红包交付需要当前运行实际制作的 PNG 原图。');
    input.signal?.throwIfAborted();
    const artifact = await writeDelivery({ name: `${input.title || '微信红包封面'}-上传用.jpg`, mimeType: 'image/jpeg', buffer: result.jpeg, projectId: input.projectId, runId: input.runId, signal: input.signal, ...(input.recoverLocal ? { recoverLocal: input.recoverLocal } : {}) }, input.sourceArtifactId);
    return { artifact, proof: { recipe: COVER_RECIPE, artifactId: artifact.id, sha256: result.sha256, bytes: result.jpeg.length, sourceArtifactId: input.sourceArtifactId, sourceSha256: result.sourceSha256 } };
  }
  return Object.assign(exportRedPacketCover, { prepare, archive });
}

module.exports = { COVER_TARGET, MAX_JPEG_BYTES, createRedPacketCoverExporter };
