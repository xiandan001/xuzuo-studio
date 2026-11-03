import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { setupMetadata, compileSetup } from './build-setup.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dependencies = createRequire(path.join(root, 'work/ui-build/package.json'));
const JSZip = dependencies('jszip');
if (process.platform !== 'win32') throw new Error('This native OTA validation requires Windows.');
const workspace = path.join(root, 'work');
await fs.mkdir(workspace, { recursive: true });
const fixture = await fs.mkdtemp(path.join(workspace, 'ota-install-'));
assert.ok(fixture.toLowerCase().startsWith(`${workspace.toLowerCase()}${path.sep}`));
const appId = `local.xuzuo.studio.ota.qa.${crypto.randomUUID()}`;
const metadata = setupMetadata({ appId, productName: 'Xuzuo OTA isolated fixture', executableProductName: 'Xuzuo OTA isolated fixture', executable: 'ota-fixture.exe', defaultDirectoryName: 'ota-fixture', shortcutName: `Xuzuo OTA QA ${crypto.randomUUID()}`, validation: true, validationRoot: fixture, shortcutRoot: path.join(fixture, 'shortcuts') });
await fs.writeFile(path.join(fixture, '.xuzuo-setup-validation.json'), `${JSON.stringify({ format: 1, kind: 'xuzuo-setup-validation', appId, installGuid: metadata.installGuid, root: fixture })}\n`);
const framework = path.join(process.env.SystemRoot || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319');
const compiler = path.join(framework, 'csc.exe');
const references = ['System.dll', 'System.Core.dll', 'System.Xml.dll', 'System.Xaml.dll', 'System.Web.Extensions.dll', 'System.IO.Compression.dll', 'System.IO.Compression.FileSystem.dll', 'Microsoft.CSharp.dll'].map(name => path.join(framework, name)).concat(['WindowsBase.dll', 'PresentationCore.dll', 'PresentationFramework.dll'].map(name => path.join(framework, 'WPF', name)));
const native = ['setup-contracts.cs', 'setup-engine.cs', 'setup-program.cs', 'setup-ui.cs', 'setup-update.cs', 'setup-update-fixture.cs'].map(name => path.join(root, 'scripts/native', name));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const installedRoot = path.join(fixture, 'installed', 'app');
const resultFile = path.join(fixture, 'updates', 'result.json');
const heldApplications = [];
const updateProcesses = [];
const checks = {};
let controller;

function compile(output, main, sources, resources = [], defines = []) {
  const args = ['/nologo', '/noconfig', '/utf8output', '/target:exe', `/out:${output}`, `/main:${main}`, ...defines.map(value => `/define:${value}`), ...references.map(value => `/reference:${value}`), ...resources.map(([file, name]) => `/resource:${file},${name}`), ...sources];
  execFileSync(compiler, args, { windowsHide: true, encoding: 'utf8', timeout: 30000 });
}

function completed(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => resolve(code));
  });
}

async function waitForJson(file) {
  for (let index = 0; index < 100; index++) {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    await delay(50);
  }
  throw new Error(`Fixture did not become ready: ${file}`);
}

async function holdApplication(name) {
  const started = path.join(fixture, `${name}.started.json`), release = path.join(fixture, `${name}.release`);
  const child = spawn(path.join(installedRoot, metadata.executable), [started, release], { windowsHide: true, stdio: 'ignore' });
  const application = { child, release, completion: completed(child) };
  heldApplications.push(application);
  Object.assign(application, await waitForJson(started));
  return application;
}

async function releaseApplication(application) {
  await fs.writeFile(application.release, 'exit\n');
  assert.equal(await application.completion, 0);
}

function updateArgs(application, overrides = {}) {
  return ['--update', '--root', overrides.root || installedRoot, '--wait-pid', String(application.pid), '--wait-start', String(overrides.startedAt ?? application.startedAt), '--result', overrides.result || resultFile];
}

async function runUpdate(installer, application, overrides) {
  await fs.rm(resultFile, { force: true });
  const child = spawn(installer, updateArgs(application, overrides), { windowsHide: true, stdio: 'ignore' });
  const update = { child, completion: completed(child) };
  updateProcesses.push(update);
  return update;
}

async function expectRejected(installer, application, key, overrides = {}) {
  const update = await runUpdate(installer, application, overrides);
  assert.equal(await update.completion, 1, `${key} was not rejected`);
  if (!overrides.result) {
    const result = await waitForJson(resultFile);
    assert.equal(result.success, false);
    assert.ok(result.version && result.at && result.detail);
  }
  assert.equal(await fs.readFile(path.join(installedRoot, 'version.txt'), 'utf8'), '1.0.0');
  checks[key] = true;
}

