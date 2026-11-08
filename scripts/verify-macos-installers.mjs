// Inspect actual delivery archives without installing into /Applications.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
assert.equal(process.platform, 'darwin');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const release = path.resolve(root, manifest.build.directories.output);
const basename = `Xuzuo-Studio-${manifest.version}-mac-${process.arch}`;
const reference = path.join(release, process.arch === 'arm64' ? 'mac-arm64' : 'mac', manifest.build.productName + '.app');
const temporary = fs.mkdtempSync(path.join(root, 'work/macos-installer-verification-'));
const mountpoint = path.join(temporary, 'mounted'); fs.mkdirSync(mountpoint);
const report = { passed: false, platform: process.platform, arch: process.arch, checks: [], files: [] };
const sha = filename => createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
const referenceAsar = sha(path.join(reference, 'Contents/Resources/app.asar'));
let mounted = false;
function verifyBundle(bundle) {
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'pipe' });
  assert.equal(sha(path.join(bundle, 'Contents/Resources/app.asar')), referenceAsar, 'Installer application differs from verified build');
  assert(fs.statSync(path.join(bundle, 'Contents/MacOS', manifest.build.productName)).mode & 0o111);
}
try {
  const dmg = path.join(release, basename + '.dmg'), zip = path.join(release, basename + '.zip');
  for (const file of [dmg, zip]) report.files.push({ path: file, bytes: fs.statSync(file).size, sha256: sha(file) });
  execFileSync('/usr/bin/hdiutil', ['verify', dmg], { stdio: 'pipe', timeout: 60000 });
  execFileSync('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mountpoint, dmg], { stdio: 'pipe', timeout: 60000 }); mounted = true;
  assert.equal(fs.readlinkSync(path.join(mountpoint, 'Applications')), '/Applications');
  verifyBundle(path.join(mountpoint, manifest.build.productName + '.app'));
  report.checks.push('DMG checksums verified; read-only mounted application has valid deep signature, executable permissions and identical app.asar; Applications shortcut is correct');
  const unpacked = path.join(temporary, 'unzipped'); fs.mkdirSync(unpacked);
  execFileSync('/usr/bin/ditto', ['-x', '-k', zip, unpacked], { stdio: 'pipe', timeout: 60000 });
  verifyBundle(path.join(unpacked, manifest.build.productName + '.app'));
  report.checks.push('ZIP extracted; application retains valid deep signature, executable permissions and identical app.asar');
  report.passed = true;
} catch (error) { report.error = error.stack || String(error); process.exitCode = 1; }
finally {
  if (mounted) {
    try { execFileSync('/usr/bin/hdiutil', ['detach', mountpoint], { stdio: 'pipe', timeout: 30000 }); }
    catch (error) { report.passed = false; report.detachError = error.message; process.exitCode = 1; }
  }
  fs.writeFileSync(path.join(release, 'macos-installer-verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
