const MAX_SVG_BYTES = 4 * 1024 * 1024;
function invalid(message) { const error = new Error(message); error.code = 'INVALID_IMAGE'; return error; }
function rasterDimensions(bytes) {
  const { imageSize } = require('image-size');
  const value = imageSize(bytes), rotated = [5, 6, 7, 8].includes(value.orientation);
  if (!value.width || !value.height) throw invalid('无法识别参考图尺寸。');
  return rotated ? { width: value.height, height: value.width } : { width: value.width, height: value.height };
}
function localReferences(value, css = false) {
  if (css && /\\|@/.test(value) || /expression\s*\(|javascript\s*:/i.test(value)) throw invalid('SVG 包含不支持的样式或外部资源。');
  for (const match of value.matchAll(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi)) if (!/^#[A-Za-z_][\w:.-]*$/.test(match[2].trim())) throw invalid('SVG 不能引用外部资源或内嵌位图。');
}
function validateSvg(bytes) {
  if (!bytes.length || bytes.length > MAX_SVG_BYTES) throw invalid('SVG 为空或超过4MB，请简化矢量图后重试。');
  const source = bytes.toString('utf8').replace(/^\uFEFF/, '');
  if (source.includes('\uFFFD')) throw invalid('SVG 需要有效的UTF-8内容。');
  const { SaxesParser } = require('saxes');
  const parser = new SaxesParser({ xmlns: true }); let count = 0, depth = 0, root = false, styleDepth = 0;
  const denied = new Set(['script', 'foreignobject', 'image', 'feimage', 'iframe', 'object', 'embed', 'animate', 'animatemotion', 'animatetransform', 'set', 'discard', 'handler', 'listener']);
  parser.on('doctype', () => { throw invalid('SVG 不允许DTD或外部实体。'); });
  parser.on('processinginstruction', () => { throw invalid('SVG 不允许外部样式指令。'); });
  parser.on('opentag', node => {
    if (++count > 20000 || ++depth > 64) throw invalid('SVG 结构过于复杂，请简化后重试。');
    const name = node.local.toLowerCase();
    if (!root) { if (node.local !== 'svg' || node.uri !== 'http://www.w3.org/2000/svg') throw invalid('返回内容不是标准SVG文档。'); root = true; }
    if (node.uri !== 'http://www.w3.org/2000/svg' || denied.has(name)) throw invalid('SVG 必须是静态矢量，不能包含脚本、动画或嵌入资源。');
    if (name === 'style') styleDepth = depth;
    for (const attribute of Object.values(node.attributes)) {
      const key = attribute.local.toLowerCase(), value = attribute.value;
      if (attribute.prefix === 'xmlns' || attribute.name === 'xmlns') continue;
      if (key.startsWith('on') || ['base', 'src'].includes(key)) throw invalid('SVG 包含不允许的交互或资源属性。');
      if (key === 'href' && !/^#[A-Za-z_][\w:.-]*$/.test(value)) throw invalid('SVG 只允许文档内的矢量引用。');
      localReferences(value, ['style', 'fill', 'stroke', 'filter', 'clip-path', 'mask', 'cursor', 'marker', 'marker-start', 'marker-mid', 'marker-end'].includes(key));
      if (key === 'viewbox') { const box = value.trim().split(/[\s,]+/).map(Number); if (box.length !== 4 || !box.every(Number.isFinite) || box[2] <= 0 || box[3] <= 0 || box[2] > 16384 || box[3] > 16384 || box[2] * box[3] > 16777216) throw invalid('SVG 画布尺寸无效或过大。'); }
    }
  });
  parser.on('text', text => { if (styleDepth) localReferences(text, true); });
  parser.on('cdata', text => { if (styleDepth) localReferences(text, true); });
  parser.on('closetag', () => { if (depth === styleDepth) styleDepth = 0; depth--; });
  parser.on('error', () => { throw invalid('SVG 文档格式无效。'); });
  parser.write(source).close(); if (!root || depth !== 0) throw invalid('SVG 文档不完整。');
  return { mimeType: 'image/svg+xml', extension: 'svg' };
}
function validateGif(bytes) {
  if (bytes.length < 20 || !['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) throw invalid('GIF 文件头无效。');
  const width = bytes.readUInt16LE(6), height = bytes.readUInt16LE(8);
  if (!width || !height || width > 3840 || height > 3840 || width * height > 8294400) throw invalid('GIF 帧尺寸无效或过大。');
  let offset = 13 + (bytes[10] & 128 ? 3 * 2 ** ((bytes[10] & 7) + 1) : 0), frames = 0;
  function blocks() { while (offset < bytes.length) { const length = bytes[offset++]; if (!length) return; offset += length; if (offset > bytes.length) break; } throw invalid('GIF 数据块不完整。'); }
  while (offset < bytes.length) {
    const type = bytes[offset++];
    if (type === 0x3b) { if (offset !== bytes.length || frames < 2 || frames > 16 || width * height * frames > 33554432) throw invalid('GIF 动画帧数或总体尺寸超出当前支持范围。'); return { mimeType: 'image/gif', extension: 'gif', frames, width, height }; }
    if (type === 0x21) { if (offset >= bytes.length) break; offset++; blocks(); continue; }
    if (type !== 0x2c || offset + 9 > bytes.length) throw invalid('GIF 图像帧无效。');
    const left = bytes.readUInt16LE(offset), top = bytes.readUInt16LE(offset + 2), w = bytes.readUInt16LE(offset + 4), h = bytes.readUInt16LE(offset + 6), packed = bytes[offset + 8]; offset += 9;
    if (!w || !h || left + w > width || top + h > height) throw invalid('GIF 图像帧超出画布。');
    if (packed & 128) offset += 3 * 2 ** ((packed & 7) + 1);
    if (offset >= bytes.length || bytes[offset] < 2 || bytes[offset] > 8) throw invalid('GIF 压缩数据无效。');
    offset++; blocks(); frames++; if (frames > 16) throw invalid('当前最多支持16帧GIF。');
  }
  throw invalid('GIF 缺少完整结束标记。');
}
function imageType(bytes) {
  if (bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR' && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0 && bytes.toString('ascii', bytes.length - 8, bytes.length - 4) === 'IEND') return { mimeType: 'image/png', extension: 'png' };
  if (bytes.length >= 8 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217) return { mimeType: 'image/jpeg', extension: 'jpg' };
  if (bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.readUInt32LE(4) + 8 === bytes.length) return { mimeType: 'image/webp', extension: 'webp' };
  if (bytes.toString('ascii', 0, 3) === 'GIF') return validateGif(bytes);
  if (/^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<(?:[A-Za-z_][\w.-]*:)?svg[\s>]/.test(bytes.toString('utf8', 0, Math.min(bytes.length, 4096)).replace(/^\uFEFF/, ''))) return validateSvg(bytes);
  throw invalid('供应商没有返回可识别的PNG、JPEG、WebP、静态SVG或动画GIF。');
}
function validateMarkup(markup, source) {
  if (!markup?.buffer || markup.mimeType !== 'image/png' || markup.buffer.length > 32 * 1024 * 1024 || imageType(markup.buffer).mimeType !== 'image/png') throw invalid('圈画标注需要不超过32MB的透明PNG。');
  const overlay = rasterDimensions(markup.buffer), base = rasterDimensions(source.buffer);
  if (overlay.width !== base.width || overlay.height !== base.height || overlay.width * overlay.height > 16777216) throw invalid('标注层需与第一张原图尺寸一致，且不超过16777216像素。');
  const { PNG } = require('pngjs'); let bitmap;
  try { bitmap = PNG.sync.read(markup.buffer); } catch { throw invalid('标注PNG无法完整解码，请重新保存透明标注层。'); }
  let transparent = false; for (let index = 3; index < bitmap.data.length; index += 4) if (bitmap.data[index] < 255) { transparent = true; break; }
  if (!transparent) throw invalid('标注层需要实际透明像素，不能把标记直接压在原图上。');
  return overlay;
}
module.exports = { imageType, validateSvg, validateGif, rasterDimensions, validateMarkup };
