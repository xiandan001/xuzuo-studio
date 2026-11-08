import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { finished } from 'node:stream/promises';
import { verifyAnimationRuntimeBinding } from './animation-runtime-binding.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dependencies = createRequire(path.join(root, 'work/ui-build/package.json'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const work = path.join(root, 'work/setup-runtime');
const release = path.resolve(root, manifest.build.directories.output);
const sources = ['setup-contracts.cs', 'setup-engine.cs', 'setup-program.cs', 'setup-ui.cs', 'setup-update.cs'].map(name => path.join(root, 'scripts/native', name));
const ui = path.join(root, 'assets/setup-window.xaml'), icon = path.join(root, 'assets/app-icon.png');
const windows = process.env.SystemRoot || 'C:/Windows';
const framework = path.join(windows, 'Microsoft.NET/Framework64/v4.0.30319');
const compiler = path.join(framework, 'csc.exe');
const references = ['System.dll', 'System.Core.dll', 'System.Xml.dll', 'System.Xaml.dll', 'System.Web.Extensions.dll', 'System.IO.Compression.dll', 'System.IO.Compression.FileSystem.dll', 'Microsoft.CSharp.dll'].map(name => path.join(framework, name)).concat(['WindowsBase.dll', 'PresentationCore.dll', 'PresentationFramework.dll'].map(name => path.join(framework, 'WPF', name)));
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
await fsp.mkdir(work, { recursive: true });

