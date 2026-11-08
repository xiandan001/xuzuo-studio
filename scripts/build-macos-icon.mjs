import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'darwin') throw new Error('macOS 图标必须在 Mac 上构建。');
const work = path.join(root, 'work'); fs.mkdirSync(work, { recursive: true });
const temporary = fs.mkdtempSync(path.join(work, 'macos-icon-'));
const iconset = path.join(temporary, 'app.iconset'); fs.mkdirSync(iconset);
const source = path.join(root, 'assets/app-icon.png');
for (const size of [16, 32, 128, 256, 512]) for (const scale of [1, 2]) {
  execFileSync('/usr/bin/sips', ['-z', String(size * scale), String(size * scale), source, '--out', path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)], { stdio: 'ignore' });
}
execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', path.join(root, 'assets/app-icon.icns')]);
console.log('Built macOS application icon.');
