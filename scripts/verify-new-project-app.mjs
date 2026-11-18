import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
const root = await fs.realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const localRuntime = process.argv.includes('--local-runtime'), dependencyRoot = path.join(root, ...(localRuntime ? ['work', 'ui-build'] : [])), load = createRequire(path.join(dependencyRoot, 'package.json'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex'), same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const temporaryRoot = await fs.realpath(os.tmpdir()), directory = await fs.mkdtemp(path.join(temporaryRoot, 'xuzuo-new-project-app-'));
const mirror = await fs.mkdtemp(path.join(root, 'work/new-project-app-runtime-')), output = path.join(mirror, 'evidence'), profile = path.join(directory, 'profile'), workspace = path.join(directory, 'workspace');
const report = { passed: false, localDiagnostic: true, eligibleForReleaseAcceptance: false, scope: 'Full production App/main/preload and official Vite configuration, temporary registered workspace and seeded isolated renderer metadata; UI-only creation, real disk checks, no real account/model/install', dependencyMode: localRuntime ? 'owned-local-build-runtime' : 'locked-root-runtime', directory, mirror, output, providerCalls: 0, userProfileAccessed: false, errors: [] };
let child;
async function inventory(base, current = base, result = {}) { for (const entry of await fs.readdir(current, { withFileTypes: true })) { const file = path.join(current, entry.name), stat = await fs.lstat(file); assert(!stat.isSymbolicLink(), 'Unexpected source link: ' + file); if (stat.isDirectory()) await inventory(base, file, result); else { assert(stat.isFile() && stat.size < 32 * 1024 * 1024); result[path.relative(base, file).replaceAll('\\', '/')] = hash(await fs.readFile(file)); } } return result; }
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function stop(pid) { if (Number.isInteger(pid) && pid > 0 && alive(pid)) spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 5000, stdio: 'ignore' }); }
try {
  assert.equal(process.platform, 'win32'); await fs.mkdir(output); await fs.mkdir(profile); await fs.mkdir(workspace);
  const nonce = randomUUID(), workspaceId = 'workspace-new-project-smoke';
  const sources = {};
  for (const name of ['src', 'electron', 'assets']) { const files = await inventory(path.join(root, name)); for (const [file, digest] of Object.entries(files)) if (name !== 'src' || !/\.(?:test|spec)\.[jt]sx?$/.test(file)) sources[name + '/' + file] = digest; await fs.cp(path.join(root, name), path.join(mirror, name), { recursive: true, errorOnExist: true }); }
  for (const name of ['index.html', 'dialog.html', 'vite.config.ts', 'tsconfig.json', 'package.json']) { const data = await fs.readFile(path.join(root, name)); sources[name] = hash(data); await fs.writeFile(path.join(mirror, name), data, { flag: 'wx' }); }
  for (const name of ['scripts/verify-new-project-app.mjs', 'scripts/verify-new-project-app-native.cjs']) sources[name] = hash(await fs.readFile(path.join(root, name)));
  const dependencies = await fs.realpath(path.join(dependencyRoot, 'node_modules')); assert(same(dependencies, path.join(dependencyRoot, 'node_modules'))); await fs.symlink(dependencies, path.join(mirror, 'node_modules'), 'junction');
  const vite = await import(pathToFileURL(load.resolve('vite')).href);
  await vite.build({ root: mirror, configFile: path.join(mirror, 'vite.config.ts') });
  const { createWorkspaceStorage } = load(path.join(mirror, 'electron/workspace-storage.cjs')), { createArtifactStore } = load(path.join(mirror, 'electron/artifact-store.cjs'));
  const storage = createWorkspaceStorage({ directory: profile }), artifacts = createArtifactStore({ directory: path.join(profile, 'artifacts-v1'), workspaceStorage: storage }); storage.setArtifactMigrator((...args) => artifacts.migrateProject(...args));
  await storage.bindRoot({ workspaceId, name: '新建作品真实验收', directory: workspace, projects: [] });
  const sentinel = path.join(workspace, 'existing-workspace-file.txt'); await fs.writeFile(sentinel, 'OWNED_WORKSPACE_SENTINEL_4882', { flag: 'wx' });
  const seed = { workspaces: [{ id: workspaceId, name: '新建作品真实验收', directory: workspace, description: '独立临时资料，无账户', createdAt: new Date().toISOString() }], activeWorkspaceId: workspaceId, projects: [], ledger: [], customPrompts: [], preferencesByWorkspace: { [workspaceId]: { hourlyRate: 0, channelFeePercent: 0, targetProfit: 0, monthlyBudget: 0, reduceMotion: true } } };
  const owner = { kind: 'xuzuo-new-project-app', nonce, ownerPid: process.pid, directory, profile, workspace, workspaceId, mirror, output, dependencyRoot: dependencies, sources, distFiles: await inventory(path.join(mirror, 'dist')), seed, sentinel, sentinelSha256: hash(await fs.readFile(sentinel)) };
  await fs.writeFile(path.join(profile, '.xuzuo-validation-profile.json'), JSON.stringify({ version: 1, kind: 'xuzuo-owned-validation', ownerPid: process.pid, directory: profile }) + '\n', { flag: 'wx' });
  await fs.writeFile(path.join(directory, 'owner.json'), JSON.stringify(owner, null, 2) + '\n', { flag: 'wx' }); report.nonce = nonce; report.sources = sources; report.officialConfigurationSha256 = sources['vite.config.ts'];
  const { isolatedEnvironment } = load(path.join(root, 'scripts/verify-bead-native.cjs')), env = isolatedEnvironment(directory, { directory: dependencyRoot }); Object.assign(env, { XUZUO_QA_PROFILE: profile, XUZUO_QA_VISIBLE: '0', XUZUO_QA_EXIT_CONFIRMATION: 'exit' }); delete env.NODE_OPTIONS; delete env.ELECTRON_RUN_AS_NODE;
  assert(!Object.keys(env).some(key => /API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/.test(key)));
  child = spawn(load('electron'), [path.join(root, 'scripts/verify-new-project-app-native.cjs'), path.join(directory, 'owner.json'), '--user-data-dir=' + profile], { cwd: mirror, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', expired = false, timer; child.stdout.on('data', bytes => { stdout = (stdout + bytes).slice(-16000); }); child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-16000); });
  const exitCode = await Promise.race([new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }), new Promise(resolve => { timer = setTimeout(() => { expired = true; stop(child.pid); resolve(null); }, 105000); })]); clearTimeout(timer);
  report.child = { pid: child.pid, exitCode, expired, stdout, stderr }; report.native = JSON.parse(await fs.readFile(path.join(directory, 'native-report.json'), 'utf8'));
  const pids = [...new Set([child.pid, ...report.native.processIds])].filter(pid => Number.isInteger(pid) && pid !== process.pid); for (let n = 0; n < 25 && pids.some(alive); n++) await delay(100); report.residualPids = pids.filter(alive); for (const pid of report.residualPids) stop(pid);
  assert.equal(expired, false); assert.equal(exitCode, 0, stderr); assert.equal(report.native.nonce, nonce); assert.equal(report.native.passed, true, report.native.errors.join('\n')); assert.equal(report.residualPids.length, 0); assert.equal(report.native.screenshots.length, 6); assert.equal(report.native.breadcrumbChecks.length, 2); assert(report.native.breadcrumbChecks.every(item => item.returnedSameWorkspace)); assert.equal(report.native.steps.length, 4); assert.equal(report.native.productionMainLoaded, true); assert.equal(report.native.modelCommands, 0); assert.equal(report.native.modelNetworkAttempts, 0); assert.equal(report.native.windows.created, 1); assert.equal(report.native.windows.shown, 0); assert.equal(report.native.windows.remaining, 0);
  for (const [name, digest] of Object.entries(sources)) assert.equal(hash(await fs.readFile(path.join(root, name))), digest, 'Source changed during app smoke: ' + name);
  assert.equal(hash(await fs.readFile(sentinel)), owner.sentinelSha256); report.passed = true;
} catch (error) { report.errors.push(String(error.stack || error)); process.exitCode = 1; if (child?.pid) stop(child.pid); }
finally { await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); console.log(JSON.stringify({ passed: report.passed, report: path.join(output, 'report.json'), errors: report.errors })); }