export function setupMetadata(overrides = {}) {
  const appId = overrides.appId || manifest.build.appId;
  const installGuid = dependencies('builder-util-runtime').UUID.v5(appId, '50e065bc-3134-11e6-9bab-38c9862bdaf3');
  return { format: 1, appId, version: manifest.version, executable: `${manifest.build.productName}.exe`, executableProductName: manifest.build.productName, productName: manifest.build.productName, installGuid, uninstallRegistryKey: `Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${installGuid}`, defaultDirectoryName: manifest.name, shortcutName: manifest.build.productName, validation: false, legacyFiles: [{ path: 'resources/elevate.exe', bytes: 107520, sha256: '9b1fbf0c11c520ae714af8aa9af12cfd48503eedecd7398d8992ee94d1b4dc37' }], ...overrides };
}
export async function compileSetup(target, metadata, resources = {}) {
  if (process.platform !== 'win32' || !fs.existsSync(compiler)) throw Error('自定义安装器需要 Windows .NET Framework 编译环境。');
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const directory = path.join(work, 'compile', digest(Buffer.from(path.resolve(target))).slice(0, 16)); await fsp.mkdir(directory, { recursive: true });
  const tag = path.basename(target, '.exe');
  const metadataFile = path.join(directory, `${tag}.metadata.json`), versionFile = path.join(directory, `${tag}.version.cs`);
  await fsp.writeFile(metadataFile, JSON.stringify(metadata, null, 2) + '\n', 'utf8');
  const numericVersion = metadata.version.split('-')[0] + '.0';
  await fsp.writeFile(versionFile, `using System.Reflection;\n[assembly:AssemblyTitle("Xuzuo Studio Setup")]\n[assembly:AssemblyProduct("Xuzuo Studio Setup")]\n[assembly:AssemblyCompany("Xuzuo Studio")]\n[assembly:AssemblyVersion("${numericVersion}")]\n[assembly:AssemblyFileVersion("${numericVersion}")]\n`, 'utf8');
  const embedded = { 'Setup.Metadata.json': metadataFile, 'Setup.Ui.xaml': ui, 'Setup.Icon.png': icon, ...resources };
  const args = ['/nologo', '/noconfig', '/target:winexe', '/optimize+', '/platform:anycpu', '/utf8output', '/main:Xuzuo.Setup.SetupProgram', `/win32manifest:${path.join(root, 'scripts/native/setup.manifest')}`, `/win32icon:${path.join(root, 'assets/app-icon.ico')}`, ...references.map(file => `/reference:${file}`), ...Object.entries(embedded).map(([name, file]) => `/resource:${file},${name}`), `/out:${target}`, versionFile, ...sources];
  const signature = digest(Buffer.concat([...sources, ui, icon, path.join(root, 'scripts/native/setup.manifest'), versionFile, metadataFile].map(file => fs.readFileSync(file)).concat(Object.values(resources).map(file => Buffer.from(digest(fs.readFileSync(file)))))));
  const stamp = path.join(directory, 'build.json'); let cached;
  try { cached = JSON.parse(await fsp.readFile(stamp, 'utf8')); } catch { /* A missing compiler cache is rebuilt. */ }
  if (cached?.signature === signature && fs.existsSync(target) && digest(fs.readFileSync(target)) === cached.sha256) return target;
  execFileSync(compiler, args, { windowsHide: true, encoding: 'utf8', timeout: 120000, maxBuffer: 1048576 });
  await fsp.writeFile(stamp, JSON.stringify({ signature, sha256: digest(fs.readFileSync(target)) }, null, 2) + '\n');
  return target;
}
export async function managedManifest(directory, metadata) {
  const files = [], names = new Set();
  async function visit(current) {
    for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name), stat = await fsp.lstat(absolute);
      if (stat.isSymbolicLink()) throw Error(`安装目录不允许链接：${absolute}`);
      if (stat.isDirectory()) await visit(absolute);
      else if (stat.isFile()) {
        const relative = path.relative(directory, absolute).replaceAll('\\', '/');
        if (relative === 'resources/xuzuo-install-manifest.json') throw Error('构建输入不应包含运行时安装收据。');
        if (names.has(relative.toLowerCase())) throw Error(`重复安装路径：${relative}`); names.add(relative.toLowerCase());
        const hash = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(absolute)) hash.update(chunk);
        files.push({ path: relative, bytes: stat.size, sha256: hash.digest('hex') });
      } else throw Error(`不支持的安装目录项：${absolute}`);
    }
  }
  await visit(directory); files.sort((a, b) => a.path.localeCompare(b.path));
  for (const required of [metadata.executable, 'resources/app.asar', 'resources/xuzuo-maintenance.exe']) if (!files.some(item => item.path === required)) throw Error(`安装资源缺失：${required}`);
  await verifyAnimationRuntimeBinding(root, new Map(files.map(file => [file.path, file])));
  return { format: 1, appId: metadata.appId, version: metadata.version, executable: metadata.executable, files };
}
export async function archivePayload(directory, files, target, overrides = {}) {
  const archive = dependencies('archiver')('zip', { zlib: { level: 6 } });
  const output = fs.createWriteStream(target); const written = finished(output);
  archive.on('error', error => output.destroy(error));
  archive.on('warning', error => output.destroy(error)); archive.pipe(output);
  for (const item of files) archive.file(overrides[item.path] || path.join(directory, item.path), { name: item.path });
  await archive.finalize(); await written; return target;
}
async function main() {
  const phase = process.argv[2];
  if (phase === 'runtime') {
    const file = await compileSetup(path.join(work, 'xuzuo-maintenance.exe'), setupMetadata());
    console.log(`Custom setup maintenance ready (${fs.statSync(file).size} bytes).`); return;
  }
  if (phase === 'package') {
    const metadata = setupMetadata(), directory = path.join(release, 'win-unpacked');
    const files = await managedManifest(directory, metadata), manifestFile = path.join(work, `payload-${metadata.version}.manifest.json`);
    await fsp.writeFile(manifestFile, JSON.stringify(files, null, 2) + '\n', 'utf8');
    const payload = await archivePayload(directory, files.files, path.join(work, `payload-${metadata.version}.zip`));
    const installer = path.join(release, `Xuzuo-Studio-Setup-${metadata.version}.exe`);
    await compileSetup(installer, metadata, { 'Setup.Payload.zip': payload, 'Setup.Manifest.json': manifestFile });
    await fsp.copyFile(manifestFile, path.join(release, `Xuzuo-Studio-Setup-${metadata.version}.manifest.json`));
    const blockmap = dependencies('app-builder-lib/out/targets/blockmap/blockmap.js');
    await blockmap.buildBlockMap(installer, 'gzip', `${installer}.blockmap`);
    const sha256 = crypto.createHash('sha256'), sha512 = crypto.createHash('sha512');
    for await (const chunk of fs.createReadStream(installer)) { sha256.update(chunk); sha512.update(chunk); }
    const name = path.basename(installer), bytes = fs.statSync(installer).size, checksum = sha512.digest('base64');
    const update = { version: metadata.version, files: [{ url: name, sha512: checksum, size: bytes }], path: name, sha512: checksum, releaseDate: new Date().toISOString() };
    await fsp.writeFile(path.join(release, 'latest.yml'), JSON.stringify(update, null, 2) + '\n', 'utf8');
    console.log(JSON.stringify({ installer, bytes, files: files.files.length, unpackedBytes: files.files.reduce((sum, file) => sum + file.bytes, 0), sha256: sha256.digest('hex') })); return;
  }
  if (phase) throw Error(`Unsupported setup phase: ${phase}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
