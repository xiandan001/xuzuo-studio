import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assert(['win32', 'darwin'].includes(process.platform), 'The distributable animation runtime must be built on Windows or macOS.');
const executableName = process.platform === 'win32' ? 'xuzuo-animation.exe' : 'xuzuo-animation';
const { cleanEnvironment } = createRequire(import.meta.url)('../electron/animation-tool.cjs');
const python = process.env.ANIMATION_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
assert(!/[\r\n\0]/.test(python));
const env = cleanEnvironment(), runtimeParent = path.join(root, 'work/animation-runtime');
const target = path.join(runtimeParent, 'xuzuo-animation'), cacheFile = path.join(root, 'work/animation-runtime-build.json');
const hash = value => createHash('sha256').update(value).digest('hex');
try { os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* CI may already restrict scheduling. */ }
const probe = `import importlib.metadata as m,json,sys,sysconfig
from pathlib import Path
records=[]
for name in ['Pillow','PyInstaller']:
 d=m.distribution(name)
 licenses=[]
 for item in d.files or []:
  if '/licenses/' in str(item).replace('\\\\','/').lower() or Path(str(item)).name.lower() in ['license','license.txt','copying','copying.txt']:
   p=Path(d.locate_file(item))
   if p.is_file() and p.stat().st_size < 300000:
    licenses.append({'name':p.name,'text':p.read_text(encoding='utf-8')})
 if not licenses: raise RuntimeError('Missing distribution license: '+name)
 records.append({'name':name,'version':d.version,'licenses':licenses})
license=next((p for p in [Path(sys.base_prefix)/'LICENSE.txt', Path(sysconfig.get_path('stdlib'))/'LICENSE.txt'] if p.is_file()), None)
if license is None: raise RuntimeError('Python LICENSE.txt missing')
print(json.dumps({'python':sys.version,'pythonLicense':license.read_text(encoding='utf-8'),'packages':records}))`;
let metadata;
try { metadata = JSON.parse(execFileSync(python, ['-c', probe], { cwd: root, env, windowsHide: true, encoding: 'utf8', timeout: 15000, maxBuffer: 2 * 1024 * 1024 })); }
catch { throw Error('动画构建需要受控环境中的Python及固定构建依赖。请先安装tools/gif-factory/build-requirements.txt；此脚本不会自动安装或下载。'); }
assert.equal(metadata.packages.find(item => item.name === 'Pillow')?.version, '12.1.1');
assert.equal(metadata.packages.find(item => item.name === 'PyInstaller')?.version, '6.22.3');
const sourceFiles = ['main.py', 'manifest.py', 'motion.py', 'render.py', 'encode.py', 'safe_paths.py', 'build-requirements.txt'].map(name => path.join(root, 'tools/gif-factory', name));
const flags = ['--onedir', '--console', '--clean', '--noconfirm', '--name', 'xuzuo-animation', '--paths', path.join(root, 'tools/gif-factory'), '--exclude-module', 'tkinter', '--exclude-module', 'numpy', '--exclude-module', 'matplotlib'];
const signature = hash(Buffer.concat([...sourceFiles.map(file => fs.readFileSync(file)), Buffer.from(JSON.stringify({ metadata, flags, platform: process.platform, arch: process.arch }))]));
function inventory(directory, relative = '', result = []) {
  for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true })) {
    const name = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) {
      // PyInstaller uses relative framework links on macOS. Never follow links
      // during inventory, and accept only targets inside this owned runtime.
      assert.equal(process.platform, 'darwin');
      const target = fs.readlinkSync(path.join(directory, name));
      const canonical = fs.realpathSync(path.join(directory, name)), inside = path.relative(fs.realpathSync(directory), canonical);
      assert(!path.isAbsolute(target) && inside && inside !== '..' && !inside.startsWith('..' + path.sep) && !path.isAbsolute(inside));
      result.push({ path: name.replaceAll('\\', '/'), symlink: target });
    } else if (entry.isDirectory()) inventory(directory, name, result);
    else { assert(entry.isFile()); const bytes = fs.readFileSync(path.join(directory, name)); result.push({ path: name.replaceAll('\\', '/'), bytes: bytes.length, sha256: hash(bytes) }); }
  }
  return result;
}
let cached; try { cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { /* A clean CI build has no cache. */ }
if (cached?.signature === signature && fs.existsSync(target)) {
  assert.deepEqual(inventory(target), cached.files, 'Cached animation runtime changed.');
  console.log(JSON.stringify({ reused: true, directory: target, signature, files: cached.files.length }));
} else {
  assert(!fs.existsSync(target), 'Existing runtime is preserved. Build from a clean controlled work directory.');
  fs.mkdirSync(runtimeParent, { recursive: true });
  assert.equal(fs.realpathSync(runtimeParent).toLowerCase(), runtimeParent.toLowerCase());
  const temporary = fs.mkdtempSync(path.join(root, 'work/animation-build-'));
  fs.writeFileSync(path.join(temporary, 'owner.json'), JSON.stringify({ kind: 'animation-runtime-build', directory: temporary, signature, nonce: randomUUID() }) + '\n', { flag: 'wx' });
  execFileSync(python, ['-m', 'PyInstaller', ...flags, '--distpath', path.join(temporary, 'dist'), '--workpath', path.join(temporary, 'work'), '--specpath', temporary, sourceFiles[0]], { cwd: root, env, windowsHide: true, timeout: 240000, stdio: 'inherit' });
  const built = path.join(temporary, 'dist/xuzuo-animation');
  const magic = fs.readFileSync(path.join(built, executableName)).subarray(0, 4).toString('hex');
  assert(process.platform === 'win32' ? magic.startsWith('4d5a') : ['cffaedfe', 'cefaedfe', 'cafebabe', 'bebafeca'].includes(magic), 'Runtime binary format does not match the build host');
  const licenses = path.join(built, 'licenses'); fs.mkdirSync(licenses);
  fs.writeFileSync(path.join(licenses, 'Python.txt'), metadata.pythonLicense.replaceAll('\r\n', '\n'), 'utf8');
  for (const record of metadata.packages) for (const [index, license] of record.licenses.entries()) fs.writeFileSync(path.join(licenses, `${record.name}-${index + 1}.txt`), license.text.replaceAll('\r\n', '\n'), 'utf8');
  fs.copyFileSync(path.join(root, 'assets/licenses/gif-factory.txt'), path.join(licenses, 'gif-factory.txt'));
  const status = JSON.parse(execFileSync(path.join(built, executableName), ['status'], { cwd: built, env, windowsHide: true, timeout: 15000, encoding: 'utf8' }));
  assert.equal(status.available, true); assert.equal(status.protocol, 1); assert.equal(status.offline, true); assert.equal(status.pillow, '12.1.1');
  assert.equal(path.dirname(path.resolve(target)), path.resolve(runtimeParent));
  assert.equal(path.dirname(fs.realpathSync(built)), path.join(temporary, 'dist'));
  fs.renameSync(built, target);
  const files = inventory(target); assert(files.length > 5 && files.length < 512);
  const result = { version: 1, directory: target, signature, files, python: metadata.python, packages: metadata.packages.map(({ name, version }) => ({ name, version })), status, type: 'onedir', platform: process.platform, arch: process.arch, userDependencyInstallationRequired: false };
  fs.writeFileSync(cacheFile, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ built: true, directory: target, signature, files: files.length, bytes: files.reduce((sum, file) => sum + (file.bytes || 0), 0), status }));
}
