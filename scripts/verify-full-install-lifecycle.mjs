import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const oldVersion = '2.1.5', oldSha = '86018caf95d1e5fbcb0818334d40141d959e1b20c4bf0b1f3fa05eef7f18350b', oldBytes = 180565504;
const children = [], report = { passed: false, checks: [], engineInstallVerified: false, updateCliVerified: false, fullRuntimeFilesVerified: false, postSwitchRollbackVerified: false,
  scope: 'Full real runtime payloads with current production installer engine/CLI in a disposable QA namespace; not literal production-installer invocation, GUI interaction, power-loss recovery or five-area completion',
  interruptedProcessRecoveryVerified: false, preparingProcessInterruptionVerified: false, preparingRetryVerified: false, coveragePhase: 'install-preparing', powerLossRecoveryVerified: false, afterSwapForcedTerminationVerified: false,
  literalProductionInstallerExecuted: false, nativeGuiPointerTested: false, normalUserProfileAccessed: false, productionRegistryTouched: false, originalDeliveryInputsUnchanged: false, providerCallsRequested: 0 };
let fixture, phase = 'guards', current, original, reportFile, ownerProcess, oldApp, bootstrap, installed, totalDeadline;
function inside(parent, value) { const relative = path.relative(parent, path.resolve(value)); assert(relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative), 'Path escaped its owned root'); return value; }
async function ordinary(filename, directory = false) {
  const stat = await fsp.lstat(filename); assert(!stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile()), 'Expected an ordinary path');
  assert.equal((await fsp.realpath(filename)).toLowerCase(), path.resolve(filename).toLowerCase(), 'Path was redirected'); return stat;
}
async function json(filename) { assert((await ordinary(filename)).size <= 1024 * 1024); return JSON.parse(await fsp.readFile(filename, 'utf8')); }
async function identity(filename) {
  const before = await ordinary(filename), hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of fs.createReadStream(filename)) { bytes += chunk.length; hash.update(chunk); }
  const after = await ordinary(filename); for (const key of ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs']) assert.equal(after[key], before[key]);
  assert.equal(bytes, before.size); return { bytes, sha256: hash.digest('hex') };
}
async function walk(directory) {
  await ordinary(directory, true); const files = new Map();
  async function visit(current, prefix = '') {
    for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
      const filename = path.join(current, entry.name), stat = await fsp.lstat(filename); assert(!stat.isSymbolicLink(), 'Owned tree contains a link');
      if (stat.isDirectory()) await visit(filename, prefix + entry.name + '/');
      else { assert(stat.isFile()); files.set(prefix + entry.name, filename); }
    }
  }
  await visit(directory); return files;
}
function launch(executable, args, timeout = 180000, env = process.env, kind = 'fixture') {
  const child = spawn(executable, args, { cwd: fixture, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const state = { kind, executable, pid: child.pid, timedOut: false, code: null, signal: null, stdout: '', stderr: '' }; const started = Date.now();
  for (const name of ['stdout', 'stderr']) child[name].on('data', value => { state[name] += value.toString('utf8').slice(0, Math.max(0, 65536 - state[name].length)); });
  const timer = setTimeout(() => { state.timedOut = true; child.kill(); }, timeout); timer.unref();
  const done = new Promise((resolve, reject) => {
    child.once('error', error => { state.error = error.code || error.name; reject(error); }); child.once('exit', (code, signal) => { Object.assign(state, { code, signal, elapsedMs: Date.now() - started }); resolve(state); });
  }).finally(() => clearTimeout(timer)); done.catch(() => undefined);
  const handle = { child, done, state }; children.push(handle); return handle;
}
async function command(executable, args, success = true, timeout) {
  const result = await launch(executable, args, timeout).done;
  assert(!result.timedOut, 'Owned fixture command exceeded its deadline'); assert.equal(result.code, success ? 0 : 1, `Fixture command failed: ${args[0]}\n${result.stderr.slice(0, 4000)}`);
  if (!success) return result;
  const output = JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim()); assert.equal(output.passed, true); return output;
}
async function waitFor(read, accept, milliseconds = 30000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) { const value = await read(); if (accept(value)) return value; await delay(100); }
  throw Error('Owned lifecycle phase exceeded its deadline');
}
async function downloadOld(destination) {
  let url = new URL(`https://github.com/xiandan001/xuzuo-studio/releases/download/v${oldVersion}/Xuzuo-Studio-Setup-${oldVersion}.exe`), response;
  const signal = AbortSignal.timeout(600000);
  for (let hop = 0; ; hop++) {
    response = await fetch(url, { redirect: 'manual', signal, headers: { 'User-Agent': 'xuzuo-full-install-ci' } });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    assert(hop < 4); url = new URL(response.headers.get('location'), url);
    assert.equal(url.protocol, 'https:'); assert(['release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com'].includes(url.hostname)); assert(!url.username && !url.password && !url.port); await response.body?.cancel();
  }
  assert.equal(response.status, 200); let bytes = 0; const hash = createHash('sha256');
  const verify = new Transform({ transform(chunk, _encoding, callback) { bytes += chunk.length; if (bytes > oldBytes) { callback(Error('Old installer exceeded pinned length')); return; } hash.update(chunk); callback(null, chunk); } });
  await pipeline(Readable.fromWeb(response.body), verify, fs.createWriteStream(destination, { flags: 'wx' }));
  assert.equal(bytes, oldBytes); assert.equal(hash.digest('hex'), oldSha);
}
async function verifyRuntime(runtime, manifest, extra = []) {
  const actual = await walk(runtime); assert.equal(manifest.files.length, 74);
  assert.deepEqual([...actual.keys()].sort(), [...manifest.files.map(file => file.path), ...extra].sort());
  for (const file of manifest.files) assert.deepEqual(await identity(inside(runtime, path.join(runtime, ...file.path.split('/')))), { bytes: file.bytes, sha256: file.sha256 }, file.path);
}
async function main() {
  assert.equal(process.platform, 'win32'); assert.equal(process.env.CI, 'true'); assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.match(process.env.GITHUB_SHA || '', /^[a-f0-9]{40}$/i);
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted', 'Only a disposable GitHub-hosted runner may install this fixture');
  assert.equal((await fsp.realpath(process.env.GITHUB_WORKSPACE)).toLowerCase(), (await fsp.realpath(root)).toLowerCase());
  assert(process.env.RUNNER_TEMP && path.isAbsolute(process.env.RUNNER_TEMP)); assert(process.argv.length <= 3);
  const sourcePackage = await json(path.join(root, 'package.json')); assert.equal(sourcePackage.version, '2.3.0');
  const release = path.resolve(process.argv[2] || path.join(root, sourcePackage.build.directories.output)); inside(path.join(root, 'outputs'), release); await ordinary(release, true);
  reportFile = path.join(release, 'full-install-lifecycle.json'); await assert.rejects(fsp.lstat(reportFile), { code: 'ENOENT' });
  current = await json(path.join(release, 'package-verification.json')); assert.equal(current.passed, true); assert.equal(current.commit, process.env.GITHUB_SHA); assert.equal(current.version, sourcePackage.version);
  assert.deepEqual(current.deliveryFiles.map(file => file.name).sort(), [`Xuzuo-Studio-Setup-${current.version}.exe`, `Xuzuo-Studio-Setup-${current.version}.exe.blockmap`, `Xuzuo-Studio-Setup-${current.version}.manifest.json`, 'latest.yml'].sort()); original = new Map();
  for (const item of current.deliveryFiles) { assert.equal(path.basename(item.name), item.name); const file = path.join(release, item.name), observed = await identity(file); assert.deepEqual(observed, { bytes: item.bytes, sha256: item.sha256 }); original.set(file, observed); }
  const temporary = await fsp.realpath(process.env.RUNNER_TEMP); await ordinary(temporary, true);
  fixture = await fsp.mkdtemp(path.join(temporary, 'xuzuo-full-install-')); assert.equal(path.dirname(fixture).toLowerCase(), temporary.toLowerCase()); await ordinary(fixture, true);
  totalDeadline = setTimeout(() => {
    report.passed = false; report.error = { phase, name: 'LifecycleDeadline', message: 'Owned CI lifecycle exceeded twelve minutes; partial evidence retained' };
    for (const item of children) if (item.child.exitCode === null && item.child.signalCode === null) item.child.kill();
    try { fs.writeFileSync(path.join(fixture, 'deadline-failure.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); } catch { /* The external CI deadline also fails the job. */ }
    try { fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); } catch { /* Never overwrite any earlier lifecycle result. */ }
    console.error(JSON.stringify({ passed: false, phase, deadlineExpired: true, fixture }));
    process.exit(1);
  }, 720000); totalDeadline.unref();
  Object.assign(report, { commit: process.env.GITHUB_SHA, version: current.version, fixture, oldInstaller: { version: oldVersion, bytes: oldBytes, sha256: oldSha }, baselineEngine: 'Current production SetupEngine with verified complete 2.1.5 runtime; not literal old installer entry point' });
  await fsp.writeFile(path.join(fixture, 'owner.json'), JSON.stringify({ kind: 'xuzuo-full-install-ci', directory: fixture, commit: process.env.GITHUB_SHA, nonce: randomUUID() }) + '\n', { flag: 'wx' });
  const { setupMetadata, compileSetup, archivePayload } = await import('./build-setup.mjs');
  const guid = randomUUID(), metadata = setupMetadata({ appId: 'local.xuzuo.studio.full.qa.' + guid, productName: 'Xuzuo full runtime QA', executableProductName: sourcePackage.build.productName, validation: true, validationRoot: fixture, shortcutRoot: path.join(fixture, 'shortcuts'), shortcutName: 'Xuzuo full runtime QA ' + guid, defaultDirectoryName: 'application' });
  await fsp.writeFile(path.join(fixture, '.xuzuo-setup-validation.json'), JSON.stringify({ format: 1, kind: 'xuzuo-setup-validation', appId: metadata.appId, installGuid: metadata.installGuid, root: fixture }) + '\n', { flag: 'wx' });
  report.namespace = { appId: metadata.appId, installGuid: metadata.installGuid, shortcutRoot: metadata.shortcutRoot, uninstallRegistryKey: metadata.uninstallRegistryKey };
  const framework = path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319'), compiler = path.join(framework, 'csc.exe');
  const references = ['System.dll', 'System.Core.dll', 'System.Xml.dll', 'System.Xaml.dll', 'System.Web.Extensions.dll', 'System.IO.Compression.dll', 'System.IO.Compression.FileSystem.dll', 'Microsoft.CSharp.dll', 'WPF/WindowsBase.dll', 'WPF/PresentationCore.dll', 'WPF/PresentationFramework.dll'].map(name => path.join(framework, name));
  const sources = ['setup-contracts.cs', 'setup-engine.cs', 'setup-program.cs', 'setup-ui.cs', 'setup-update.cs', 'setup-update-fixture.cs'].map(name => path.join(root, 'scripts/native', name));
  report.installerSource = []; for (const file of sources) report.installerSource.push({ name: path.basename(file), ...await identity(file) });
  async function controller(destination, meta, manifest, payload) {
    const metaFile = path.join(path.dirname(destination), path.basename(destination) + '.metadata.json'); await fsp.writeFile(metaFile, JSON.stringify(meta) + '\n', { flag: 'wx' });
    const resources = [[metaFile, 'Setup.Metadata.json'], ...(manifest ? [[manifest, 'Setup.Manifest.json'], [payload, 'Setup.Payload.zip']] : [])];
    const built = await launch(compiler, ['/nologo', '/noconfig', '/utf8output', '/debug:full', '/target:exe', '/main:Xuzuo.Setup.SetupUpdateFixture', '/out:' + destination, ...references.map(file => '/reference:' + file), ...resources.map(([file, name]) => '/resource:' + file + ',' + name), ...sources], 120000, process.env, 'compiler').done;
    assert.equal(built.code, 0, 'Validation controller compilation failed'); assert(!built.timedOut); return destination;
  }
  bootstrap = await controller(path.join(fixture, 'bootstrap.exe'), metadata);
  phase = 'pinned-old-download'; const oldInstaller = path.join(fixture, 'old-production.exe'); await downloadOld(oldInstaller);
  const extracted = [];
  for (const [name, installer, version, sha] of [['old', oldInstaller, oldVersion, oldSha], ['current', path.join(release, `Xuzuo-Studio-Setup-${current.version}.exe`), current.version, current.deliveryFiles.find(file => file.name.endsWith('.exe')).sha256]]) {
    phase = 'extract-' + name; const destination = path.join(fixture, name); await fsp.mkdir(destination);
    const output = await command(bootstrap, ['extract-source', installer, destination, sha, version, sourcePackage.build.appId]);
    const manifest = await json(output.manifestFile), sourceMetadata = await json(output.metadataFile); assert.equal(manifest.version, version); assert.equal(sourceMetadata.validation, false);
    await verifyRuntime(output.runtime, manifest); extracted.push({ name, ...output, manifest, sourceMetadata });
  }
  assert.equal(Buffer.compare(await fsp.readFile(extracted[1].manifestFile), await fsp.readFile(path.join(release, `Xuzuo-Studio-Setup-${current.version}.manifest.json`))), 0, 'Current embedded sidecar differs');
  phase = 'probe-shortcut-paths'; report.shortcutProbe = await command(bootstrap, ['shortcut-probe', path.join(extracted[0].runtime, extracted[0].manifest.executable)]);
  assert.equal(report.shortcutProbe.allCasesSucceeded, true, 'Shortcut paths or ownership guards failed; full installation was not started');
  phase = 'build-full-validation-payloads'; const packages = [];
  for (const source of extracted) {
    const meta = { ...metadata, version: source.manifest.version }, maintenance = path.join(fixture, source.name, 'qa-maintenance.exe'); await compileSetup(maintenance, meta);
    const replacement = await identity(maintenance), manifest = { ...source.manifest, appId: meta.appId, files: source.manifest.files.map(file => file.path === 'resources/xuzuo-maintenance.exe' ? { path: file.path, ...replacement } : file) };
    const unchanged = manifest.files.filter(file => source.manifest.files.some(old => old.path === file.path && old.bytes === file.bytes && old.sha256 === file.sha256)); assert.equal(unchanged.length, 73);
    const manifestFile = path.join(fixture, source.name, 'qa-manifest.json'), payload = path.join(fixture, source.name, 'qa-payload.zip'); await fsp.writeFile(manifestFile, JSON.stringify(manifest) + '\n', { flag: 'wx' });
    await archivePayload(source.runtime, manifest.files, payload, { 'resources/xuzuo-maintenance.exe': maintenance });
    const setup = path.join(fixture, source.name, 'qa-setup.exe'); await compileSetup(setup, meta, { 'Setup.Manifest.json': manifestFile, 'Setup.Payload.zip': payload });
    const driver = await controller(path.join(fixture, source.name, 'controller.exe'), meta, manifestFile, payload);
    packages.push({ ...source, metadata: meta, manifest, manifestFile, payload, setup, driver });
  }
  const [old, next] = packages; report.payloadBinding = packages.map(item => ({ version: item.metadata.version, sourceFiles: 74, unchangedFiles: 73, variation: { path: 'resources/xuzuo-maintenance.exe', source: item.manifest.version === oldVersion ? extracted[0].manifest.files.find(file => file.path === 'resources/xuzuo-maintenance.exe') : extracted[1].manifest.files.find(file => file.path === 'resources/xuzuo-maintenance.exe'), qa: item.manifest.files.find(file => file.path === 'resources/xuzuo-maintenance.exe') } }));
  installed = path.join(fixture, 'installed', 'application'); inside(fixture, installed);
  const userDirectory = path.join(fixture, 'creative-data'); await fsp.mkdir(userDirectory); const userFile = path.join(userDirectory, 'user-sentinel.json'); await fsp.writeFile(userFile, '{"ownedFixture":true,"preserve":"project-draft-and-fee-sentinel"}\n', { flag: 'wx' }); const userHash = await identity(userFile);
  const syntheticFeeFile = path.join(userDirectory, 'synthetic-fee-sentinel.json');
  await fsp.writeFile(syntheticFeeFile, JSON.stringify({ kind: 'synthetic-install-fee-sentinel', realLedger: false, entries: [{ id: 'synthetic-1', costCents: 35 }, { id: 'synthetic-2', costCents: 65 }], totalCostCents: 100 }) + '\n', { flag: 'wx' });
  const syntheticFeeHash = await identity(syntheticFeeFile);
  phase = 'install-real-old-runtime'; await command(old.driver, ['install-full', installed]); await verifyRuntime(installed, old.manifest, ['resources/xuzuo-install-manifest.json', '.xuzuo-setup-owner.json']);
  const oldStatus = await command(old.driver, ['status', installed]); assert.equal(oldStatus.registration.Version, oldVersion); assert.equal(oldStatus.registration.Machine, false); assert(oldStatus.shortcuts.every(file => file.exists));
  report.engineInstallVerified = true;
  phase = 'reject-corrupt-extraction';
  const corrupt = structuredClone(next.manifest), corruptFile = corrupt.files.find(file => file.bytes > 0 && /license/i.test(file.path)); assert(corruptFile); corruptFile.sha256 = '0'.repeat(64);
  const corruptManifest = path.join(fixture, 'corrupt-manifest.json'); await fsp.writeFile(corruptManifest, JSON.stringify(corrupt) + '\n', { flag: 'wx' });
  const corruptDriver = await controller(path.join(fixture, 'corrupt-controller.exe'), next.metadata, corruptManifest, next.payload);
  const corruptResult = await command(corruptDriver, ['install-full', installed], false); assert(corruptResult.stderr.includes('安装文件校验失败'), 'Corrupt fixture failed for an unrelated reason'); assert.deepEqual(await command(old.driver, ['status', installed]), oldStatus);
  await verifyRuntime(installed, old.manifest, ['resources/xuzuo-install-manifest.json', '.xuzuo-setup-owner.json']); report.corruptExtractionRejectedBeforeSwitch = true;
  phase = 'post-old-root-swap-rollback'; const fault = await command(next.driver, ['post-switch-failure', installed]);
  assert.equal(fault.oldRootSwapObserved, true); inside(fixture, fault.retainedStage); await ordinary(fault.retainedStage, true);
  await verifyRuntime(installed, old.manifest, ['resources/xuzuo-install-manifest.json', '.xuzuo-setup-owner.json']); assert.deepEqual(await command(old.driver, ['status', installed]), oldStatus); assert.deepEqual(await identity(userFile), userHash);
  report.postSwitchRollbackVerified = true; report.rollbackEvidence = fault;
  phase = 'install-preparing-process-interruption';
  const baselineFiles = []; for (const [name, filename] of await walk(installed)) baselineFiles.push({ path: name, ...await identity(filename) });
  async function verifyInterruptedBaseline(pendingJournal) {
    const files = await walk(installed); assert.deepEqual([...files.keys()].sort(), baselineFiles.map(file => file.path).sort());
    for (const file of baselineFiles) assert.deepEqual(await identity(files.get(file.path)), { bytes: file.bytes, sha256: file.sha256 }, file.path);
    assert.deepEqual(await command(old.driver, ['status', installed]), { ...oldStatus, pendingJournal });
    assert.deepEqual(await identity(userFile), userHash); assert.deepEqual(await identity(syntheticFeeFile), syntheticFeeHash);
  }
  const readyFile = inside(fixture, path.join(fixture, `install-preparing-ready-${randomUUID().replaceAll('-', '')}.json`)); await assert.rejects(fsp.lstat(readyFile), { code: 'ENOENT' });
  const held = launch(next.driver, ['hold-preparing', installed, readyFile], 180000, process.env, 'install-preparing-held');
  const ready = await waitFor(async () => {
    assert.equal(held.child.exitCode, null, 'Preparing controller exited before its barrier'); assert.equal(held.child.signalCode, null);
    try { return await json(readyFile); } catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
  }, value => value?.passed === true);
  assert.equal(ready.kind, 'xuzuo-install-preparing-barrier'); assert.equal(ready.coveragePhase, 'install-preparing'); assert.equal(ready.phase, 'preparing'); assert.equal(ready.holdMilliseconds, 90000);
  assert.equal(ready.pid, held.child.pid); assert.equal(path.resolve(ready.root), installed); assert.equal(path.resolve(ready.executable).toLowerCase(), path.resolve(next.driver).toLowerCase()); assert.equal(ready.oldVersion, oldVersion); assert.match(ready.nonce, /^[a-f0-9]{32}$/);
  const journalFile = inside(fixture, path.join(fixture, 'setup-state', metadata.installGuid, 'transaction.json'));
  assert.equal(path.resolve(ready.journalPath), journalFile); assert.equal(path.resolve(ready.stage), path.join(path.dirname(installed), '.xuzuo-stage-' + ready.nonce)); assert.equal(path.resolve(ready.backup), path.join(path.dirname(installed), '.xuzuo-backup-' + ready.nonce));
  await ordinary(ready.stage, true); await assert.rejects(fsp.lstat(ready.backup), { code: 'ENOENT' });
  const journalBeforeTermination = await identity(journalFile); assert.equal(journalBeforeTermination.sha256, ready.journalSha256);
  const heldIdentity = await command(bootstrap, ['process-info', String(held.child.pid), next.driver]);
  assert.equal(heldIdentity.pid, ready.pid); assert.equal(path.resolve(heldIdentity.executable).toLowerCase(), path.resolve(next.driver).toLowerCase()); assert(Math.abs(heldIdentity.startedAt - ready.startedAt) <= 2);
  const readyAge = Date.now() - Date.parse(ready.readyAt); assert(readyAge >= 0 && readyAge < 60000, 'Preparing barrier is stale');
  assert.equal(held.child.exitCode, null); assert.equal(held.child.signalCode, null); assert.equal(held.state.timedOut, false);
  const termination = await command(bootstrap, ['stop-owned-process', String(held.child.pid), next.driver, String(heldIdentity.startedAt)]); assert.equal(termination.terminationRequested, true, 'Preparing controller had already exited; explicit termination was not proved'); held.state.expectedTerminationRequested = true;
  const heldExit = await held.done; assert.equal(heldExit.timedOut, false); assert.notEqual(heldExit.code, 0); assert(held.child.exitCode !== null || held.child.signalCode !== null);
  assert.deepEqual(await identity(journalFile), journalBeforeTermination, 'Terminated process did not retain the exact pending journal');
  const pendingJournal = await json(journalFile); assert.equal(pendingJournal.phase, 'preparing'); assert.equal(pendingJournal.operation, 'install'); assert.equal(pendingJournal.nonce, ready.nonce);
  await verifyRuntime(ready.stage, next.manifest, ['resources/xuzuo-install-manifest.json', '.xuzuo-setup-owner.json']);
  assert.equal((await identity(path.join(ready.stage, '.xuzuo-setup-owner.json'))).sha256, ready.stageOwnerSha256); assert.deepEqual(await json(path.join(ready.stage, 'resources/xuzuo-install-manifest.json')), next.manifest);
  await verifyInterruptedBaseline(true);
  const recovered = await command(next.driver, ['recover-pending', installed]); assert.equal(recovered.coveragePhase, 'install-preparing'); assert.notEqual(recovered.pid, ready.pid); assert.equal(path.resolve(recovered.root), installed); assert.equal(recovered.version, oldVersion); assert.equal(recovered.pendingJournal, false);
  for (const filename of [journalFile, ready.stage, ready.backup]) await assert.rejects(fsp.lstat(filename), { code: 'ENOENT' });
  await verifyInterruptedBaseline(false);
  report.preparingProcessInterruptionVerified = true; report.preparingInterruption = { coveragePhase: 'install-preparing', ready, process: heldIdentity, termination, recovery: recovered, journalBeforeTermination, oldRootFiles: baselineFiles.length, syntheticFeeSentinel: { realLedger: false, ...syntheticFeeHash, unchanged: true }, powerLossRecoveryVerified: false, afterSwapForcedTerminationVerified: false };
  const oldText = old.manifest.files.find(file => /license/i.test(file.path) && !file.path.includes('/')); assert(oldText);
  const oldModified = inside(installed, path.join(installed, oldText.path)); await ordinary(oldModified); await fsp.appendFile(oldModified, '\nOWNED PRE-UPGRADE MODIFICATION\n'); const oldModifiedHash = await identity(oldModified);
  phase = 'real-old-hidden-process'; const profile = path.join(fixture, 'old-profile'); await fsp.mkdir(profile);
  ownerProcess = launch(process.execPath, ['-e', 'process.stdin.resume();process.stdin.on("end",()=>process.exit(0));'], 120000, process.env, 'old-app-owner');
  await fsp.writeFile(path.join(profile, '.xuzuo-validation-profile.json'), JSON.stringify({ version: 1, kind: 'xuzuo-owned-validation', directory: profile, ownerPid: ownerProcess.child.pid }) + '\n', { flag: 'wx' });
  const environment = { ...process.env }; for (const name of Object.keys(environment)) if (name.startsWith('XUZUO_') || /(?:TOKEN|PASSWORD|SECRET|API_KEY)$/i.test(name)) delete environment[name]; delete environment.ELECTRON_RUN_AS_NODE;
  Object.assign(environment, { XUZUO_QA_PROFILE: profile, XUZUO_QA_VISIBLE: '0', XUZUO_QA_EXIT_CONFIRMATION: 'exit', HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', NO_PROXY: '127.0.0.1,localhost' });
  const executable = path.join(installed, old.metadata.executable); oldApp = launch(executable, ['--isolated-validation', '--user-data-dir=' + profile], 90000, environment, 'actual-old-runtime');
  await waitFor(async () => {
    assert.equal(oldApp.child.exitCode, null, 'Actual old application exited before renderer startup');
    try { return await json(path.join(profile, 'automation-center-v1.json')); } catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
  }, value => value?.context?.workspaces?.length === 1 && value.context.projects.length === 0, 45000);
  const processIdentity = await command(bootstrap, ['process-info', String(oldApp.child.pid), executable]); assert.match(processIdentity.productVersion, /^2\.1\.5(?:\.|$)/);
  assert.equal((await fsp.readdir(profile)).filter(name => /^credentials(?:[-.]|$)/i.test(name)).length, 0);
  phase = 'production-update-cli'; const resultFile = path.join(fixture, 'updates/result.json');
  const update = launch(next.setup, ['--update', '--root', installed, '--wait-pid', String(processIdentity.pid), '--wait-start', String(processIdentity.startedAt), '--result', resultFile], 180000, process.env, 'update-cli');
  await delay(600); assert.equal(update.child.exitCode, null); assert.equal(oldApp.child.exitCode, null); assert.equal((await json(path.join(installed, 'resources/xuzuo-install-manifest.json'))).version, oldVersion);
  report.waitedForRealOldProcess = true; ownerProcess.child.stdin.end(); assert.equal((await ownerProcess.done).code, 0); assert.equal((await oldApp.done).code, 0);
  const updateExit = await update.done; assert.equal(updateExit.code, 0); assert(!updateExit.timedOut);
  const updateResult = await json(resultFile); assert.equal(updateResult.success, true); assert.equal(updateResult.version, current.version);
  await verifyRuntime(installed, next.manifest, ['resources/xuzuo-install-manifest.json', '.xuzuo-setup-owner.json']); const nextStatus = await command(next.driver, ['status', installed]); assert.equal(nextStatus.registration.Version, current.version); assert(nextStatus.shortcuts.every(file => file.exists));
  assert.deepEqual(await identity(userFile), userHash); assert.deepEqual(await identity(syntheticFeeFile), syntheticFeeHash); assert.equal((await fsp.readdir(profile)).filter(name => /^credentials(?:[-.]|$)/i.test(name)).length, 0);
  report.updateCliVerified = true; report.fullRuntimeFilesVerified = true; report.oldProcess = processIdentity; report.preparingRetryVerified = true;
  const retainedBackups = (await fsp.readdir(path.dirname(installed), { withFileTypes: true })).filter(entry => entry.isDirectory() && entry.name.startsWith('.xuzuo-backup-'));
  assert.equal(retainedBackups.length, 1, 'Expected only the retained modified baseline backup');
  const retainedModified = inside(fixture, path.join(path.dirname(installed), retainedBackups[0].name, oldText.path)); assert.deepEqual(await identity(retainedModified), oldModifiedHash);
  report.modifiedBaselineRetained = { path: retainedModified, ...oldModifiedHash };
  phase = 'reject-downgrade'; const downgrade = await command(old.driver, ['install-full', installed], false); assert(downgrade.stderr.includes('已安装较新版本'), 'Downgrade fixture failed for an unrelated reason'); assert.deepEqual(await command(next.driver, ['status', installed]), nextStatus); await verifyRuntime(installed, next.manifest, ['resources/xuzuo-install-manifest.json', '.xuzuo-setup-owner.json']); report.downgradeRejected = true;
  phase = 'reject-unknown-upgrade'; const unknown = path.join(installed, 'owned-customer-note.txt'); await fsp.writeFile(unknown, 'PRESERVE UNKNOWN USER CONTENT\n', { flag: 'wx' }); const unknownHash = await identity(unknown);
  const unknownResult = await command(next.driver, ['install-full', installed], false); assert(unknownResult.stderr.includes('包含额外文件'), 'Unknown-file fixture failed for an unrelated reason'); assert.deepEqual(await identity(unknown), unknownHash); assert.deepEqual(await command(next.driver, ['status', installed]), nextStatus); report.unknownUpgradeRejected = true;
  phase = 'uninstall-preserves-sentinels'; const text = next.manifest.files.find(file => /(?:license|licenses)/i.test(file.path) && !file.path.includes('/') && !/\.exe$/i.test(file.path)); assert(text, 'Expected an actual managed license text for a modified-file sentinel');
  const modified = inside(installed, path.join(installed, ...text.path.split('/'))); await ordinary(modified); await fsp.appendFile(modified, '\nOWNED USER MODIFICATION\n'); const modifiedHash = await identity(modified);
  await command(next.driver, ['uninstall', installed]); const removed = await command(next.driver, ['status', installed]); assert.equal(removed.registration, null); assert.equal(removed.installRegistry.exists, false); assert.equal(removed.uninstallRegistry.exists, false); assert(removed.shortcuts.every(file => !file.exists)); assert.equal(removed.pendingJournal, false);
  assert.deepEqual(await identity(userFile), userHash); assert.deepEqual(await identity(syntheticFeeFile), syntheticFeeHash); assert.deepEqual(await identity(unknown), unknownHash); assert.deepEqual(await identity(modified), modifiedHash);
  for (const file of next.manifest.files) if (file.path !== text.path) await assert.rejects(fsp.lstat(path.join(installed, ...file.path.split('/'))), { code: 'ENOENT' });
  assert.deepEqual([...(await walk(installed)).keys()].sort(), ['owned-customer-note.txt', text.path].sort());
  report.uninstallQaCleanupVerified = true; report.sentinelsPreserved = true; report.syntheticFeeSentinelPreserved = true; report.checks = ['full old install', 'corrupt extraction rejected before switch', 'post-old-root-swap rollback', 'install-preparing process termination and fresh-process recovery', 'real old process wait', 'full current update preserves modified baseline', 'downgrade rejected', 'unknown upgrade rejected', 'uninstall preserves unknown/modified/external files']; report.passed = true;
}
await main().catch(error => { report.error = { phase, name: error.name, code: error.code, message: String(error.message).slice(0, 1600) }; process.exitCode = 1; }).finally(async () => {
  if (ownerProcess && ownerProcess.child.exitCode === null) ownerProcess.child.stdin.end();
  for (const item of children) if (item.child.exitCode === null && item.child.signalCode === null) item.child.kill();
  await Promise.allSettled(children.map(item => item.done));
  if (bootstrap && installed) {
    try {
      const executable = inside(fixture, path.join(installed, JSON.parse(await fsp.readFile(path.join(root, 'package.json'), 'utf8')).build.productName + '.exe'));
      const remaining = await command(bootstrap, ['owned-processes', executable], true, 15000); assert.equal(remaining.uninspectable, 0);
      report.unexpectedResidualRuntimeProcesses = remaining.processes.length;
      if (report.passed && remaining.processes.length) { report.passed = false; process.exitCode = 1; report.processCleanupError = 'UnexpectedResidualRuntime'; }
      for (const process of remaining.processes) await command(bootstrap, ['stop-owned-process', String(process.pid), executable, String(process.startedAt)], true, 15000);
      const final = await command(bootstrap, ['owned-processes', executable], true, 15000); assert.equal(final.uninspectable, 0); assert.deepEqual(final.processes, []); report.ownedRuntimeProcessesExited = true;
    } catch (error) { report.ownedRuntimeProcessesExited = false; report.passed = false; process.exitCode = 1; report.processCleanupError = error.name; }
  }
  report.processes = children.map(item => item.state); report.acceptedChildProcessesExited = children.every(item => !item.child.pid || item.child.exitCode !== null || item.child.signalCode !== null);
  if (!report.acceptedChildProcessesExited) { report.passed = false; process.exitCode = 1; }
  report.acceptedChildDeadlineExpired = children.some(item => item.state.timedOut);
  if (report.acceptedChildDeadlineExpired) { report.passed = false; process.exitCode = 1; }
  if (original) {
    try { for (const [filename, before] of original) assert.deepEqual(await identity(filename), before); report.originalDeliveryInputsUnchanged = true; }
    catch (error) { report.originalDeliveryInputsUnchanged = false; report.passed = false; process.exitCode = 1; report.deliveryError = error.name; }
  }
  if (reportFile) await fsp.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  clearTimeout(totalDeadline);
  console.log(JSON.stringify({ passed: report.passed, phase, reportFile, engineInstallVerified: report.engineInstallVerified, updateCliVerified: report.updateCliVerified, postSwitchRollbackVerified: report.postSwitchRollbackVerified, nativeGuiPointerTested: false, error: report.error }));
});
