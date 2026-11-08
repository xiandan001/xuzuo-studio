import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), buildOnly = process.argv.includes('--build-only');
const load = createRequire(path.join(root, buildOnly ? 'work/ui-build/package.json' : 'package.json'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex'), delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const output = path.join(root, 'work/animation-studio-output');
let dist, temporary, watchdog, runningChild;
const report = { passed: false, commit: process.env.GITHUB_SHA, scope: 'Actual AnimationStudio React, isolated Electron, real store/artifacts/service/LiveWorkflowEngine/ModelRuntime and bundled animation helper; synthetic localhost PNG provider only', actualProviderUsed: false, userProfileAccessed: false, normalApplicationStarted: false, errors: [] };
const exists = async filename => { try { await fs.lstat(filename); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
function stop(pid) { if (Number.isInteger(pid) && alive(pid)) spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 5000, stdio: 'ignore' }); }
async function inventory(directory, base = directory, result = {}) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) { assert(!entry.isSymbolicLink()); const file = path.join(directory, entry.name); if (entry.isDirectory()) await inventory(file, base, result); else { const bytes = await fs.readFile(file); assert(bytes.length < 16 * 1024 * 1024); result[path.relative(base, file).replaceAll('\\', '/')] = hash(bytes); } }
  assert(Object.keys(result).length <= 100); return result;
}
async function build() {
  const vite = await import(pathToFileURL(load.resolve('vite')).href), react = (await import(pathToFileURL(load.resolve('@vitejs/plugin-react')).href)).default;
  const csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
  await vite.build({ configFile: false, root: path.join(root, 'scripts/fixtures'), base: './', plugins: [react(), { name: 'animation-qa-csp', transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp }, injectTo: 'head' }] }], resolve: buildOnly ? { alias: ['react', 'react-dom', 'lucide-react'].map(name => ({ find: name, replacement: path.join(root, 'work/ui-build/node_modules', name) })) } : undefined, build: { outDir: dist, emptyOutDir: false, sourcemap: false, rollupOptions: { input: path.join(root, 'scripts/fixtures/animation-studio.html') } } });
}
async function main() {
  try { os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* Inherit restricted CI priority. */ }
  if (buildOnly) { dist = await fs.mkdtemp(path.join(root, 'work/animation-studio-build-check-')); await build(); console.log(JSON.stringify({ built: true, dist, applicationStarted: false, providerCalls: 0 })); return; }
  assert.equal(process.platform, 'win32'); assert.equal(process.env.CI, 'true'); assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.match(report.commit || '', /^[a-f0-9]{40}$/); assert.equal((await fs.realpath(root)).toLowerCase(), (await fs.realpath(process.env.GITHUB_WORKSPACE)).toLowerCase());
  assert(!await exists(output), 'Previous UI evidence is retained'); dist = path.join(root, 'work/animation-studio-dist'); assert(!await exists(dist), 'Use a clean CI fixture directory'); await fs.mkdir(output, { recursive: true });
  const temporaryRoot = await fs.realpath(process.env.RUNNER_TEMP); temporary = await fs.mkdtemp(path.join(temporaryRoot, 'xuzuo-animation-studio-')); const nonce = randomUUID();
  watchdog = setTimeout(() => { if (runningChild?.pid) stop(runningChild.pid); process.stderr.write('Animation UI wrapper exceeded its bounded deadline\n'); process.exit(1); }, 110000);
  await build(); const files = await inventory(dist), sources = {};
  const names = ['scripts/verify-animation-studio.mjs', 'scripts/verify-animation-studio-native.cjs', 'scripts/fixtures/animation-studio.html', 'scripts/fixtures/animation-studio.tsx', 'src/pages/AnimationStudio.tsx', 'src/components/animation/AnimationEntryEditor.tsx', 'src/components/animation/AnimationImage.tsx', 'src/components/animation/useAnimationDocument.ts', 'src/components/animation/animation-studio.css', 'electron/animation-service.cjs', 'electron/animation-tool.cjs', 'electron/animation-store.cjs'];
  for (const name of names) sources[name] = hash(await fs.readFile(path.join(root, name)));
  const tool = path.join(root, 'work/animation-runtime/xuzuo-animation/xuzuo-animation.exe'); assert((await fs.lstat(tool)).isFile());
  const owner = { kind: 'xuzuo-animation-studio', nonce, commit: report.commit, parentPid: process.pid, temporaryRoot, temporary, output, dist, files, sources, tool, toolSha256: hash(await fs.readFile(tool)) };
  await fs.mkdir(path.join(temporary, 'profile')); await fs.writeFile(path.join(temporary, 'owner.json'), JSON.stringify(owner) + '\n', { flag: 'wx' });
  const { isolatedEnvironment } = load('./scripts/verify-bead-native.cjs'), env = isolatedEnvironment(temporary, { directory: root }); Object.assign(env, { CI: 'true', GITHUB_ACTIONS: 'true', GITHUB_SHA: report.commit, GITHUB_WORKSPACE: root, RUNNER_TEMP: temporaryRoot });
  assert(!Object.keys(env).some(key => /TOKEN|API_KEY|SECRET|PASSWORD|CREDENTIAL|ELECTRON_RUN_AS_NODE/.test(key)));
  const child = spawn(load('electron'), [path.join(root, 'scripts/verify-animation-studio-native.cjs'), temporary, `--user-data-dir=${path.join(temporary, 'profile')}`], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '', stderr = '', expired = false, timer;
  runningChild = child;
  child.stdout.on('data', value => { stdout = (stdout + value.toString()).slice(-16384); }); child.stderr.on('data', value => { stderr = (stderr + value.toString()).slice(-16384); });
  const code = await Promise.race([new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }), new Promise(resolve => { timer = setTimeout(() => { expired = true; stop(child.pid); resolve(null); }, 100000); })]); clearTimeout(timer);
  report.child = { pid: child.pid, code, expired, stdout, stderr }; report.native = JSON.parse(await fs.readFile(path.join(temporary, 'native-report.json'), 'utf8')); const native = report.native;
  assert.equal(native.nonce, nonce); assert.equal(native.commit, report.commit); const pids = [...new Set([child.pid, ...native.processIds])].filter(pid => Number.isInteger(pid) && pid !== process.pid);
  for (let index = 0; index < 30 && pids.some(alive); index++) await delay(100); report.residualPids = pids.filter(alive);
  assert(!expired && code === 0 && native.passed, native.errors?.join('\n')); assert.equal(report.residualPids.length, 0); assert.equal(native.externalRequests, 0); report.sources = sources; report.fixtureFiles = files; report.passed = true;
}
main().catch(error => { report.errors.push(String(error.stack || error)); process.exitCode = 1; }).finally(async () => { clearTimeout(watchdog); if (!buildOnly && await exists(output) && !await exists(path.join(output, 'report.json'))) await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); if (!buildOnly) console.log(JSON.stringify({ passed: report.passed, report: path.join(output, 'report.json'), errors: report.errors })); });
