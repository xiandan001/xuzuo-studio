import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dependencies = createRequire(path.join(root, 'package.json'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function inside(parent, target) {
  const relative = path.relative(parent, target);
  assert(relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative), 'Verification path escaped its owned root');
}
function safeRelative(value) {
  assert(typeof value === 'string' && value && !value.includes('\\') && !path.isAbsolute(value), 'Expected a relative forward-slash file path');
  for (const part of value.split('/')) {
    assert(part && part !== '.' && part !== '..' && !/[. ]$/.test(part) && !/[<>:"|?*\x00-\x1f]/.test(part), 'Unsafe managed path component');
    assert(!/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part), 'Reserved managed path component');
  }
  return value;
}
const stamp = stat => ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].map(key => String(stat[key])).join(':');
async function fileHashes(filename, algorithms = ['sha256']) {
  const before = await fsp.lstat(filename); assert(before.isFile() && !before.isSymbolicLink(), 'Expected an ordinary verification input');
  const hashes = algorithms.map(name => [name, createHash(name)]); let bytes = 0;
  for await (const chunk of fs.createReadStream(filename)) { bytes += chunk.length; for (const [, digest] of hashes) digest.update(chunk); }
  const after = await fsp.lstat(filename);
  assert(after.isFile() && !after.isSymbolicLink() && stamp(before) === stamp(after) && bytes === before.size, 'Verification input changed during hashing');
  return { bytes, ...Object.fromEntries(hashes.map(([name, digest]) => [name, digest.digest(name === 'sha512' ? 'base64' : 'hex')])) };
}
async function walkFiles(directory) {
  const stat = await fsp.lstat(directory); assert(stat.isDirectory() && !stat.isSymbolicLink(), 'Expected an ordinary verification directory');
  const files = new Map();
  async function visit(current, prefix) {
    for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
      const relative = safeRelative(prefix + entry.name), filename = path.join(current, entry.name), info = await fsp.lstat(filename);
      assert(!info.isSymbolicLink(), 'Verification tree contains a link: ' + relative);
      if (info.isDirectory()) await visit(filename, relative + '/');
      else { assert(info.isFile(), 'Verification tree contains an unsupported item'); files.set(relative, filename); }
    }
  }
  await visit(directory, ''); return files;
}
function readJson(filename) { return JSON.parse(fs.readFileSync(filename, 'utf8')); }
function child(executable, args, timeout = 120000) {
  const result = spawnSync(executable, args, { cwd: root, windowsHide: true, encoding: 'utf8', timeout, maxBuffer: 1024 * 1024 });
  if (result.error) throw result.error;
  return result;
}
function inspectorResult(executable, args) {
  const result = child(executable, args);
  let value;
  try { value = JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim()); }
  catch { throw Error(`Static inspector did not return JSON (exit ${result.status}): ${result.stderr || result.stdout}`); }
  return { status: result.status, value };
}
async function inspectInstaller(installer, sidecar, source, work) {
  const framework = path.join(process.env.SystemRoot || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319');
  const compiler = path.join(framework, 'csc.exe'), executable = path.join(work, 'inspect-built-setup.exe');
  const references = ['System.dll', 'System.Core.dll', 'System.Web.Extensions.dll', 'System.IO.Compression.dll', 'System.IO.Compression.FileSystem.dll'].map(name => path.join(framework, name));
  for (const file of [compiler, ...references]) assert(fs.existsSync(file), 'Missing .NET Framework inspection dependency: ' + file);
  const compiled = child(compiler, ['/nologo', '/noconfig', '/utf8output', '/target:exe', '/platform:anycpu', '/optimize+', ...references.map(file => '/reference:' + file), '/out:' + executable, path.join(root, 'scripts/native/inspect-built-setup.cs')]);
  assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout || 'Static inspector compilation failed');
  const args = [installer, sidecar, source.version, source.build.appId];
  const inspected = inspectorResult(executable, args);
  assert.equal(inspected.status, 0, JSON.stringify(inspected.value)); assert.equal(inspected.value.passed, true);
  assert.equal(inspected.value.manifestSha256, hash(await fsp.readFile(sidecar)));
  const damaged = path.join(work, 'sidecar-appended-space.manifest.json');
  await fsp.writeFile(damaged, Buffer.concat([await fsp.readFile(sidecar), Buffer.from(' ')]), { flag: 'wx' });
  const rejected = inspectorResult(executable, [installer, damaged, source.version, source.build.appId]);
  assert.equal(rejected.status, 1, 'Changed sidecar unexpectedly accepted');
  assert.equal(rejected.value.passed, false); assert.equal(rejected.value.code, 'MANIFEST_BYTES_MISMATCH', 'Negative case failed for an unrelated reason');
  return { ...inspected.value, modifiedSidecarRejected: true, negativeCode: rejected.value.code, inspectorSourceSha256: hash(await fsp.readFile(path.join(root, 'scripts/native/inspect-built-setup.cs'))) };
}
async function verifyArchive(archive, source, managedRoot, managedFiles) {
  const asar = dependencies('@electron/asar'), files = new Set();
  const native = relative => path.normalize(safeRelative(relative));
  const packed = relative => asar.extractFile(archive, native(relative), false);
  for (const entry of asar.listPackage(archive)) {
    const relative = safeRelative(entry.replace(/^[\\/]+/, '').replaceAll('\\', '/'));
    const info = asar.statFile(archive, native(relative), false);
    assert(!('link' in info), 'ASAR contains a link: ' + relative);
    if (!('files' in info)) {
      const first = relative.split('/')[0];
      assert(!['work', 'outputs', 'user-data', '.git'].includes(first) && !first.startsWith('.env'), 'Unexpected private/build data in ASAR');
      files.add(relative);
    }
  }
  assert(![...files].some(relative => /(?:^|\/)node_modules\/jsdom(?:\/|$)/.test(relative)), 'Development DOM test library must not be packaged');
  const packaged = JSON.parse(packed('package.json').toString('utf8'));
  assert.equal(packaged.name, source.name); assert.equal(packaged.version, source.version); assert.equal(packaged.main, source.main);
  const exclusions = new Set(['electron/credential-self-test.cjs', 'electron/live-self-test.cjs', 'assets/setup-window.xaml']);
  const counts = {};
  for (const scope of ['electron', 'assets', 'dist']) {
    const local = await walkFiles(path.join(root, scope));
    const expected = new Set([...local.keys()].map(file => `${scope}/${file}`).filter(file => !exclusions.has(file)));
    const observed = new Set([...files].filter(file => file.startsWith(scope + '/')));
    assert.deepEqual([...observed].sort(), [...expected].sort(), 'ASAR file set mismatch: ' + scope);
    for (const relative of expected) {
      const sourceFile = local.get(relative.slice(scope.length + 1)), identity = await fileHashes(sourceFile), bytes = packed(relative);
      assert.equal(bytes.length, identity.bytes, 'ASAR size mismatch: ' + relative); assert.equal(hash(bytes), identity.sha256, 'ASAR source/build mismatch: ' + relative);
    }
    counts[scope] = expected.size;
  }
  for (const relative of exclusions) assert(!files.has(relative), 'Excluded source was packaged: ' + relative);
  for (const html of ['dist/index.html', 'dist/dialog.html']) assert(packed(html).toString('utf8').replaceAll('&#39;', "'").includes("connect-src 'none'"), 'Renderer network CSP missing');
  const runtimeDependencies = [];
  for (const name of Object.keys(source.dependencies)) {
    const packagePath = `node_modules/${name}/package.json`;
    assert(files.has(packagePath), 'Production dependency missing from ASAR: ' + name);
    const installed = readJson(path.join(root, 'node_modules', ...name.split('/'), 'package.json'));
    const bundled = JSON.parse(packed(packagePath).toString('utf8'));
    assert.equal(bundled.version, installed.version, 'Bundled dependency version differs: ' + name);
    runtimeDependencies.push({ name, version: bundled.version });
  }
  assert(files.has('node_modules/xmlchars/package.json') || files.has('node_modules/saxes/node_modules/xmlchars/package.json'), 'Saxes xmlchars dependency missing from ASAR');
  const drive = 'assets/windows-drive-info.exe';
  assert.equal(asar.statFile(archive, native(drive), false).unpacked, true, 'Drive helper must be unpacked');
  const unpackedDrive = path.join(managedRoot, 'resources/app.asar.unpacked', native(drive));
  const driveHash = await fileHashes(unpackedDrive); assert.equal(driveHash.sha256, (await fileHashes(path.join(root, native(drive)))).sha256);
  const maintenance = 'resources/xuzuo-maintenance.exe', maintenanceHash = await fileHashes(path.join(managedRoot, native(maintenance)));
  assert.equal(maintenanceHash.sha256, (await fileHashes(path.join(root, 'work/setup-runtime/xuzuo-maintenance.exe'))).sha256, 'Maintenance extraResource mismatch');
  assert(managedFiles.has('resources/app.asar') && managedFiles.has(maintenance) && managedFiles.has('resources/app.asar.unpacked/' + drive));
  return { counts, runtimeDependencies, devDomLibraryExcluded: true, driveHelperUnpacked: true, maintenanceMatchesBuild: true, rendererNetworkCspPresent: true };
}
async function main() {
  assert.equal(process.platform, 'win32', 'Static setup resource inspection requires Windows');
  const source = readJson(path.join(root, 'package.json')), lock = readJson(path.join(root, 'package-lock.json'));
  assert.match(source.version, /^\d+\.\d+\.\d+$/); assert.equal(lock.version, source.version); assert.equal(lock.packages[''].version, source.version);
  assert.equal(lock.name, source.name); assert.equal(lock.packages[''].name, source.name);
  assert.match(process.env.GITHUB_SHA || '', /^[a-f0-9]{40}$/i, 'GITHUB_SHA must identify the exact clean-runner commit');
  const release = path.resolve(root, source.build.directories.output); inside(path.join(root, 'outputs'), release);
  const reportFile = path.join(release, 'package-verification.json');
  const report = { passed: false, commit: process.env.GITHUB_SHA, version: source.version, scope: 'static package, ASAR, embedded resources and ZIP integrity only; no GUI, application/installer startup, installation or OTA', deliveryFiles: [], installerWizardTested: false, applicationLaunchTested: false, otaPublished: false };
  try {
    assert(!fs.existsSync(reportFile), 'Refusing to overwrite an earlier package verification report');
    const name = `Xuzuo-Studio-Setup-${source.version}.exe`;
    const installer = path.join(release, name), sidecar = path.join(release, name.replace(/\.exe$/, '.manifest.json')), blockmap = installer + '.blockmap', latest = path.join(release, 'latest.yml');
    const before = new Map();
    for (const filename of [installer, blockmap, sidecar, latest]) {
      const identity = await fileHashes(filename, filename === installer ? ['sha256', 'sha512'] : ['sha256']); before.set(filename, identity);
      report.deliveryFiles.push({ name: path.basename(filename), bytes: identity.bytes, sha256: identity.sha256 });
    }
    assert.equal(report.deliveryFiles.length, 4);
    const metadata = readJson(latest), installerHash = before.get(installer);
    assert.equal(metadata.version, source.version); assert.equal(metadata.path, name); assert.equal(metadata.sha512, installerHash.sha512);
    assert.deepEqual(metadata.files, [{ url: name, sha512: installerHash.sha512, size: installerHash.bytes }]);
    assert(!Number.isNaN(Date.parse(metadata.releaseDate)), 'Invalid update release timestamp');
    const managed = readJson(sidecar), managedRoot = path.join(release, 'win-unpacked'), actual = await walkFiles(managedRoot), expected = new Map(), caseNames = new Set();
    assert.equal(managed.format, 1); assert.equal(managed.appId, source.build.appId); assert.equal(managed.version, source.version); assert.equal(managed.executable, `${source.build.productName}.exe`);
    assert(Array.isArray(managed.files) && managed.files.length > 0);
    for (const file of managed.files) {
      const relative = safeRelative(file.path), key = relative.toLowerCase();
      assert(!caseNames.has(key), 'Duplicate managed path'); caseNames.add(key);
      assert(Number.isSafeInteger(file.bytes) && file.bytes >= 0 && /^[a-f0-9]{64}$/.test(file.sha256), 'Invalid managed-file metadata');
      const filename = path.resolve(managedRoot, ...relative.split('/')); inside(managedRoot, filename);
      assert(actual.has(relative), 'Managed file missing: ' + relative);
      const identity = await fileHashes(filename); assert.equal(identity.bytes, file.bytes, relative); assert.equal(identity.sha256, file.sha256, relative); expected.set(relative, identity);
    }
    assert.deepEqual([...actual.keys()].sort(), [...expected.keys()].sort(), 'Managed manifest is not the exact runtime file set');
    for (const required of [managed.executable, 'resources/app.asar', 'resources/xuzuo-maintenance.exe']) assert(expected.has(required), 'Missing runtime file: ' + required);
    const archive = path.join(managedRoot, 'resources/app.asar');
    report.asar = await verifyArchive(archive, source, managedRoot, expected);
    await fsp.mkdir(path.join(root, 'work'), { recursive: true });
    const work = await fsp.mkdtemp(path.join(root, 'work/built-package-verification-')); inside(path.join(root, 'work'), work);
    const regenerated = path.join(work, 'independent.blockmap');
    await dependencies('app-builder-lib/out/targets/blockmap/blockmap.js').buildBlockMap(installer, 'gzip', regenerated);
    const originalMap = JSON.parse(gunzipSync(await fsp.readFile(blockmap))), rebuiltMap = JSON.parse(gunzipSync(await fsp.readFile(regenerated)));
    assert.deepEqual(rebuiltMap, originalMap, 'Blockmap differs from an independent rebuild of the actual installer');
    report.blockmap = { rebuiltJsonMatches: true, version: originalMap.version };
    report.embedded = await inspectInstaller(installer, sidecar, source, work);
    assert.equal(report.embedded.managedFiles, expected.size); assert.equal(report.embedded.executable, managed.executable);
    for (const [filename, identity] of before) assert.deepEqual(await fileHashes(filename, filename === installer ? ['sha256', 'sha512'] : ['sha256']), identity, 'Original delivery input changed');
    for (const relative of ['resources/app.asar', 'resources/xuzuo-maintenance.exe', 'resources/app.asar.unpacked/assets/windows-drive-info.exe']) assert.deepEqual(await fileHashes(path.join(managedRoot, path.normalize(relative))), expected.get(relative), 'Runtime verification input changed');
    report.managedFiles = expected.size; report.updateMetadataMatches = true; report.installerSha512 = installerHash.sha512; report.originalInputsUnchanged = true; report.passed = true;
  } catch (error) { report.error = error.stack || String(error); process.exitCode = 1; }
  await fsp.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ passed: report.passed, commit: report.commit, version: report.version, managedFiles: report.managedFiles, asarCounts: report.asar?.counts, deliveryFiles: report.deliveryFiles, installerWizardTested: false, applicationLaunchTested: false, otaPublished: false, reportFile, error: report.error }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
