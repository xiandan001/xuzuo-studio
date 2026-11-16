const { checkedSize } = require('./commerce-image-document.cjs');
const PIXEL_LIMIT = 16000000;
function rgbaRaster(input, loadModule = require) {
  if (!input) throw Error('缺少本地合成图片。');
  let width, height, pixels;
  if (input.buffer) {
    const { PNG } = loadModule('pngjs'), buffer = Buffer.from(input.buffer);
    const dimensions = require('./image-reference-normalization.cjs').readRasterReferenceSize(buffer);
    if (buffer.length > 32 * 1024 * 1024 || !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || dimensions.width < 1 || dimensions.height < 1 || dimensions.width > 8192 || dimensions.height > 8192 || dimensions.width * dimensions.height > PIXEL_LIMIT) throw Error('本地合成仅解码1600万像素以内的静态PNG。');
    const source = PNG.sync.read(buffer); width = source.width; height = source.height; pixels = source.data;
  } else {
    width = input.width; height = input.height;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > PIXEL_LIMIT || !(input.bitmap instanceof Uint8Array) || input.bitmap.length !== width * height * 4) throw Error('原图解码像素不完整。');
    const source = input.bitmap; pixels = Buffer.alloc(source.length);
    for (let at = 0; at < source.length; at += 4) { const alpha = source[at + 3]; for (let channel = 0; channel < 3; channel++) pixels[at + channel] = alpha ? Math.min(255, Math.round(source[at + 2 - channel] * 255 / alpha)) : source[at + 2 - channel]; pixels[at + 3] = alpha; }
    const orientation = input.orientation || 1;
    if (!Number.isInteger(orientation) || orientation < 1 || orientation > 8) throw Error('原图方向无效。');
    if (orientation !== 1) {
      const rotated = orientation >= 5, outputWidth = rotated ? height : width, outputHeight = rotated ? width : height, output = Buffer.alloc(pixels.length);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        let dx = x, dy = y;
        if (orientation === 2) dx = width - 1 - x;
        if (orientation === 3) { dx = width - 1 - x; dy = height - 1 - y; }
        if (orientation === 4) dy = height - 1 - y;
        if (orientation === 5) { dx = y; dy = x; }
        if (orientation === 6) { dx = height - 1 - y; dy = x; }
        if (orientation === 7) { dx = height - 1 - y; dy = width - 1 - x; }
        if (orientation === 8) { dx = y; dy = width - 1 - x; }
        pixels.copy(output, (dy * outputWidth + dx) * 4, (y * width + x) * 4, (y * width + x) * 4 + 4);
      }
      width = outputWidth; height = outputHeight; pixels = output;
    }
  }
  return { width, height, pixels };
}
function encode(raster, loadModule) { return loadModule('pngjs').PNG.sync.write({ width: raster.width, height: raster.height, data: raster.pixels }, { colorType: 6, inputColorType: 6, deflateLevel: 6 }); }
function sample(raster, x, y, channel) {
  const sx = Math.max(0, Math.min(raster.width - 1, Math.floor(x))), sy = Math.max(0, Math.min(raster.height - 1, Math.floor(y)));
  return raster.pixels[(sy * raster.width + sx) * 4 + channel];
}
function samplePixel(raster, x, y, target) {
  x = Math.max(0, Math.min(raster.width - 1, x)); y = Math.max(0, Math.min(raster.height - 1, y));
  const x0 = Math.floor(x), y0 = Math.floor(y), wx = x - x0, wy = y - y0, data = raster.pixels;
  const a = (y0 * raster.width + x0) * 4, b = (y0 * raster.width + Math.min(x0 + 1, raster.width - 1)) * 4, c = (Math.min(y0 + 1, raster.height - 1) * raster.width + x0) * 4, d = (Math.min(y0 + 1, raster.height - 1) * raster.width + Math.min(x0 + 1, raster.width - 1)) * 4;
  const wa = (1 - wx) * (1 - wy) * data[a + 3] / 255, wb = wx * (1 - wy) * data[b + 3] / 255, wc = (1 - wx) * wy * data[c + 3] / 255, wd = wx * wy * data[d + 3] / 255, alpha = wa + wb + wc + wd;
  for (let channel = 0; channel < 3; channel++) target[channel] = alpha ? (data[a + channel] * wa + data[b + channel] * wb + data[c + channel] * wc + data[d + channel] * wd) / alpha : 0;
  target[3] = alpha * 255;
}
function resized(raster, width, height) {
  const output = Buffer.alloc(width * height * 4), pixel = new Float64Array(4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { samplePixel(raster, (x + .5) * raster.width / width - .5, (y + .5) * raster.height / height - .5, pixel); for (let channel = 0; channel < 4; channel++) output[(y * width + x) * 4 + channel] = Math.round(pixel[channel]); }
  return { width, height, pixels: output };
}
function alphaBounds(raster) {
  let min = 255, max = 0;
  for (let at = 3; at < raster.pixels.length; at += 4) { min = Math.min(min, raster.pixels[at]); max = Math.max(max, raster.pixels[at]); }
  if (min === 255 || max === 0) throw Error('蒙版没有有效透明区域或主体；不能把整张不透明图片当作成功抠图。请上传透明PNG或手工涂选。');
}
function applyCommerceAlpha(input, loadModule = require) {
  const source = rgbaRaster(input.source, loadModule), mask = rgbaRaster(input.alpha, loadModule); alphaBounds(mask);
  if (Math.abs(source.width / source.height - mask.width / mask.height) / (source.width / source.height) > .03) throw Error('主体蒙版比例与原图不同，请使用同一张原图的透明蒙版。');
  const output = Buffer.from(source.pixels);
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) { const at = (y * source.width + x) * 4; output[at + 3] = Math.round(source.pixels[at + 3] * sample(mask, (x + .5) * mask.width / source.width, (y + .5) * mask.height / source.height, 3) / 255); }
  return { width: source.width, height: source.height, buffer: encode({ ...source, pixels: output }, loadModule), productRgbVerified: true };
}
function protectCommercePixels(input, loadModule = require) {
  const source = rgbaRaster(input.source, loadModule), edited = rgbaRaster(input.edited, loadModule), mask = rgbaRaster(input.mask, loadModule); alphaBounds(mask);
  const output = Buffer.from(source.pixels); let protectedPixels = 0;
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
    const at = (y * source.width + x) * 4, weight = sample(mask, (x + .5) * mask.width / source.width, (y + .5) * mask.height / source.height, 3) / 255;
    if (!weight) { protectedPixels++; continue; }
    for (let channel = 0; channel < 4; channel++) output[at + channel] = Math.round(source.pixels[at + channel] * (1 - weight) + sample(edited, (x + .5) * edited.width / source.width, (y + .5) * edited.height / source.height, channel) * weight);
  }
  if (!protectedPixels) throw Error('请保留一部分非修改区域，整图修改无需保护合成。');
  return { width: source.width, height: source.height, buffer: encode({ ...source, pixels: output }, loadModule), protectedPixels, protectedPixelsVerified: true };
}
function drawLayer(output, layer) {
  const source = layer.raster, left = Math.max(0, Math.floor(layer.x)), top = Math.max(0, Math.floor(layer.y)), right = Math.min(output.width, Math.ceil(layer.x + layer.width)), bottom = Math.min(output.height, Math.ceil(layer.y + layer.height));
  const direct = Number.isInteger(layer.x) && Number.isInteger(layer.y) && layer.width === source.width && layer.height === source.height, pixel = new Float64Array(4);
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
    if (direct) { const offset = ((y - layer.y) * source.width + x - layer.x) * 4; for (let channel = 0; channel < 4; channel++) pixel[channel] = source.pixels[offset + channel]; }
    else samplePixel(source, (x + .5 - layer.x) * source.width / layer.width - .5, (y + .5 - layer.y) * source.height / layer.height - .5, pixel);
    const at = (y * output.width + x) * 4, alpha = pixel[3] / 255 * layer.opacity, old = output.pixels[at + 3] / 255, combined = alpha + old * (1 - alpha);
    for (let channel = 0; channel < 3; channel++) output.pixels[at + channel] = combined ? Math.round((pixel[channel] * alpha + output.pixels[at + channel] * old * (1 - alpha)) / combined) : 0;
    output.pixels[at + 3] = Math.round(combined * 255);
  }
}
function composeCommerceImage(input, loadModule = require) {
  const size = checkedSize(input), color = /^#[a-f0-9]{6}$/i.test(input.background || '') ? [1, 3, 5].map(at => parseInt(input.background.slice(at, at + 2), 16)) : [255, 255, 255];
  if (!Array.isArray(input.layers) || input.layers.length > 32) throw Error('合成图层最多32层。');
  const output = { ...size, pixels: Buffer.alloc(size.width * size.height * 4) }; if (input.background !== 'transparent') output.pixels.fill(Buffer.from([...color, 255]));
  let total = 0;
  for (const layer of input.layers) {
    if (!layer.visible || !layer.opacity) continue;
    if (!['x', 'y', 'width', 'height', 'opacity'].every(key => typeof layer[key] === 'number' && Number.isFinite(layer[key])) || layer.width <= 0 || layer.height <= 0 || layer.opacity < 0 || layer.opacity > 1) throw Error('合成图层位置或透明度无效。');
    const raster = rgbaRaster(layer.source, loadModule); total += raster.width * raster.height; if (total > 32000000) throw Error('合成输入合计超过3200万像素，请缩小或减少叠图。');
    drawLayer(output, { ...layer, raster });
  }
  let protectedPixelsVerified = false;
  if (input.protection) {
    const result = protectCommercePixels({ source: input.protection.source, edited: { buffer: encode(output, loadModule) }, mask: input.protection.mask }, loadModule);
    const restored = rgbaRaster({ buffer: result.buffer }, loadModule); if (restored.width !== size.width || restored.height !== size.height) throw Error('保护区需要与原图相同的画布尺寸。'); output.pixels = restored.pixels; protectedPixelsVerified = true;
  }
  let final = output;
  if (input.target) {
    const target = checkedSize(input.target), scale = Math.min(target.width / size.width, target.height / size.height), width = Math.max(1, Math.round(size.width * scale)), height = Math.max(1, Math.round(size.height * scale));
    final = { ...target, pixels: Buffer.alloc(target.width * target.height * 4) }; if (input.background !== 'transparent') final.pixels.fill(Buffer.from([...color, 255]));
    drawLayer(final, { raster: resized(output, width, height), x: Math.floor((target.width - width) / 2), y: Math.floor((target.height - height) / 2), width, height, opacity: 1 });
  }
  return { width: final.width, height: final.height, buffer: encode(final, loadModule), protectedPixelsVerified };
}
function previewCommerceRaster(input, loadModule = require) {
  const raster = rgbaRaster(input, loadModule), maximum = [768, 1280, 2048].includes(input.maxSide) ? input.maxSide : 512;
  let selected = raster, crop = { x: 0, y: 0, width: 1, height: 1 };
  if (input.region !== undefined) {
    const region = input.region;
    if (!region || Object.keys(region).some(key => !['x', 'y', 'width', 'height'].includes(key)) || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(region[key])) || region.x < 0 || region.x >= 1 || region.y < 0 || region.y >= 1 || region.width <= 0 || region.height <= 0 || region.x + region.width > 1.000001 || region.y + region.height > 1.000001) throw Error('清晰预览区域无效。');
    const x = Math.max(0, Math.floor(region.x * raster.width)), y = Math.max(0, Math.floor(region.y * raster.height)), width = Math.max(1, Math.min(raster.width, Math.ceil((region.x + region.width) * raster.width)) - x), height = Math.max(1, Math.min(raster.height, Math.ceil((region.y + region.height) * raster.height)) - y);
    const pixels = Buffer.alloc(width * height * 4);
    for (let row = 0; row < height; row++) raster.pixels.copy(pixels, row * width * 4, ((y + row) * raster.width + x) * 4, ((y + row) * raster.width + x + width) * 4);
    selected = { width, height, pixels }; crop = { x: x / raster.width, y: y / raster.height, width: width / raster.width, height: height / raster.height };
  }
  const ratio = Math.min(1, maximum / selected.width, maximum / selected.height, Math.sqrt(2000000 / (selected.width * selected.height))), preview = ratio < 1 ? resized(selected, Math.max(1, Math.floor(selected.width * ratio)), Math.max(1, Math.floor(selected.height * ratio))) : selected;
  return { width: raster.width, height: raster.height, previewWidth: preview.width, previewHeight: preview.height, crop, buffer: encode(preview, loadModule) };
}
module.exports = { rgbaRaster, composeCommerceImage, applyCommerceAlpha, protectCommercePixels, previewCommerceRaster };
