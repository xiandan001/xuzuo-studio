import type { BeadPalette, BeadPattern, BeadRaster, BeadSettings } from '../bead-types';
import { beadPaletteIssue, beadSettingsIssue } from './bead-validation';

type Lab = [number, number, number];
// Oklab D65 conversion, public-domain coefficients: https://bottosson.github.io/posts/oklab/
function oklab(red: number, green: number, blue: number): Lab {
  const linear = (channel: number) => { const value = channel / 255; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; };
  const r = linear(red), g = linear(green), b = linear(blue);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
interface MatchColor { index: number; lab: Lab; }
function nearest(lab: Lab, colors: MatchColor[]): number {
  let selected = colors[0].index, minimum = Infinity;
  for (const color of colors) {
    const distance = (lab[0] - color.lab[0]) ** 2 + (lab[1] - color.lab[1]) ** 2 + (lab[2] - color.lab[2]) ** 2;
    if (distance < minimum) { minimum = distance; selected = color.index; }
  }
  return selected;
}
function rasterIssue(raster: BeadRaster) {
  if (!raster || !Number.isInteger(raster.width) || !Number.isInteger(raster.height) || raster.width < 1 || raster.height < 1 || raster.width > 1024 || raster.height > 1024 || !(raster.pixels instanceof Uint8Array || raster.pixels instanceof Uint8ClampedArray) || raster.pixels.byteLength !== raster.width * raster.height * 4 || raster.format !== undefined && !['rgba', 'bgra'].includes(raster.format)) throw Error('底图像素数据无效；采样图最长边不能超过1024。');
}
function cellRgb(raster: BeadRaster, settings: BeadSettings, column: number, row: number): [number, number, number, number] {
  const scale = settings.fit === 'cover' ? Math.max(settings.columns / raster.width, settings.rows / raster.height) : Math.min(settings.columns / raster.width, settings.rows / raster.height);
  const left = (settings.columns - raster.width * scale) / 2, top = (settings.rows - raster.height * scale) / 2;
  const x0 = Math.max(0, (column - left) / scale), x1 = Math.min(raster.width, (column + 1 - left) / scale);
  const y0 = Math.max(0, (row - top) / scale), y1 = Math.min(raster.height, (row + 1 - top) / scale);
  if (x0 >= x1 || y0 >= y1) return [0, 0, 0, 0];
  let alpha = 0, red = 0, green = 0, blue = 0;
  const redChannel = raster.format === 'bgra' ? 2 : 0, blueChannel = raster.format === 'bgra' ? 0 : 2;
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
    const area = (Math.min(x + 1, x1) - Math.max(x, x0)) * (Math.min(y + 1, y1) - Math.max(y, y0));
    const at = (y * raster.width + x) * 4, a = raster.pixels[at + 3] / 255, weight = area * (raster.premultiplied ? 1 : a);
    alpha += a * area; red += raster.pixels[at + redChannel] * weight; green += raster.pixels[at + 1] * weight; blue += raster.pixels[at + blueChannel] * weight;
  }
  return alpha > 0 ? [Math.min(255, Math.round(red / alpha)), Math.min(255, Math.round(green / alpha)), Math.min(255, Math.round(blue / alpha)), Math.min(255, Math.round(alpha * scale * scale * 255))] : [0, 0, 0, 0];
}

export function createBeadPattern(raster: BeadRaster, settings: BeadSettings, palette: BeadPalette): BeadPattern {
  const issue = beadSettingsIssue(settings) || beadPaletteIssue(palette); if (issue) throw Error(issue);
  rasterIssue(raster);
  const colors = palette.colors.map((color, offset) => ({ index: offset + 1, lab: oklab(...color.rgb) })).filter(color => palette.colors[color.index - 1].automatic);
  const cells = new Array<number>(settings.columns * settings.rows), samples = new Map<number, Lab>(), mapped = new Map<number, number>();
  const pixelKeys = new Int32Array(cells.length); pixelKeys.fill(-1);
  const counts = new Uint32Array(palette.colors.length + 1);
  for (let row = 0; row < settings.rows; row++) for (let column = 0; column < settings.columns; column++) {
    const at = row * settings.columns + column, [r, g, b, alpha] = cellRgb(raster, settings, column, row);
    if (alpha === 0 || alpha < settings.alphaThreshold) { cells[at] = 0; continue; }
    const key = r * 65536 + g * 256 + b; pixelKeys[at] = key;
    let index = mapped.get(key);
    if (index === undefined) { const lab = oklab(r, g, b); samples.set(key, lab); index = nearest(lab, colors); mapped.set(key, index); }
    cells[at] = index; counts[index]++;
  }
  const used = colors.filter(color => counts[color.index] > 0).sort((a, b) => counts[b.index] - counts[a.index] || a.index - b.index);
  if (settings.maxColors > 0 && used.length > settings.maxColors) {
    const limited = used.slice(0, settings.maxColors), remapped = new Map<number, number>();
    for (let at = 0; at < cells.length; at++) {
      const key = pixelKeys[at]; if (key < 0) continue;
      let index = remapped.get(key); if (index === undefined) { index = nearest(samples.get(key)!, limited); remapped.set(key, index); }
      cells[at] = index;
    }
  }
  return { type: 'xuzuo-bead-pattern', version: 1, columns: settings.columns, rows: settings.rows, palette: structuredClone(palette), cells };
}
