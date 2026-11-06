const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { app, BrowserWindow, session } = require('electron');

let fixtureRoot, owner, window, timer, finished = false, blockedRequests = 0;
const mode = process.argv[3];
const expectedPhase = mode === 'measure' ? 'measured' : 'verified';

function check(condition, code) {
  if (!condition) throw new Error(code);
}

function ownedPath(name, directory = false) {
  const target = path.join(fixtureRoot, name), stat = fs.lstatSync(target);
  check(!stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile()), 'OWNED_PATH_TYPE');
  check(fs.realpathSync(target) === target, 'OWNED_PATH_ALIAS');
  return target;
}

function prepare() {
  check(process.platform === 'win32' && process.env.CI === 'true' && process.env.GITHUB_ACTIONS === 'true', 'CI_WINDOWS_ONLY');
  check(/^[a-f0-9]{40}$/i.test(process.env.GITHUB_SHA || ''), 'CI_COMMIT');
  check(mode === 'measure' || mode === 'verify', 'MODE');
  check(process.env.RUNNER_TEMP && path.isAbsolute(process.env.RUNNER_TEMP), 'RUNNER_TEMP');
  check(process.argv[2] && path.isAbsolute(process.argv[2]), 'FIXTURE_ROOT');
  const requested = path.resolve(process.argv[2]), stat = fs.lstatSync(requested);
  check(stat.isDirectory() && !stat.isSymbolicLink(), 'FIXTURE_ROOT_TYPE');
  const canonical = fs.realpathSync(requested), temporary = fs.realpathSync(process.env.RUNNER_TEMP);
  check(path.dirname(canonical) === temporary && /^xuzuo-recovery-measurement-[a-z0-9-]+$/i.test(path.basename(canonical)), 'FIXTURE_ROOT_BOUNDARY');
  fixtureRoot = canonical;
  const candidateOwner = JSON.parse(fs.readFileSync(ownedPath('owner.json'), 'utf8'));
  check(candidateOwner.kind === 'xuzuo-recovery-measurement' && candidateOwner.commit === process.env.GITHUB_SHA && /^[a-f0-9-]{36}$/i.test(candidateOwner.nonce), 'OWNER');
  owner = candidateOwner;
  const profile = ownedPath('profile', true);
  for (const name of ['index.html', 'measure.mjs', 'fixtures.mjs', 'snapshot.mjs', 'recovery.mjs']) ownedPath(name);
  check(!fs.existsSync(path.join(fixtureRoot, `${mode}-result.json`)), 'RESULT_ALREADY_EXISTS');
  app.setPath('userData', profile);
  app.setPath('sessionData', profile);
  app.disableHardwareAcceleration();
}

function finish(result, code) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  let exitCode = code;
  try {
    if (fixtureRoot && owner) {
      const report = { ...result, commit: owner.commit, mode, blockedRequests,
        electron: process.versions.electron, chromium: process.versions.chrome,
        installerWizardTested: false, normalApplicationStarted: false, userProfileAccessed: false, providerCalls: 0 };
      fs.writeFileSync(path.join(fixtureRoot, `${mode}-result.json`), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    }
    if (app.isReady()) session.defaultSession.flushStorageData();
  } catch { exitCode = 1; }
  if (window && !window.isDestroyed()) window.destroy();
  process.exitCode = exitCode;
  if (exitCode) app.exit(exitCode);
  else app.quit();
}

function fail(error) {
  finish({ passed: false, phase: 'failed', nonce: owner?.nonce,
    error: /^[A-Z_]+$/.test(error?.message || '') ? error.message : 'MAIN_MEASUREMENT_FAILED',
    errorName: String(error?.name || 'Error').slice(0, 80) }, 1);
}

async function measure() {
  await app.whenReady();
  const allowed = new Set(['index.html', 'measure.mjs', 'fixtures.mjs', 'snapshot.mjs', 'recovery.mjs'].map(name => path.join(fixtureRoot, name)));
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    let permitted = false;
    try { permitted = details.url.startsWith('file:') && allowed.has(fileURLToPath(details.url)); } catch { /* Reject every non-owned request. */ }
    if (!permitted) blockedRequests++;
    callback({ cancel: !permitted });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  window = new BrowserWindow({ show: false, width: 1280, height: 800,
    webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-redirect', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('render-process-gone', () => fail(new Error('RENDER_PROCESS_GONE')));
  await window.loadFile(path.join(fixtureRoot, 'index.html'));
  const result = await window.webContents.executeJavaScript(`(async () => {
    if (!window.recoveryMeasurement || typeof window.recoveryMeasurement.then !== 'function') throw new Error('RENDERER_PROMISE_MISSING');
    return await window.recoveryMeasurement;
  })()`);
  check(JSON.stringify(result).length < 128 * 1024, 'RESULT_SIZE');
  check(result && result.nonce === owner.nonce, 'RESULT_NONCE');
  if (result.passed !== true) { finish(result, 1); return; }
  check(result.nonce === owner.nonce && result.phase === expectedPhase, 'RESULT_PHASE_OR_NONCE');
  if (mode === 'measure') check(Array.isArray(result.samples) && result.samples.length === 3, 'RESULT_SAMPLES');
  else check(result.verifiedCases === 3 && result.allValuesExact === true, 'RESULT_VERIFIED_CASES');
  finish(result, 0);
}

try {
  prepare();
  timer = setTimeout(() => fail(new Error('MEASUREMENT_DEADLINE')), 60000);
  measure().catch(fail);
} catch (error) { fail(error); }
