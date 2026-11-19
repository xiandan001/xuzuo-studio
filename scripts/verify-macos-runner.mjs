// Fail before packaging if a native runner or its Python interpreter has the wrong architecture.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const report = { passed: false, commit: process.env.GITHUB_SHA || null, version: manifest.version, localDiagnostic: process.env.GITHUB_ACTIONS !== 'true', platform: process.platform, arch: process.arch, expectedArch: process.argv[2], errors: [] };
try {
  assert.equal(process.platform, 'darwin');
  assert(['arm64', 'x64'].includes(report.expectedArch));
  assert.equal(process.arch, report.expectedArch);
  report.machine = execFileSync('/usr/bin/uname', ['-m'], { encoding: 'utf8' }).trim();
  report.pythonMachine = execFileSync(process.env.ANIMATION_PYTHON || 'python3', ['-c', 'import platform; print(platform.machine())'], { encoding: 'utf8' }).trim();
  const expectedMachine = process.arch === 'x64' ? 'x86_64' : 'arm64';
  assert.equal(report.machine, expectedMachine);
  assert.equal(report.pythonMachine, expectedMachine);
  if (process.env.GITHUB_ACTIONS === 'true') assert(/^[a-f0-9]{40}$/.test(report.commit || ''));
  report.passed = true;
} catch (error) { report.errors.push(String(error.stack || error)); process.exitCode = 1; }
fs.mkdirSync(path.join(root, 'work'), { recursive: true });
fs.writeFileSync(path.join(root, 'work/macos-runner-verification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
