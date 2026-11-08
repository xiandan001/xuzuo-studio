import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

assert.equal(process.platform, 'win32'); assert.equal(process.env.CI, 'true'); assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.match(process.env.GITHUB_SHA || '', /^[a-f0-9]{40}$/); assert(process.env.RUNNER_TEMP && process.env.GITHUB_WORKSPACE);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), load = createRequire(import.meta.url), output = path.join(root, 'work/bead-market-browser-native-output');
assert.equal((await fs.realpath(root)).toLowerCase(), (await fs.realpath(process.env.GITHUB_WORKSPACE)).toLowerCase());
await assert.rejects(fs.lstat(output), error => error.code === 'ENOENT', 'Previous probe output must be retained; use a clean checkout');
const temporaryRoot = await fs.realpath(process.env.RUNNER_TEMP), temporary = await fs.mkdtemp(path.join(temporaryRoot, 'xuzuo-market-browser-owned-')), nonce = randomUUID(), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const source = path.join(root, 'scripts/verify-bead-market-browser-native.cjs'), sourceSha256 = hash(await fs.readFile(source));
const owner = { kind: 'xuzuo-market-browser-owned', root, output, nonce, temporary, temporaryRoot, sourceSha256, commit: process.env.GITHUB_SHA, parentPid: process.pid };
await fs.mkdir(path.join(temporary, 'profile')); await fs.writeFile(path.join(temporary, 'owner.json'), JSON.stringify(owner) + '\n', { flag: 'wx' });
const wrapper = { passed: false, commit: owner.commit, nonce, sourceSha256, scope: 'Real isolated Electron/Chromium IPC with synthetic marketplace HTML; not live marketplace prices or API authorization', normalApplicationStarted: false, userProfileAccessed: false, providerCalls: 0 };
let child, timer, stdout = '', stderr = '', expired = false;
const alive = pid => { if (!Number.isInteger(pid) || pid < 1) return false; try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; if (error.code === 'EPERM') return true; throw error; } };
function stop() { if (child && alive(child.pid)) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000, stdio: 'ignore' }); }
try {
  try { os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* CI may already restrict priority. */ }
  const { isolatedEnvironment } = load('./verify-bead-native.cjs'), environment = isolatedEnvironment(temporary, { directory: root });
  Object.assign(environment, { CI: 'true', GITHUB_ACTIONS: 'true', GITHUB_SHA: owner.commit, GITHUB_WORKSPACE: root, RUNNER_TEMP: temporaryRoot });
  assert(!Object.keys(environment).some(key => /TOKEN|PASSWORD|SECRET|API_KEY|CREDENTIAL|ELECTRON_RUN_AS_NODE/.test(key)));
  child = spawn(load('electron'), [source, temporary, `--user-data-dir=${path.join(temporary, 'profile')}`], { cwd: root, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', bytes => { stdout = (stdout + bytes.toString('utf8')).slice(-16384); }); child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString('utf8')).slice(-16384); });
  const exitCode = await Promise.race([new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }), new Promise(resolve => { timer = setTimeout(() => { expired = true; stop(); resolve(null); }, 52000); })]);
  clearTimeout(timer); wrapper.child = { pid: child.pid, exitCode, expired, stdout, stderr }; assert(!expired, 'Marketplace browser probe exceeded its deadline');
  let native; try { const file = path.join(output, 'report.json'); assert((await fs.lstat(file)).size < 256000); native = JSON.parse(await fs.readFile(file, 'utf8')); } catch { throw Error(`Marketplace browser exited with code ${exitCode} but no readable owned report was produced`); }
  assert.equal(native.nonce, nonce); assert.equal(native.commit, owner.commit); assert.equal(native.probeSourceSha256, sourceSha256); wrapper.native = native;
  assert.equal(exitCode, 0, native.errors?.join('\n')); assert.equal(native.passed, true, native.errors?.join('\n')); assert.equal(native.syntheticMarketplace, true); assert.equal(native.actualChromium, true); assert.equal(native.remainingWindows, 0); assert.equal(native.remainingRemoteViews, 0); assert.equal(native.shown, 0); assert.equal(native.providerCalls, 0); assert.equal(native.externalRequests, 0);
  assert.deepEqual(native.quotes.map(quote => quote.platform).sort(), ['1688', 'pdd', 'taobao']); assert(native.quotes.every(quote => quote.verification === 'candidate' && quote.priceCents === 150)); assert.equal(native.loginConfirmations.length, 1); assert.equal(native.loginConfirmations[0].platform, 'taobao');
  const png = await fs.readFile(path.join(output, 'toolbar-and-product.png')); assert(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))); assert.equal(png.length, native.capture.bytes); assert.equal(hash(png), native.capture.sha256); assert(png.readUInt32BE(16) > 100 && png.readUInt32BE(20) > 100); assert.equal(native.capture.composedNativeSurfaces, true); assert(native.capture.visibleProductPixels > 500);
  const pids = [...new Set([child.pid, ...native.processIds])].filter(pid => pid !== process.pid && Number.isInteger(pid)); for (let index = 0; index < 30 && pids.some(alive); index++) await new Promise(resolve => setTimeout(resolve, 100));
  wrapper.residualPids = pids.filter(alive); assert.equal(wrapper.residualPids.length, 0, 'Marketplace probe subprocesses remain after exit'); wrapper.passed = true;
} catch (error) { wrapper.error = String(error.stack || error); process.exitCode = 1; stop(); }
finally { clearTimeout(timer); await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'parent-report.json'), JSON.stringify(wrapper, null, 2) + '\n', { flag: 'wx' }); process.stdout.write(JSON.stringify({ passed: wrapper.passed, output, child: wrapper.child, error: wrapper.error }) + '\n'); }
