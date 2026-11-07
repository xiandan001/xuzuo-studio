const { wallpaperTargetError } = require('./wallpaper-export.cjs');
const { imageType, rasterDimensions } = require('./image-output-formats.cjs');

function wallpaperGeometry(source, target) {
  const scale = target.fit === 'contain' ? Math.min(target.width / source.width, target.height / source.height) : Math.max(target.width / source.width, target.height / source.height);
  return { scale, left: (target.width - source.width * scale) / 2, top: (target.height - source.height * scale) / 2 };
}
function checkedPng(input, PNG) {
  const buffer = Buffer.from(input.buffer || []);
  if (!buffer.length || buffer.length > 32 * 1024 * 1024 || imageType(buffer).mimeType !== 'image/png') throw Error('壁纸适配仅接受完整的PNG原图，原图没有改动。');
  const dimensions = rasterDimensions(buffer);
  if (!dimensions.width || !dimensions.height || dimensions.width > 8192 || dimensions.height > 8192 || dimensions.width * dimensions.height > 16000000) throw Error('壁纸原图像素过大，请先缩小原图。');
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset), type = buffer.toString('ascii', offset + 4, offset + 8);
    if (type === 'acTL') throw Error('壁纸适配需要静态PNG，不能直接使用动画PNG。');
    if (length > buffer.length - offset - 12) throw Error('PNG原图内容不完整，未进行壁纸适配。');
    offset += length + 12; if (type === 'IEND') break;
  }
  try { return PNG.sync.read(buffer); } catch { throw Error('PNG原图无法完整解码，原图与费用保留。'); }
}
function samplePixels(source, target, output, preserveAlpha) {
  const { scale, left, top } = wallpaperGeometry(source, target);
  const startX = Math.max(0, Math.ceil(left - 0.5)), endX = Math.min(target.width, Math.ceil(left + source.width * scale - 0.5));
  const startY = Math.max(0, Math.ceil(top - 0.5)), endY = Math.min(target.height, Math.ceil(top + source.height * scale - 0.5));
  const positions = new Int32Array(target.width), weights = new Float64Array(target.width), data = source.data;
  for (let x = startX; x < endX; x++) { const at = Math.max(0, Math.min(source.width - 1, (x + 0.5 - left) / scale - 0.5)); positions[x] = Math.floor(at); weights[x] = at - positions[x]; }
  for (let y = startY; y < endY; y++) {
    const at = Math.max(0, Math.min(source.height - 1, (y + 0.5 - top) / scale - 0.5)), y0 = Math.floor(at), wy = at - y0, row0 = y0 * source.width, row1 = Math.min(y0 + 1, source.height - 1) * source.width;
    for (let x = startX; x < endX; x++) {
      const x0 = positions[x], x1 = Math.min(x0 + 1, source.width - 1), wx = weights[x];
      const a = (row0 + x0) * 4, b = (row0 + x1) * 4, c = (row1 + x0) * 4, d = (row1 + x1) * 4;
      const wa = (1 - wx) * (1 - wy) * data[a + 3] / 255, wb = wx * (1 - wy) * data[b + 3] / 255, wc = (1 - wx) * wy * data[c + 3] / 255, wd = wx * wy * data[d + 3] / 255;
      const destination = (y * target.width + x) * 4;
      const alpha = wa + wb + wc + wd;
      for (let channel = 0; channel < 3; channel++) { const color = data[a + channel] * wa + data[b + channel] * wb + data[c + channel] * wc + data[d + channel] * wd; output[destination + channel] = Math.round(preserveAlpha ? alpha ? color / alpha : 0 : color); }
      if (preserveAlpha) output[destination + 3] = Math.round(alpha * 255);
    }
  }
}
function fitRasterPng(input, loadModule, preserveAlpha) {
  const issue = wallpaperTargetError(input?.target); if (issue) throw Error(issue);
  const { PNG } = loadModule('pngjs'), source = checkedPng(input, PNG), target = input.target;
  const output = Buffer.alloc(target.width * target.height * 4);
  if (!preserveAlpha) for (let at = 3; at < output.length; at += 4) output[at] = 255;
  samplePixels(source, target, output, preserveAlpha);
  return PNG.sync.write({ width: target.width, height: target.height, data: output }, { colorType: preserveAlpha ? 6 : 2, inputColorType: 6, deflateLevel: 6, filterType: 4 });
}
function fitWallpaperPng(input, loadModule = require) { return fitRasterPng(input, loadModule, false); }
function fitEngineeringPng(input, loadModule = require) {
  if (input?.target?.fit !== 'contain') throw Error('工程图片需完整保留画面，不能自动裁切图纸或标注。');
  try { return fitRasterPng(input, loadModule, true); } catch (error) { error.message = error.message.replaceAll('壁纸', '工程图片'); throw error; }
}
module.exports = { fitWallpaperPng, fitEngineeringPng, wallpaperGeometry };
