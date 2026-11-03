import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { originalStarterGraphics } from './starter-graphics.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'assets/library');
const require = createRequire(path.join(root, 'work/ui-build/package.json'));
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server'), lucide = require('lucide-react');
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(root, 'work/playwright-browsers');
const { chromium } = require(process.env.XUZUO_PLAYWRIGHT_MODULE || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const cc0 = await fs.readFile(path.join(directory, 'licenses/CC0-1.0.txt'), 'utf8');
const isc = await fs.readFile(path.join(directory, 'licenses/ISC-LUCIDE.txt'), 'utf8');
const localLucide = require('lucide-react/package.json');
if (localLucide.version !== '0.468.0') throw new Error('The starter icon pack is pinned to the verified Lucide 0.468.0 release.');
if (isc !== (await fs.readFile(require.resolve('lucide-react/LICENSE'), 'utf8')).replace(/\r\n?/g, '\n')) throw new Error('Bundled ISC text must match the installed verified Lucide release.');

const crcTable = Array.from({ length: 256 }, (_, index) => { let value = index; for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1; return value >>> 0; });
function pngChunk(type, content) {
  const tag = Buffer.from(type), body = Buffer.concat([tag, content]); let crc = 0xffffffff;
  for (const byte of body) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8;
  const header = Buffer.alloc(4), trailer = Buffer.alloc(4); header.writeUInt32BE(content.length); trailer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, body, trailer]);
}
function licensedPng(bytes, notice, source) {
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Expected a real rendered PNG.');
  const chunks = [['License', notice], ['Source', source || 'Original vector source included in Xuzuo Studio starter pack v1']].map(([key, value]) => pngChunk('tEXt', Buffer.from(`${key}\0${value}`, 'latin1')));
  return Buffer.concat([bytes.subarray(0, 33), ...chunks, bytes.subarray(33)]);
}

const iconDefinitions = [
  ['Target', 'target', '目标靶心', ['目标', '策略']], ['Lightbulb', 'lightbulb', '灵感灯泡', ['创意', '想法']],
  ['ChartNoAxesCombined', 'chart-no-axes-combined', '趋势图示', ['分析', '趋势']], ['ShieldCheck', 'shield-check', '检查盾牌', ['验收', '安全']],
  ['UsersRound', 'users-round', '协作团队', ['团队', '用户']], ['CalendarCheck2', 'calendar-check-2', '日程确认', ['日期', '计划']],
  ['PackageCheck', 'package-check', '交付包裹', ['交付', '产品']], ['Workflow', 'workflow', '流程节点', ['流程', '连接']],
];
const originals = originalStarterGraphics().map(asset => ({ ...asset, origin: 'original', author: 'Xuzuo Studio contributors', licenseId: 'CC0-1.0', sourceVersion: 'xuzuo-starter-v1', sourceUrl: '', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', licenseNotice: '原创几何素材，按 CC0 1.0 提供；可修改、用于商业项目及再分发，无强制署名。', usageNote: '可作为文档、演示或图片作品中的配图。图解是通用结构示意，不是业务数据；SVG 原始文件随包提供。' }));
const icons = iconDefinitions.map(([component, file, name, tags]) => {
  if (!lucide[component]) throw new Error(`Missing pinned Lucide icon: ${component}`);
  const sourceUrl = `https://github.com/lucide-icons/lucide/blob/0.468.0/icons/${file}.svg`;
  return { id: `lucide-${file}`, name, description: `Lucide 0.468.0 线性${name}图标，透明背景，适合说明页与图文排版。`, collection: '开源图标', tags: ['图标', '透明PNG', 'Lucide', ...tags], width: 512, height: 512, transparent: true, origin: 'open-source', author: 'Lucide Contributors / Cole Bemis', licenseId: 'ISC', sourceVersion: '0.468.0', sourceUrl, licenseUrl: 'https://github.com/lucide-icons/lucide/blob/0.468.0/LICENSE', licenseNotice: 'ISC 许可，允许商业使用、修改和分发；复制时须保留版权与许可文本。', usageNote: '适合信息说明，不代表任何认证或背书。PNG 元数据和 SVG 注释内已保留完整许可；提供给客户时也应一并保留素材授权说明。', content: renderToStaticMarkup(React.createElement(lucide[component], { width: 512, height: 512, strokeWidth: 1.5, color: '#356D87', xmlns: 'http://www.w3.org/2000/svg', 'aria-label': name })) };
});

for (const folder of ['sources', 'files', 'thumbnails']) await fs.mkdir(path.join(directory, folder), { recursive: true });
const browser = await chromium.launch({ headless: true });
const catalog = { version: 1, packId: 'xuzuo-starter-v1', updatedAt: '2026-11-02', licenses: [
  { id: 'CC0-1.0', name: 'CC0 1.0 Universal', path: 'licenses/CC0-1.0.txt', url: 'https://creativecommons.org/publicdomain/zero/1.0/', notice: cc0 },
  { id: 'ISC', name: 'ISC · Lucide 0.468.0', path: 'licenses/ISC-LUCIDE.txt', url: 'https://github.com/lucide-icons/lucide/blob/0.468.0/LICENSE', notice: isc },
], assets: [] };
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 }); await page.route('http://**', route => route.abort()); await page.route('https://**', route => route.abort());
  for (const asset of [...originals, ...icons]) {
    const notice = asset.origin === 'open-source' ? isc : 'CC0 1.0 Universal. Original geometric artwork by Xuzuo Studio contributors. To the extent copyright applies, dedicated to the public domain. https://creativecommons.org/publicdomain/zero/1.0/';
    const source = `<!-- ${notice.replaceAll('--', '—')} -->\n${asset.content}\n`;
    const sourceBytes = Buffer.from(source), fullPath = `files/${asset.id}.png`, thumbnailPath = `thumbnails/${asset.id}.png`, vectorPath = `sources/${asset.id}.svg`;
    await fs.writeFile(path.join(directory, vectorPath), sourceBytes);
    await page.setViewportSize({ width: asset.width, height: asset.height });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${asset.content}`);
    await page.evaluate(() => document.fonts.ready);
    const full = licensedPng(await page.screenshot({ omitBackground: true }), notice, asset.sourceUrl);
    await fs.writeFile(path.join(directory, fullPath), full);
    const thumbnailWidth = 320, thumbnailHeight = Math.round(asset.height / asset.width * thumbnailWidth);
    await page.setViewportSize({ width: thumbnailWidth, height: thumbnailHeight });
    const thumbnail = licensedPng(await page.screenshot({ omitBackground: true }), notice, asset.sourceUrl);
    await fs.writeFile(path.join(directory, thumbnailPath), thumbnail);
    const { content: _content, ...metadata } = asset;
    catalog.assets.push({ ...metadata, kind: 'image', mimeType: 'image/png', path: fullPath, thumbnailPath, vectorPath, bytes: full.length, sha256: sha(full), thumbnailBytes: thumbnail.length, thumbnailSha256: sha(thumbnail), vectorBytes: sourceBytes.length, vectorSha256: sha(sourceBytes) });
  }
} finally { await browser.close(); }
await fs.writeFile(path.join(directory, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
const bytes = catalog.assets.reduce((total, asset) => total + asset.bytes + asset.thumbnailBytes + asset.vectorBytes, 0);
if (catalog.assets.length !== 28 || bytes > 3 * 1024 * 1024) throw new Error(`Unexpected starter pack: ${catalog.assets.length} assets, ${bytes} bytes`);
console.log(JSON.stringify({ assets: catalog.assets.length, original: originals.length, openSource: icons.length, bytes, modelCalls: 0, catalog: 'assets/library/catalog.json' }));
