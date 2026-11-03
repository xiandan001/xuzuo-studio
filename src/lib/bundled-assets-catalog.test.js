import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const directory = path.join(root, 'assets/library');
const catalog = JSON.parse(fs.readFileSync(path.join(directory, 'catalog.json'), 'utf8'));
const sha = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
function file(relative) {
  expect(relative).toMatch(/^(files|thumbnails|sources|licenses)\/[A-Za-z0-9.-]+$/);
  return fs.readFileSync(path.join(directory, relative));
}
function png(buffer) {
  expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  const data = { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), texts: {} };
  let position = 8, ended = false;
  while (position < buffer.length) {
    const length = buffer.readUInt32BE(position), type = buffer.toString('ascii', position + 4, position + 8), end = position + 12 + length;
    expect(end).toBeLessThanOrEqual(buffer.length);
    if (type === 'tEXt') {
      const value = buffer.toString('latin1', position + 8, position + 8 + length), at = value.indexOf('\0');
      data.texts[value.slice(0, at)] = value.slice(at + 1);
    }
    position = end;
    if (type === 'IEND') { ended = true; break; }
  }
  expect(ended).toBe(true); expect(position).toBe(buffer.length);
  return data;
}

describe('随安装包提供的实用素材', () => {
  it('实际提供28件离线图像和小缩略图，原作/开源来源与集合清楚且总图像体积有界', () => {
    expect(catalog.version).toBe(1); expect(catalog.assets).toHaveLength(28);
    expect(new Set(catalog.assets.map(asset => asset.id)).size).toBe(28);
    expect(catalog.assets.filter(asset => asset.origin === 'original')).toHaveLength(20);
    expect(catalog.assets.filter(asset => asset.origin === 'open-source')).toHaveLength(8);
    expect(new Set(catalog.assets.map(asset => asset.collection))).toEqual(new Set(['留白背景', '业务图解', '透明装饰', '开源图标']));
    expect(catalog.assets.reduce((sum, asset) => sum + asset.bytes + asset.thumbnailBytes + asset.vectorBytes, 0)).toBeLessThan(3 * 1024 * 1024);
  });
  it('每个PNG/SVG/缩略图实际存在、尺寸正确、哈希和大小与白名单清单一致', () => {
    for (const asset of catalog.assets) {
      for (const [kind, bytes, hash] of [['path', 'bytes', 'sha256'], ['thumbnailPath', 'thumbnailBytes', 'thumbnailSha256'], ['vectorPath', 'vectorBytes', 'vectorSha256']]) {
        const buffer = file(asset[kind]); expect(buffer.length).toBe(asset[bytes]); expect(sha(buffer)).toBe(asset[hash]);
      }
      const image = png(file(asset.path)), thumb = png(file(asset.thumbnailPath));
      expect([image.width, image.height]).toEqual([asset.width, asset.height]);
      expect(thumb.width).toBe(320); expect(thumb.height).toBe(Math.round(asset.height / asset.width * 320));
      const vector = file(asset.vectorPath).toString('utf8'); expect(vector).toContain('<svg');
      expect(vector).not.toMatch(/<script|<foreignObject|(?:href|src)\s*=/i);
    }
  });
  it('完整开源许可随包且随每个图标副本保留，不把ISC写成无条件免署名', () => {
    const license = catalog.licenses.find(item => item.id === 'ISC');
    expect(file(license.path).toString('utf8')).toBe(license.notice);
    expect(license.url).toBe('https://github.com/lucide-icons/lucide/blob/0.468.0/LICENSE');
    expect(license.notice).toContain('copyright notice');
    for (const asset of catalog.assets.filter(item => item.origin === 'open-source')) {
      expect(asset.sourceVersion).toBe('0.468.0');
      expect(asset.sourceUrl).toMatch(/^https:\/\/github\.com\/lucide-icons\/lucide\/blob\/0\.468\.0\/icons\/[a-z0-9-]+\.svg$/);
      expect(asset.licenseId).toBe('ISC'); expect(asset.licenseNotice).toContain('保留版权');
      expect(png(file(asset.path)).texts.License).toBe(license.notice);
      expect(png(file(asset.thumbnailPath)).texts.License).toBe(license.notice);
      expect(file(asset.vectorPath).toString('utf8')).toContain(license.notice.trim());
    }
  });
  it('原作CC0与开源许可分开，图解不伪造经营数据且图像有透明说明', () => {
    const license = catalog.licenses.find(item => item.id === 'CC0-1.0');
    expect(file(license.path).toString('utf8')).toBe(license.notice);
    expect(license.notice).toContain('CC0 1.0 Universal');
    for (const asset of catalog.assets.filter(item => item.origin === 'original')) {
      expect(asset.licenseId).toBe('CC0-1.0'); expect(asset.sourceUrl).toBe('');
      expect(png(file(asset.path)).texts.License).toContain('CC0 1.0 Universal');
      expect(asset.usageNote).toContain('不是业务数据');
    }
    expect(catalog.assets.filter(asset => asset.transparent)).toHaveLength(12);
  });
});
