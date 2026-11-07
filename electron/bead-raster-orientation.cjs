function beadDecodeSource(buffer) {
  const { imageSize } = require('image-size'), size = imageSize(buffer);
  const orientation = Number.isInteger(size.orientation) && size.orientation >= 1 && size.orientation <= 8 ? size.orientation : 1;
  if (orientation === 1) return { buffer, width: size.width, height: size.height, orientation };
  if (buffer[0] !== 255 || buffer[1] !== 216) throw Error('该底图方向元数据暂不支持，请另存为PNG后重新选择。');
  const chunks = [buffer.subarray(0, 2)]; let offset = 2;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer[offset++] !== 255) throw Error('JPEG方向数据不完整，请重新导入原图。');
    while (buffer[offset] === 255) offset++;
    const marker = buffer[offset++];
    if (marker === 218 || marker === 217) { chunks.push(buffer.subarray(start)); break; }
    if (marker === 1 || marker >= 208 && marker <= 215) { chunks.push(buffer.subarray(start, offset)); continue; }
    if (offset + 2 > buffer.length) throw Error('JPEG方向数据不完整，请重新导入原图。');
    const length = buffer.readUInt16BE(offset), end = offset + length;
    if (length < 2 || end > buffer.length) throw Error('JPEG方向数据不完整，请重新导入原图。');
    if (marker !== 225 || buffer.toString('binary', offset + 2, offset + 8) !== 'Exif\0\0') chunks.push(buffer.subarray(start, end));
    offset = end;
  }
  return { buffer: Buffer.concat(chunks), width: size.width, height: size.height, orientation };
}

function orientBeadBitmap({ pixels, width, height }, orientation) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 1024 || height > 1024 || !Buffer.isBuffer(pixels) || pixels.length !== width * height * 4 || !Number.isInteger(orientation) || orientation < 1 || orientation > 8) throw Error('底图方向采样像素无效。');
  const rotated = orientation >= 5, outputWidth = rotated ? height : width, outputHeight = rotated ? width : height;
  if (orientation === 1) return { pixels, width, height };
  const output = Buffer.alloc(pixels.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let dx, dy;
    switch (orientation) {
      case 2: dx = width - 1 - x; dy = y; break;
      case 3: dx = width - 1 - x; dy = height - 1 - y; break;
      case 4: dx = x; dy = height - 1 - y; break;
      case 5: dx = y; dy = x; break;
      case 6: dx = height - 1 - y; dy = x; break;
      case 7: dx = height - 1 - y; dy = width - 1 - x; break;
      case 8: dx = y; dy = width - 1 - x; break;
    }
    const source = (y * width + x) * 4, target = (dy * outputWidth + dx) * 4;
    output[target] = pixels[source]; output[target + 1] = pixels[source + 1]; output[target + 2] = pixels[source + 2]; output[target + 3] = pixels[source + 3];
  }
  return { pixels: output, width: outputWidth, height: outputHeight };
}
module.exports = { beadDecodeSource, orientBeadBitmap };
