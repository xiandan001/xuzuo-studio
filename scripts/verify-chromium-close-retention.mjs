import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), require = createRequire(path.join(root, 'package.json'));
const sources = ['electron/application-exit.cjs', 'electron/close-coordinator.cjs', 'electron/validation-lifecycle.cjs', 'scripts/chromium-close-retention-main.cjs', 'scripts/verify-chromium-close-retention.mjs'];
const children = [], outcomes = []; let directory, timer, sourceHashes;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function ordinary(filename, folder = false) {
  const stat = await fsp.lstat(filename); assert(!stat.isSymbolicLink() && (folder ? stat.isDirectory() : stat.isFile()));
  assert.equal((await fsp.realpath(filename)).toLowerCase(), path.resolve(filename).toLowerCase()); return stat;
}
async function json(filename) { assert((await ordinary(filename)).size <= 65536); return JSON.parse(await fsp.readFile(filename, 'utf8')); }
const psLiteral = value => "'" + value.replaceAll("'", "''") + "'";
async function audit(executable, profile, pids, startedAt, stop = false) {
  assert(pids.every(pid => Number.isSafeInteger(pid) && pid > 0));
  const script = `$ErrorActionPreference='Stop'; $exe=${psLiteral(executable)}; $profile=${psLiteral(profile)}; $known=@(${pids.join(',')}); $min=[long]${startedAt - 1000};
    $found=@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -ieq $exe -and (([DateTimeOffset]$_.CreationDate).ToUniversalTime().ToUnixTimeMilliseconds() -ge $min) -and (($known -contains [int]$_.ProcessId) -or ($_.CommandLine -and $_.CommandLine.IndexOf($profile,[StringComparison]::OrdinalIgnoreCase) -ge 0)) });
    ${stop ? 'foreach($item in $found){try{$p=[Diagnostics.Process]::GetProcessById($item.ProcessId);if($p.MainModule.FileName -ieq $exe -and [Math]::Abs(([DateTimeOffset]$p.StartTime).ToUniversalTime().ToUnixTimeMilliseconds()-([DateTimeOffset]$item.CreationDate).ToUniversalTime().ToUnixTimeMilliseconds()) -le 2){$p.Kill();if(!$p.WaitForExit(5000)){throw "Owned child did not exit"}}}catch [ArgumentException]{}}' : ''}
    ConvertTo-Json -Compress -InputObject @($found | ForEach-Object { [pscustomobject]@{pid=[int]$_.ProcessId} })`;
  const child = spawn(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', expired = false; child.stdout.on('data', value => { stdout += value.toString().slice(0, Math.max(0, 65536 - stdout.length)); }); child.stderr.on('data', value => { stderr += value.toString().slice(0, Math.max(0, 1024 - stderr.length)); });
  const timeout = setTimeout(() => { expired = true; child.kill(); }, 10000); timeout.unref();
  try { const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }); assert(!expired && code === 0, 'Owned process audit failed: ' + stderr.slice(0, 512)); return JSON.parse(stdout.trim()); }
  finally { clearTimeout(timeout); }
}
async function phase(caseDirectory, mode, executable, owner) {
  const startedAt = Date.now(), profile = path.join(caseDirectory, 'profile');
  const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
  for (const key of Object.keys(environment)) if (key.startsWith('XUZUO_') || /(?:TOKEN|PASSWORD|SECRET|API_KEY)$/i.test(key)) delete environment[key];
  const child = spawn(executable, [path.join(root, 'scripts/chromium-close-retention-main.cjs'), caseDirectory, mode, '--user-data-dir=' + profile], { cwd: root, env: environment, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  const record = { case: path.basename(caseDirectory), mode, pid: child.pid, startedAt, timeout: false, stderr: '' }; children.push({ child, record });
  child.stderr.on('data', value => { record.stderr += value.toString().slice(0, Math.max(0, 2048 - record.stderr.length)); });
  const timeout = setTimeout(() => { record.timeout = true; child.kill(); }, 25000); timeout.unref();
  try { record.code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }); }
  finally { clearTimeout(timeout); record.closedAt = Date.now(); record.signal = child.signalCode; }
  let result, failure;
  try { result = await json(path.join(caseDirectory, mode + '-result.json')); } catch { /* Preserve child failure evidence when no readiness result exists. */ }
  try { failure = await json(path.join(caseDirectory, mode + '-failure.json')); } catch { /* Failure sidecar is optional. */ }
  record.result = result; record.failure = failure;
  const known = [...new Set([child.pid, ...(result?.metricPids || [])].filter(value => Number.isSafeInteger(value) && value > 0))];
  let remaining = [];
  try { for (let pass = 0; pass < 3; pass++) { remaining = await audit(executable, profile, known, startedAt); if (!remaining.length) break; await delay(100); } }
  catch (error) { error.fatalOwnedProcessAudit = true; throw error; }
  record.ownedProcessAudit = remaining;
  if (remaining.length) { await audit(executable, profile, known, startedAt, true); record.forcedOwnedCleanup = true; const error = Error('Owned Chromium processes remained after close'); error.fatalOwnedProcessAudit = true; throw error; }
  assert(!record.timeout && !remaining.length && record.code === 0 && !failure, 'Actual child close failed; no cold reopen accepted');
  assert.equal(result?.ok, true); assert.equal(result.mode, mode); assert.equal(result.nonce, owner.nonce); assert.equal(result.commit, owner.commit); assert.equal(result.profile.toLowerCase(), profile.toLowerCase());
  assert.equal(result.strategy, owner.strategy); assert.equal(result.iteration, owner.iteration); assert.equal(result.sameUrl, pathToFileURL(path.join(caseDirectory, 'index.html')).href);
  return result;
}
async function main() {
  assert.equal(process.platform, 'win32'); assert.equal(process.env.CI, 'true'); assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted'); assert.match(process.env.GITHUB_SHA || '', /^[a-f0-9]{40}$/i);
  assert.equal((await fsp.realpath(process.env.GITHUB_WORKSPACE)).toLowerCase(), (await fsp.realpath(root)).toLowerCase()); assert.equal(process.argv.length, 2);
  const temporary = await fsp.realpath(process.env.RUNNER_TEMP); await ordinary(temporary, true);
  directory = await fsp.mkdtemp(path.join(temporary, 'xuzuo-chromium-close-')); await ordinary(directory, true); assert.equal(path.dirname(directory).toLowerCase(), temporary.toLowerCase());
  const nonce = randomUUID(); await fsp.writeFile(path.join(directory, 'owner.json'), JSON.stringify({ kind: 'xuzuo-chromium-close-root', directory, commit: process.env.GITHUB_SHA, nonce }) + '\n', { flag: 'wx' });
  sourceHashes = {}; for (const relative of sources) { await ordinary(path.join(root, relative)); sourceHashes[relative] = sha(await fsp.readFile(path.join(root, relative))); }
  const executable = await fsp.realpath(require('electron')), electronVersion = require('electron/package.json').version; await ordinary(executable);
  timer = setTimeout(() => {
    for (const { child } of children) if (child.exitCode === null && child.signalCode === null) child.kill();
    fs.writeFileSync(path.join(directory, 'deadline-failure.json'), JSON.stringify({ passed: false, deadlineExpired: true, outcomes }) + '\n', { flag: 'wx' }); process.exit(1);
  }, 300000); timer.unref();
  for (const strategy of ['normal', 'validation', 'control']) for (let iteration = 1; iteration <= 3; iteration++) {
    const caseDirectory = path.join(directory, strategy + '-' + iteration), profile = path.join(caseDirectory, 'profile'); await fsp.mkdir(caseDirectory); await fsp.mkdir(profile);
    const caseNonce = randomUUID(), html = '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; connect-src \'none\'; base-uri \'none\'; form-action \'none\'"></head><body></body></html>';
    const preload = `const {ipcRenderer,contextBridge}=require('electron');ipcRenderer.on('window:close-state-request',(_event,token)=>{if(typeof token==='string')ipcRenderer.send('window:close-state',{token,blocked:false});});contextBridge.exposeInMainWorld('retentionFixture',{nonce:${JSON.stringify(caseNonce)}});\n`;
    await fsp.writeFile(path.join(caseDirectory, 'index.html'), html, { flag: 'wx' }); await fsp.writeFile(path.join(caseDirectory, 'preload.cjs'), preload, { flag: 'wx' });
    const owner = { kind: 'xuzuo-chromium-close-case', directory: caseDirectory, profile, commit: process.env.GITHUB_SHA, nonce: caseNonce, parentNonce: nonce, strategy, iteration, ownerPid: process.pid, electronVersion, sources: sourceHashes, inputs: { 'index.html': sha(html), 'preload.cjs': sha(preload) } };
    await fsp.writeFile(path.join(caseDirectory, 'owner.json'), JSON.stringify(owner) + '\n', { flag: 'wx' });
    await fsp.writeFile(path.join(profile, '.xuzuo-validation-profile.json'), JSON.stringify({ version: 1, kind: 'xuzuo-owned-validation', directory: profile, ownerPid: process.pid }) + '\n', { flag: 'wx' });
    const outcome = { strategy, iteration, protocolValid: false, retained: null, coldVerificationPerformed: false, mandatoryRetention: strategy !== 'validation' }; outcomes.push(outcome);
    try {
      outcome.prime = await phase(caseDirectory, 'prime', executable, owner); assert.equal(outcome.prime.observed.baselineMatched, true);
      outcome.edit = await phase(caseDirectory, 'edit', executable, owner); assert.equal(outcome.edit.observed.baselineMatched, true); assert.equal(outcome.edit.observed.readbackMatched, true);
      if (strategy === 'normal') try {
        const log = path.join(profile, 'diagnostics/exit-events.jsonl'); assert((await ordinary(log)).size <= 65536);
        const events = (await fsp.readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
        outcome.normalCloseEvents = events;
        const finalized = events.filter(value => value.type === 'finalized'); assert.equal(finalized.length, 1); assert.equal(finalized[0].forced, false);
        assert(!events.some(value => ['confirmation', 'confirmation-error', 'state-timeout', 'state-error', 'drain-error', 'update-handoff-error'].includes(value.type)), 'Normal close did not take the no-task non-forced path'); outcome.normalNonForced = true;
      } catch (error) { outcome.normalProtocolError = { name: error.name, message: String(error.message).slice(0, 512) }; }
      if (strategy === 'validation') { assert.equal(outcome.edit.validationOwnerLossInjected, true); assert.equal(outcome.edit.validationDefaultPollMs, 2000); }
      outcome.verify = await phase(caseDirectory, 'verify', executable, owner); outcome.retained = outcome.verify.observed.retained === true; outcome.coldVerificationPerformed = true; outcome.protocolValid = strategy !== 'normal' || outcome.normalNonForced === true;
      outcome.mandatoryPassed = !outcome.mandatoryRetention || outcome.retained;
    } catch (error) { outcome.error = { name: error.name, code: error.code, message: String(error.message).slice(0, 512) }; if (error.fatalOwnedProcessAudit) throw error; }
  }
  for (const relative of sources) assert.equal(sha(await fsp.readFile(path.join(root, relative))), sourceHashes[relative], 'Measured source changed');
  const passed = outcomes.length === 9 && outcomes.every(value => value.protocolValid && value.mandatoryPassed);
  const report = { passed, commit: process.env.GITHUB_SHA, electronVersion, sources: sourceHashes, cases: outcomes, children: children.map(value => value.record),
    normalRetained: outcomes.filter(value => value.strategy === 'normal' && value.retained).length, controlRetained: outcomes.filter(value => value.strategy === 'control' && value.retained).length, validationRetainedDiagnostic: outcomes.filter(value => value.strategy === 'validation' && value.retained).length,
    scope: 'Instrumented actual Chromium storage/close layers with synthetic Chinese input; not React input delivery, original native typing root cause, power-loss durability or whole-editor recovery',
    validationOwnerLossInjected: true, validationDefaultPollMs: 2000, flushVoidReturnTreatedAsAcknowledgement: false, formalApplicationStarted: false, normalUserProfileAccessed: false, providerCalls: 0, uiInputsInjected: false };
  await fsp.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log('CHROMIUM_CLOSE_RETENTION ' + JSON.stringify(report)); if (!passed) process.exitCode = 1;
}
await main().catch(async error => {
  if (directory) await fsp.writeFile(path.join(directory, 'failure.json'), JSON.stringify({ passed: false, name: error.name, code: error.code, outcomes }) + '\n', { flag: 'wx' }).catch(() => undefined);
  console.error(JSON.stringify({ passed: false, error: error.code || error.name })); process.exitCode = 1;
}).finally(() => { clearTimeout(timer); for (const { child } of children) if (child.exitCode === null && child.signalCode === null) child.kill(); });
