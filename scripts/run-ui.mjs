import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = path.join(root, 'work', 'ui-build');
const action = process.argv[2] || 'dev';
const commands = {
  dev: 'vite --host 127.0.0.1',
  build: 'tsc -b && vite build',
  preview: 'vite preview --host 127.0.0.1',
  desktop: 'electron .',
  test: 'vitest run --maxWorkers=1',
  package: 'npm run build && electron-builder --win dir --publish never && node ../../scripts/build-setup.mjs package',
};
if (!(action in commands)) throw new Error(`Unsupported UI command: ${action}`);
if (!fs.existsSync(path.join(runtime, 'node_modules', 'vite', 'package.json'))) {
  throw new Error('UI build dependencies are missing in work/ui-build. See README.md.');
}
for (const script of ['build-spreadsheet-runtime.mjs', 'build-drive-helper.mjs']) {
  const dependencyBuild = spawnSync(process.execPath, [path.join(root, 'scripts', script)], { cwd: root, stdio: 'inherit' });
  if (dependencyBuild.error) throw dependencyBuild.error;
  if (dependencyBuild.status !== 0) process.exit(dependencyBuild.status ?? 1);
}
if (action === 'package') {
  const setupBuild = spawnSync(process.execPath, [path.join(root, 'scripts/build-setup.mjs'), 'runtime'], { cwd: root, stdio: 'inherit' });
  if (setupBuild.error) throw setupBuild.error;
  if (setupBuild.status !== 0) process.exit(setupBuild.status ?? 1);
}
for (const directory of ['src', 'electron', 'assets']) {
  fs.cpSync(path.join(root, directory), path.join(runtime, directory), { recursive: true });
}
for (const filename of ['index.html', 'dialog.html', 'tsconfig.json', 'vite.config.ts']) {
  fs.copyFileSync(path.join(root, filename), path.join(runtime, filename));
}
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
manifest.scripts = commands;
manifest.build.directories.output = path.resolve(root, manifest.build.directories.output);
manifest.build.extraResources = (manifest.build.extraResources || []).map(item => typeof item === 'string' ? path.resolve(root, item) : { ...item, from: path.resolve(root, item.from) });
fs.writeFileSync(path.join(runtime, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', action], {
  cwd: runtime,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
