import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

assert.equal(process.platform, 'win32', 'Project flow renderer acceptance is Windows CI-only');
assert.equal(process.env.CI, 'true'); assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.match(process.env.GITHUB_SHA || '', /^[a-f0-9]{40}$/i);
assert(process.env.RUNNER_TEMP && process.env.GITHUB_WORKSPACE);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), load = createRequire(path.join(root, 'package.json'));
assert.equal((await fs.realpath(root)).toLowerCase(), (await fs.realpath(process.env.GITHUB_WORKSPACE)).toLowerCase());
const dist = path.join(root, 'work/project-flow-browser-dist'), output = path.join(root, 'work/project-flow-browser-output');
const temporaryRoot = await fs.realpath(process.env.RUNNER_TEMP), temporary = await fs.mkdtemp(path.join(temporaryRoot, 'xuzuo-project-flow-browser-')), nonce = randomUUID();
const hash = bytes => createHash('sha256').update(bytes).digest('hex'), started = performance.now();
const report = { passed: false, commit: process.env.GITHUB_SHA, scope: 'Actual Chromium DOM project overview, feedback, editor export and revision-adoption interactions with isolated example Native bridges; real Office bytes and native adoption are covered by separate tests', normalApplicationStarted: false, userProfileAccessed: false, providerCalls: 0, errors: [], temporary };
const exists = async file => { try { await fs.lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const alive = pid => { if (!Number.isInteger(pid) || pid < 1) return false; try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; if (error.code === 'EPERM') return true; throw error; } };
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
function stop(pid) { if (alive(pid)) spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 5000, stdio: 'ignore' }); }
async function bundleFiles(directory, base = directory, result = {}) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name); assert(!entry.isSymbolicLink(), 'Fixture output must contain ordinary files');
    if (entry.isDirectory()) await bundleFiles(file, base, result);
    else { assert(entry.isFile()); const bytes = await fs.readFile(file); assert(bytes.length < 16 * 1024 * 1024); result[path.relative(base, file).replaceAll('\\', '/')] = hash(bytes); }
  }
  assert(Object.keys(result).length <= 100); return result;
}
async function launch(owner) {
  const { isolatedEnvironment } = createRequire(import.meta.url)('./verify-bead-native.cjs');
  const environment = isolatedEnvironment(temporary, { directory: root });
  Object.assign(environment, { CI: 'true', GITHUB_ACTIONS: 'true', GITHUB_SHA: report.commit, GITHUB_WORKSPACE: root, RUNNER_TEMP: temporaryRoot });
  assert(!Object.keys(environment).some(key => /TOKEN|PASSWORD|SECRET|API_KEY|CREDENTIAL/.test(key)));
  const child = spawn(load('electron'), [path.join(root, 'scripts/verify-project-flow-browser-native.cjs'), temporary, `--user-data-dir=${path.join(temporary, 'profile')}`], { cwd: root, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', timedOut = false;
  child.stdout.on('data', chunk => { stdout = (stdout + chunk.toString('utf8')).slice(-8192); });
  child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-8192); });
  let timeout;
  let exitCode;
  try { exitCode = await Promise.race([new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }), new Promise(resolve => { timeout = setTimeout(() => { timedOut = true; stop(child.pid); resolve(null); }, 52000); })]); }
  finally { clearTimeout(timeout); }
  let native;
  try { native = JSON.parse(await fs.readFile(path.join(temporary, 'native-report.json'), 'utf8')); } catch { /* The outer report records bootstrap failures too. */ }
  report.native = native; report.child = { pid: child.pid, exitCode, timedOut, stdout, stderr };
  assert(native && native.nonce === owner.nonce && native.commit === report.commit, 'Owned Native report missing or has wrong identity');
  const pids = [...new Set([child.pid, ...native.processIds].filter(pid => Number.isInteger(pid) && pid !== process.pid))];
  for (let attempt = 0; attempt < 30 && pids.some(alive); attempt++) await delay(100);
  report.residualPids = pids.filter(alive);
  assert.equal(report.residualPids.length, 0, 'Owned renderer subprocesses remain after exit');
  assert(!timedOut, 'Native UI acceptance exceeded its bounded deadline'); assert.equal(exitCode, 0, native.errors.join('\n')); assert.equal(native.passed, true, native.errors.join('\n'));
}
let watchdog;
try {
  assert(!await exists(dist), 'Use a clean CI checkout: existing browser dist is retained');
  assert(!await exists(output), 'Previous browser evidence is never overwritten');
  await fs.mkdir(output, { recursive: true });
  watchdog = setTimeout(() => { process.stderr.write('Project flow renderer wrapper exceeded 115 seconds\n'); process.exit(1); }, 115000);
  try { os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* Inherit restricted CI scheduling. */ }
  const vite = await import(pathToFileURL(load.resolve('vite')).href), react = (await import(pathToFileURL(load.resolve('@vitejs/plugin-react')).href)).default;
  const csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
  const buildStart = performance.now();
  await vite.build({ configFile: false, root: path.join(root, 'scripts/fixtures'), base: './', plugins: [react(), { name: 'isolated-business-fixture-csp', transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp }, injectTo: 'head' }] }], build: { outDir: dist, emptyOutDir: false, sourcemap: false, rollupOptions: { input: path.join(root, 'scripts/fixtures/project-flow-browser-fixture.html') } } });
  report.buildMs = Math.round(performance.now() - buildStart);
  const files = await bundleFiles(dist); assert(Object.keys(files).includes('project-flow-browser-fixture.html'));
  const sources = {};
  for (const relative of ['scripts/verify-project-flow-browser.mjs', 'scripts/verify-project-flow-browser-native.cjs', 'scripts/fixtures/project-flow-browser-fixture.tsx', 'scripts/fixtures/project-flow-browser-fixture.html', 'src/pages/ProjectHub.tsx', 'src/pages/project-hub.css', 'src/pages/Projects.tsx', 'src/components/EditableDocumentStudio.tsx', 'src/components/DocumentRevisionPanel.tsx', 'src/components/business/FeedbackPanel.tsx', 'src/lib/document-revision-context.ts', 'src/hooks/useProjectBrowserState.ts', 'src/pages/business-studio-demo-data.ts', 'src/components/HomeBusinessTodos.tsx', 'src/lib/business-receivables.ts', 'src/lib/business-view.ts', 'src/lib/project-file-roles.ts', 'src/lib/project-browser-state.ts', 'src/lib/business-editor-focus.ts', 'src/components/document-revision.css', 'src/components/business/business-intake-payments.css', 'src/styles.css', 'src/theme.css', 'src/appearance-palettes.css', 'src/surface-depth.css', 'src/next-interface.css']) sources[relative] = hash(await fs.readFile(path.join(root, relative)));
  const owner = { kind: 'xuzuo-project-flow-browser', nonce, commit: report.commit, parentPid: process.pid, temporaryRoot, dist: await fs.realpath(dist), output: await fs.realpath(output), files, sources };
  await fs.mkdir(path.join(temporary, 'profile'), { recursive: true });
  await fs.writeFile(path.join(temporary, 'owner.json'), JSON.stringify(owner) + '\n', { flag: 'wx' });
  report.sources = sources; report.fixtureFiles = files; await launch(owner); report.passed = true;
} catch (error) { report.errors.push(String(error.stack || error)); process.exitCode = 1; }
finally {
  clearTimeout(watchdog); report.elapsedMs = Math.round(performance.now() - started);
  // Keep the owned empty profile and evidence in CI temporary storage; no recursive cleanup touches user files.
  if (await exists(output) && !await exists(path.join(output, 'report.json'))) await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(JSON.stringify({ passed: report.passed, report: path.join(output, 'report.json'), errors: report.errors }) + '\n');
}
