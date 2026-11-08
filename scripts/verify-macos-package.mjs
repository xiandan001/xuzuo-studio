import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assert.equal(process.platform, 'darwin', 'Run macOS package verification on a Mac.');
const require = createRequire(import.meta.url);
const { cleanEnvironment } = require('../electron/animation-tool.cjs');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const release = path.resolve(root, manifest.build.directories.output);
const bundle = path.resolve(process.argv[2] || path.join(release, process.arch === 'arm64' ? 'mac-arm64' : 'mac', manifest.build.productName + '.app'));
const contents = path.join(bundle, 'Contents'), resources = path.join(contents, 'Resources');
const report = { passed: false, platform: process.platform, arch: process.arch, bundle, sourceFiles: 0, runtimeFiles: 0 };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  assert(fs.lstatSync(bundle).isDirectory() && !fs.lstatSync(bundle).isSymbolicLink());
  const info = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(contents, 'Info.plist')], { encoding: 'utf8' }));
  assert.equal(info.CFBundleIdentifier, manifest.build.appId);
  assert.equal(info.CFBundleShortVersionString, manifest.version);
  assert.equal(info.LSMinimumSystemVersion, manifest.build.mac.minimumSystemVersion);
  const runtimeInfo = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(root, 'node_modules/electron/dist/Electron.app/Contents/Info.plist')], { encoding: 'utf8' }));
  const version = value => String(value).split('.').reduce((sum, part, index) => sum + Number(part) * 1000 ** (2 - index), 0);
  assert(version(info.LSMinimumSystemVersion) >= version(runtimeInfo.LSMinimumSystemVersion), 'Bundle advertises a macOS version older than Electron supports');
  const framework = path.join(contents, 'Frameworks/Electron Framework.framework/Electron Framework');
  const frameworkInfo = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(contents, 'Frameworks/Electron Framework.framework/Resources/Info.plist')], { encoding: 'utf8' }));
  const runtimeVersion = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/electron/package.json'), 'utf8')).version;
  assert.equal(frameworkInfo.CFBundleVersion, runtimeVersion, 'Packaged Electron differs from the installed locked runtime');
  report.electron = runtimeVersion;
  const minimum = execFileSync('/usr/bin/otool', ['-l', framework], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).match(/\bminos\s+(\d[\d.]*)/);
  assert(minimum && version(info.LSMinimumSystemVersion) >= version(minimum[1]), 'Bundle minimum macOS is older than the actual Electron Mach-O');
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'pipe' });
  report.codeSignatureVerified = true;
  const executable = path.join(contents, 'MacOS', info.CFBundleExecutable);
  assert(fs.statSync(executable).mode & 0o111, 'Application executable lost its executable bit');
  const archs = filename => execFileSync('/usr/bin/lipo', ['-archs', filename], { encoding: 'utf8' }).trim().split(/\s+/);
  const expectedArch = process.arch === 'x64' ? 'x86_64' : 'arm64';
  assert(archs(executable).includes(expectedArch));
  assert(archs(path.join(contents, 'Frameworks/Electron Framework.framework/Electron Framework')).includes(expectedArch));
  assert(fs.statSync(path.join(resources, info.CFBundleIconFile)).size > 0);
  const asar = require('@electron/asar'), archive = path.join(resources, 'app.asar');
  for (const directory of ['dist', 'electron', 'assets']) {
    function compare(current, prefix) {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const relative = prefix + entry.name, filename = path.join(current, entry.name);
        if (entry.isDirectory()) compare(filename, relative + '/');
        else if (entry.isFile() && !['.DS_Store', 'windows-drive-info.exe', 'app-icon.ico', 'setup-window.xaml', 'credential-self-test.cjs', 'live-self-test.cjs'].includes(entry.name)) {
          const packaged = asar.extractFile(archive, relative);
          assert.equal(sha(packaged), sha(fs.readFileSync(filename)), 'Packaged source differs: ' + relative); report.sourceFiles++;
        }
      }
    }
    compare(path.join(root, directory), directory + '/');
  }
  const packagedManifest = JSON.parse(asar.extractFile(archive, 'package.json').toString());
  assert.equal(packagedManifest.version, manifest.version);
  assert.equal(packagedManifest.main, manifest.main);
  const names = asar.listPackage(archive);
  for (const file of ['/assets/windows-drive-info.exe', '/assets/setup-window.xaml']) assert(!names.includes(file), 'Windows-only resource included: ' + file);
  assert(!fs.existsSync(path.join(resources, 'xuzuo-maintenance.exe')));
  const runtime = path.join(resources, 'animation-tool'), cache = JSON.parse(fs.readFileSync(path.join(root, 'work/animation-runtime-build.json'), 'utf8'));
  assert.equal(cache.platform, 'darwin'); assert.equal(cache.arch, process.arch);
  let signatureScratch;
  function unsignedHash(filename) {
    signatureScratch ||= fs.mkdtempSync(path.join(root, 'work/macos-binary-verification-'));
    const copy = path.join(signatureScratch, String(fs.readdirSync(signatureScratch).length));
    fs.copyFileSync(filename, copy);
    execFileSync('/usr/bin/codesign', ['--remove-signature', copy], { stdio: 'pipe' });
    const bytes = fs.readFileSync(copy);
    assert.equal(bytes.readUInt32LE(0), 0xfeedfacf, 'Expected a native thin 64-bit Mach-O');
    let offset = 32;
    for (let index = 0; index < bytes.readUInt32LE(16); index++) {
      const command = bytes.readUInt32LE(offset), size = bytes.readUInt32LE(offset + 4);
      assert(size >= 8 && offset + size <= bytes.length);
      if (command === 0x19 && bytes.subarray(offset + 8, offset + 24).toString().replace(/\0.*$/, '') === '__LINKEDIT') {
        // codesign removes signature data but leaves the signature-dependent
        // mapped VM size. It contains no executable/data payload; normalize it.
        bytes.writeBigUInt64LE(0n, offset + 32);
      }
      offset += size;
    }
    return sha(bytes);
  }
  for (const file of cache.files) {
    const filename = path.join(runtime, file.path), info = fs.lstatSync(filename);
    if (file.symlink) { assert(info.isSymbolicLink()); assert.equal(fs.readlinkSync(filename), file.symlink); }
    else {
      assert(info.isFile());
      const bytes = fs.readFileSync(filename);
      if (sha(bytes) !== file.sha256) {
        assert(['cffaedfe', 'cefaedfe', 'cafebabe', 'bebafeca'].includes(bytes.subarray(0, 4).toString('hex')), 'Animation resource differs: ' + file.path);
        // Codesigning legitimately rewrites LC_CODE_SIGNATURE. Verify identical
        // unsigned Mach-O content while checking the complete signed bundle above.
        assert.equal(unsignedHash(filename), unsignedHash(path.join(cache.directory, file.path)), 'Animation executable content differs: ' + file.path);
      } else assert.equal(info.size, file.bytes);
    }
    report.runtimeFiles++;
  }
  const helper = path.join(runtime, 'xuzuo-animation'); assert(archs(helper).includes(expectedArch));
  const status = JSON.parse(execFileSync(helper, ['status'], { env: cleanEnvironment(), encoding: 'utf8', timeout: 15000 }));
  assert.equal(status.available, true); assert.equal(status.protocol, 1); assert.equal(status.offline, true); assert.equal(status.pillow, '12.1.1');
  report.animationStatus = status; report.passed = true;
} catch (error) { report.error = error.stack || String(error); process.exitCode = 1; }
fs.mkdirSync(release, { recursive: true });
fs.writeFileSync(path.join(release, 'macos-package-verification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
