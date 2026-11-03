import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.XUZUO_PLAYWRIGHT_MODULE || 'playwright');
const directory = path.join(root, 'work', 'icon-qa');
const svg = await fs.readFile(path.join(root, 'assets', 'app-icon.svg'), 'utf8');
await fs.mkdir(directory, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.XUZUO_CHROMIUM_EXECUTABLE ? { executablePath: process.env.XUZUO_CHROMIUM_EXECUTABLE } : {}),
});
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    await page.screenshot({ path: path.join(directory, `${size}.png`), omitBackground: true });
  }
  await fs.copyFile(path.join(directory, '256.png'), path.join(root, 'assets', 'app-icon.png'));
  await fs.copyFile(path.join(directory, '512.png'), path.join(root, 'assets', 'app-icon-512.png'));
} finally {
  await browser.close();
}
console.log('Rendered the SVG at native icon sizes. Run scripts/verify-app-icon.py --create to write and verify the ICO.');
