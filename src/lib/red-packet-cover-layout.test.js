import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { composeCover } = require('../../electron/red-packet-cover-layout.cjs');
const { canvas, identity, titleBand, button, cornerDepth } = require('../../electron/red-packet-cover-layout.json');

function artwork(width = 150, height = 200) {
  const data = Buffer.alloc(width * height * 4, 255);
  const rect = (left, top, right, bottom, rgb) => {
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) data.set(rgb, 4 * (width * y + x));
  };
  return { width, height, data, rect };
}
function verifyInk(out) {
  const marks = [[], []];
  let overlap = 0;
  for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) {
    const i = 4 * (y * out.width + x);
    const [r, g, b] = out.data.subarray(i, i + 3);
    const group = b > r + 90 && b > g + 90 ? 0 : r > g + 90 && r > b + 90 ? 1 : -1;
    if (group < 0) continue;
    const u = (x + 0.5) / out.width, v = (y + 0.5) / out.height;
    if ((u >= identity.left && u <= identity.right && v >= identity.top && v <= identity.bottom)
      || Math.hypot(x + 0.5 - out.width * button.centerX, y + 0.5 - out.height * button.centerY) <= out.width * button.diameterRatio / 2
      || v >= 1 - cornerDepth * (2 * u - 1) ** 2) overlap++;
    const box = marks[group];
    if (!box.length) box.push(u, v, u, v);
    else { box[0] = Math.min(box[0], u); box[1] = Math.min(box[1], v); box[2] = Math.max(box[2], u); box[3] = Math.max(box[3], v); }
  }
  expect(overlap).toBe(0);
  expect(marks.every(box => box.length === 4)).toBe(true);
  return marks;
}
it('将冲突的独立题字放上方，角色保持大图，两者均不进入系统遮挡区', () => {
  const input = artwork();
  input.rect(2, 19, 103, 105, [2, 1, 180, 255]);
  input.rect(108, 8, 145, 48, [181, 0, 0, 255]);
  const original = Buffer.from(input.data);
  const out = composeCover(input), [hero, title] = verifyInk(out);
  expect([out.width, out.height]).toEqual([canvas.width, canvas.height]);
  expect(hero[2] - hero[0]).toBeGreaterThan(0.48);
  expect(hero[1]).toBeGreaterThan(identity.bottom);
  expect(title[1]).toBeGreaterThanOrEqual(titleBand.top - 0.001);
  expect(title[3]).toBeLessThanOrEqual(titleBand.bottom + 0.001);
  expect(input.data).toEqual(original);
});
it('识别主体上方居中的分段题字，保留题字各部分与浅色角色细节', () => {
  const input = artwork(168, 224);
  const red = [181, 0, 0, 255];
  input.rect(18, 99, 150, 215, [2, 1, 180, 255]);
  input.rect(47, 105, 95, 123, [230, 228, 220, 255]);
  input.rect(34, 33, 104, 48, red);
  input.rect(111, 33, 134, 48, red);
  input.rect(109, 74, 123, 88, [120, 180, 24, 255]);
  input.rect(34, 81, 48, 102, [120, 180, 24, 255]);
  const out = composeCover(input), [hero, title] = verifyInk(out);
  expect(out.data.includes(Buffer.from([230, 228, 220, 255]))).toBe(true);
  expect(hero[2] - hero[0]).toBeGreaterThan(0.38);
  expect(title[2] - title[0]).toBeGreaterThan(0.32);
  expect(title[1]).toBeGreaterThanOrEqual(titleBand.top - 0.001);
  expect(title[3]).toBeLessThanOrEqual(titleBand.bottom + 0.001);
});
it('本来就在两侧可见区的细节保留原始构图，不强制压进中下部', () => {
  const input = artwork();
  input.rect(0, 18, 18, 147, [0, 0, 180, 255]);
  input.rect(132, 18, 150, 147, [180, 0, 0, 255]);
  const [left, right] = verifyInk(composeCover(input));
  expect(left[0]).toBeLessThan(0.012); expect(right[2]).toBeGreaterThan(0.988);
  expect(left[1]).toBeLessThan(identity.top); expect(right[3]).toBeGreaterThan(identity.bottom);
});

it('不能安全地摆放的大幅密集前景不会被悄悄清除或挤成小贴纸', () => {
  const input = artwork();
  input.rect(7, 7, 143, 193, [30, 60, 120, 255]);
  expect(() => composeCover(input)).toThrow(/主体缩得过小/);
});

it('独立题字不能绕过过高主体的最小尺寸检查', () => {
  const input = artwork(300, 400);
  input.rect(80, 18, 220, 44, [181, 0, 0, 255]);
  input.rect(35, 103, 265, 393, [2, 1, 180, 255]);
  expect(() => composeCover(input)).toThrow(expect.objectContaining({ code: 'COVER_LAYOUT_REJECTED' }));
});
