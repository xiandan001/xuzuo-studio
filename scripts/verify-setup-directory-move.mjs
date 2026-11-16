import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argument = process.argv.find(value => value.startsWith('--output='));
const output = path.resolve(root, argument?.slice(9) || 'work/setup-directory-move-output');
assert.equal(process.platform, 'win32'); assert(output.startsWith(path.join(root, 'work') + path.sep));
await fs.mkdir(output); const scratch = path.join(output, 'scratch'); await fs.mkdir(scratch);
const sources = ['setup-directory-move.cs', 'setup-directory-move-fixture.cs'].map(name => path.join(root, 'scripts/native', name));
const report = { passed: false, commit: process.env.GITHUB_SHA || null, version: JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version, normalApplicationStarted: false, installerExecuted: false, registryTouched: false, providerCalls: 0 };
const invoke = (file, args, timeout) => new Promise(resolve => execFile(file, args, { cwd: root, windowsHide: true, timeout, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => resolve({ code: error?.code || 0, expired: !!error?.killed, stdout, stderr })));
try {
  report.sources = await Promise.all(sources.map(async file => ({ name: path.relative(root, file).replaceAll('\\', '/'), sha256: createHash('sha256').update(await fs.readFile(file)).digest('hex') })));
  const executable = path.join(output, 'directory-move-fixture.exe');
  report.compiler = await invoke(path.join(process.env.SystemRoot || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), ['/nologo', '/optimize+', '/target:exe', '/r:System.Core.dll', '/r:System.Web.Extensions.dll', '/main:Xuzuo.Setup.SetupDirectoryMoveFixture', '/out:' + executable, ...sources], 30000);
  assert.equal(report.compiler.code, 0, report.compiler.stdout + report.compiler.stderr);
  report.execution = await invoke(executable, [scratch], 20000); assert.equal(report.execution.code, 0, report.execution.stdout + report.execution.stderr);
  report.fixture = JSON.parse(report.execution.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(report.fixture.passed, true); assert(Array.isArray(report.fixture.cases) && report.fixture.cases.length >= 3 && report.fixture.cases.every(item => item.passed === true));
  report.passed = true;
} catch (error) { report.error = String(error.stack || error); process.exitCode = 1; }
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ passed: report.passed, report: path.join(output, 'report.json'), cases: report.fixture?.cases, error: report.error }));