async function buildRelease(name, version, badHash = false) {
  const directory = path.join(fixture, name); await fs.mkdir(directory);
  const releaseMetadata = { ...metadata, version };
  const metadataFile = path.join(directory, 'metadata.json');
  await fs.writeFile(metadataFile, `${JSON.stringify(releaseMetadata)}\n`);
  const maintenance = await compileSetup(path.join(directory, 'xuzuo-maintenance.exe'), releaseMetadata);
  const files = [{ path: metadata.executable, data: await fs.readFile(path.join(fixture, 'application.exe')) }, { path: 'resources/xuzuo-maintenance.exe', data: await fs.readFile(maintenance) }, { path: 'version.txt', data: Buffer.from(version) }];
  const manifest = { format: 1, appId, version, executable: metadata.executable, files: files.map(file => ({ path: file.path, bytes: file.data.length, sha256: hash(file.data) })) };
  if (badHash) manifest.files.find(file => file.path === 'version.txt').sha256 = '0'.repeat(64);
  const manifestFile = path.join(directory, 'manifest.json');
  await fs.writeFile(manifestFile, `${JSON.stringify(manifest)}\n`);
  const zip = new JSZip(); for (const file of files) zip.file(file.path, file.data);
  const payload = path.join(directory, 'payload.zip'); await fs.writeFile(payload, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  const resources = [[metadataFile, 'Setup.Metadata.json'], [manifestFile, 'Setup.Manifest.json'], [payload, 'Setup.Payload.zip']];
  const installer = await compileSetup(path.join(directory, 'setup.exe'), releaseMetadata, { 'Setup.Manifest.json': manifestFile, 'Setup.Payload.zip': payload });
  return { directory, metadataFile, resources, installer, maintenance };
}

const report = { fixtureOnly: true, fixture, appId, installGuid: metadata.installGuid, normalRegistryUsed: false, checks };
try {
  compile(path.join(fixture, 'application.exe'), 'OtaFixtureApplication', [native.at(-1)], [], ['FIXTURE_APP']);
  const old = await buildRelease('old', '0.9.0');
  const next = await buildRelease('next', '1.0.0');
  const damaged = await buildRelease('damaged', '1.1.0', true);
  controller = path.join(fixture, 'controller.exe');
  compile(controller, 'Xuzuo.Setup.SetupUpdateFixture', native, old.resources);
  execFileSync(controller, ['install', installedRoot], { windowsHide: true, encoding: 'utf8', timeout: 30000 });
  const sentinel = path.join(fixture, 'user-data', 'sentinel.txt');
  await fs.mkdir(path.dirname(sentinel)); await fs.writeFile(sentinel, 'KEEP USER DATA');
  const application = await holdApplication('upgrade');
  const update = await runUpdate(next.installer, application);
  await delay(600);
  assert.equal(update.child.exitCode, null);
  assert.equal(application.child.exitCode, null);
  assert.equal(await fs.readFile(path.join(installedRoot, 'version.txt'), 'utf8'), '0.9.0');
  checks.waitsForOldProcess = true;
  await releaseApplication(application);
  assert.equal(await update.completion, 0);
  const result = await waitForJson(resultFile);
  assert.equal(result.success, true); assert.equal(result.version, '1.0.0');
  assert.equal(await fs.readFile(path.join(installedRoot, 'version.txt'), 'utf8'), '1.0.0');
  const receipt = JSON.parse(await fs.readFile(path.join(installedRoot, 'resources/xuzuo-install-manifest.json'), 'utf8'));
  assert.equal(receipt.version, '1.0.0');
  checks.upgradesRegisteredInstallation = true;
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'KEEP USER DATA'); checks.preservesUserData = true;
  await expectRejected(old.installer, application, 'rejectsDowngrade');
  await expectRejected(damaged.installer, application, 'rollsBackBadPayload');
  await expectRejected(next.installer, application, 'rejectsUnregisteredRoot', { root: path.join(fixture, 'unregistered') });
  await expectRejected(next.maintenance, application, 'rejectsMissingPayload');
  const outside = path.join(fixture, 'outside-result.json');
  await expectRejected(next.installer, application, 'rejectsResultOutsideStateDirectory', { result: outside });
  await assert.rejects(fs.stat(outside), { code: 'ENOENT' });
  await expectRejected(next.installer, { pid: process.pid, startedAt: Date.now() }, 'rejectsUnrelatedProcess');
  await fs.rm(resultFile, { force: true });
  await fs.rmdir(path.dirname(resultFile));
  const linkedState = path.join(fixture, 'linked-state'); await fs.mkdir(linkedState);
  await fs.symlink(linkedState, path.dirname(resultFile), 'junction');
  await expectRejected(next.installer, application, 'rejectsLinkedStateDirectory', { result: resultFile });
  await assert.rejects(fs.stat(path.join(linkedState, 'result.json')), { code: 'ENOENT' });
  await fs.unlink(path.dirname(resultFile));
  const identity = await holdApplication('identity');
  await expectRejected(next.installer, identity, 'rejectsReusedProcessIdentity', { startedAt: identity.startedAt + 10000 });
  await releaseApplication(identity);
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'KEEP USER DATA');
  report.passed = true;
} catch (error) {
  report.error = error.stack; process.exitCode = 1;
} finally {
  for (const application of heldApplications) {
    await fs.writeFile(application.release, 'exit\n').catch(() => undefined);
    await application.completion.catch(() => undefined);
  }
  for (const update of updateProcesses) await update.completion.catch(() => undefined);
  if (controller) {
    const cleanup = spawnSync(controller, ['uninstall', installedRoot], { windowsHide: true, encoding: 'utf8', timeout: 30000 });
    report.isolatedInstallationRemoved = cleanup.status === 0;
    if (cleanup.status !== 0) { report.cleanupError = cleanup.stderr || cleanup.error?.message || `exit ${cleanup.status}`; report.passed = false; process.exitCode = 1; }
  }
  await fs.mkdir(path.join(root, 'outputs'), { recursive: true });
  await fs.writeFile(path.join(root, 'outputs/verification-ota-install.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
