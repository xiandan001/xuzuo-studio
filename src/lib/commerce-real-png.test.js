import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url), { dependencies } = require('./production-test-fixtures.cjs'), { PNG } = dependencies('pngjs');
const { applyCommerceAlpha } = require('../../electron/commerce-compositor.cjs');
const { readRasterReferenceSize } = require('../../electron/image-reference-normalization.cjs');

describe('实际返回的1254像素透明PNG本地回归', () => {
  it('已付费返回PNG可完整读取，并将Alpha匹配回1024原图，逐像素原RGB完全不变', async () => {
    const fixture = JSON.parse(await fs.readFile(new URL('./fixtures/commerce-returned-alpha.fixture.json', import.meta.url), 'utf8')), bytes = Buffer.from(fixture.pngBase64, 'base64'), alpha = PNG.sync.read(bytes); expect(readRasterReferenceSize(bytes)).toEqual({ width: fixture.width, height: fixture.height }); expect(createHash('sha256').update(alpha.data.filter((_value, at) => at % 4 === 3)).digest('hex')).toBe(fixture.alphaSha256);
    const original = new PNG({ width: 1024, height: 1024 });
    for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) original.data.set([x % 256, y % 256, (x + y) % 256, 255], (y * 1024 + x) * 4);
    const source = PNG.sync.write(original), result = applyCommerceAlpha({ source: { buffer: source }, alpha: { buffer: bytes } }, dependencies), output = PNG.sync.read(result.buffer);
    expect(result).toMatchObject({ width: 1024, height: 1024, productRgbVerified: true }); expect(readRasterReferenceSize(result.buffer)).toEqual({ width: 1024, height: 1024 });
    let preserved = true, transparent = 0, opaque = 0;
    for (let at = 0; at < output.data.length; at += 4) { for (let channel = 0; channel < 3; channel++) if (output.data[at + channel] !== original.data[at + channel]) preserved = false; if (!output.data[at + 3]) transparent++; if (output.data[at + 3] === 255) opaque++; }
    expect(preserved).toBe(true); expect(transparent).toBeGreaterThan(0); expect(opaque).toBeGreaterThan(0); expect(alpha.data.length).toBe(1254 * 1254 * 4);
  });
});
