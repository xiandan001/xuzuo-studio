import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// A normal clone uses npm ci in the repository. Keep the older isolated setup
// working for existing Windows development installations.
const runtime = fs.existsSync(path.join(root, 'node_modules/vite/package.json')) ? root : path.join(root, 'work/ui-build');
const action = process.argv[2] || 'dev';
const actions = ['dev', 'build', 'preview', 'desktop', 'test', 'package', 'package:mac', 'package:mac:dir'];
if (!actions.includes(action)) throw new Error(`Unsupported UI command: ${action}`);
if (!fs.existsSync(path.join(runtime, 'node_modules/vite/package.json'))) throw new Error('缺少依赖：请在仓库根目录使用 Node.js 24 执行 npm ci。');
if (action.startsWith('package:mac') && process.platform !== 'darwin') throw new Error('macOS 应用必须在 Mac 上构建。');

function run(file, args = [], cwd = root) {
  const result = spawnSync(process.execPath, [file, ...args], { cwd, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const script = (name, args) => run(path.join(root, 'scripts', name), args);
const bin = (name, filename, args) => run(path.join(runtime, 'node_modules', name, filename), args, runtime);

script('build-spreadsheet-runtime.mjs');
if (process.platform === 'win32') script('build-drive-helper.mjs');
if (runtime !== root) {
  for (const directory of ['src', 'electron', 'assets']) fs.cpSync(path.join(root, directory), path.join(runtime, directory), { recursive: true });
  for (const filename of ['index.html', 'dialog.html', 'tsconfig.json', 'vite.config.ts']) fs.copyFileSync(path.join(root, filename), path.join(runtime, filename));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  manifest.build.directories.output = path.resolve(root, manifest.build.directories.output);
  for (const config of [manifest.build, manifest.build.win, manifest.build.mac]) {
    if (config?.extraResources) config.extraResources = config.extraResources.map(item => typeof item === 'string' ? path.resolve(root, item) : { ...item, from: path.resolve(root, item.from) });
  }
  fs.writeFileSync(path.join(runtime, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
}
const build = () => { bin('typescript', 'bin/tsc', ['-b']); bin('vite', 'bin/vite.js', ['build']); };
switch (action) {
  case 'dev': bin('vite', 'bin/vite.js', ['--host', '127.0.0.1', ...process.argv.slice(3)]); break;
  case 'preview': bin('vite', 'bin/vite.js', ['preview', '--host', '127.0.0.1', ...process.argv.slice(3)]); break;
  case 'test': bin('vitest', 'vitest.mjs', ['run', '--maxWorkers=1', ...process.argv.slice(3)]); break;
  case 'desktop': bin('electron', 'cli.js', ['.', ...process.argv.slice(3)]); break;
  case 'build': build(); break;
  default: {
    build();
    script('build-animation-tool.mjs');
    const builderArgs = ['--publish', 'never'];
    if (process.platform === 'darwin') {
      script('build-macos-icon.mjs');
      // Avoid a second Electron download when npm ci already verified it.
      builderArgs.push('--mac', ...(action.endsWith(':dir') ? ['dir'] : ['dmg', 'zip']), `--${process.arch}`, `--config.electronDist=${path.join(runtime, 'node_modules/electron/dist')}`);
    } else if (process.platform === 'win32') {
      script('build-setup.mjs', ['runtime']); builderArgs.push('--win', 'dir');
    } else throw new Error('桌面安装包目前支持 macOS 和 Windows。');
    bin('electron-builder', 'cli.js', [...builderArgs, ...process.argv.slice(3)]);
    if (process.platform === 'win32') script('build-setup.mjs', ['package']);
  }
}
