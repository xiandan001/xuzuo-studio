const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain, session } = require('electron');

const root = path.resolve(__dirname, '..'), mode = process.argv[3];
const sourceNames = ['electron/application-exit.cjs', 'electron/close-coordinator.cjs', 'electron/validation-lifecycle.cjs', 'scripts/chromium-close-retention-main.cjs', 'scripts/verify-chromium-close-retention.mjs'];
let directory, owner, window, deadline, failed = false, owned = false, stoppingLifecycle;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function check(value, code) { if (!value) throw Error(code); }
function ordinary(filename, directory = false) {
  const stat = fs.lstatSync(filename);
  check(!stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile()), 'OWNED_PATH_TYPE');
  check(fs.realpathSync(filename).toLowerCase() === path.resolve(filename).toLowerCase(), 'OWNED_PATH_REDIRECTED'); return stat;
}
function read(filename) { check(ordinary(filename).size <= 65536, 'OWNER_SIZE'); return JSON.parse(fs.readFileSync(filename, 'utf8')); }
function write(name, value) { fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); }
function fail(error) {
  if (failed) return; failed = true; clearTimeout(deadline); stoppingLifecycle?.();
  if (owned) {
    try { write(mode + '-failure.json', { ok: false, mode, nonce: owner.nonce, code: /^[A-Z_]+$/.test(error?.message || '') ? error.message : 'CHILD_FAILURE', name: error?.name }); } catch { /* Retain the first owned evidence. */ }
  }
  app.exit(1);
}
function prepare() {
  check(process.platform === 'win32' && process.env.CI === 'true' && process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted', 'HOSTED_WINDOWS_CI_ONLY');
  check(/^[a-f0-9]{40}$/i.test(process.env.GITHUB_SHA || '') && ['prime', 'edit', 'verify'].includes(mode), 'COMMIT_OR_MODE');
  check(process.env.RUNNER_TEMP && process.env.GITHUB_WORKSPACE && process.argv[2] && path.isAbsolute(process.argv[2]), 'FIXTURE_ARGUMENTS');
  check(fs.realpathSync(process.env.GITHUB_WORKSPACE).toLowerCase() === fs.realpathSync(root).toLowerCase(), 'WORKSPACE_IDENTITY');
  directory = path.resolve(process.argv[2]); ordinary(directory, true);
  owner = read(path.join(directory, 'owner.json'));
  const parent = path.dirname(directory); ordinary(parent, true);
  check(path.dirname(parent).toLowerCase() === fs.realpathSync(process.env.RUNNER_TEMP).toLowerCase() && /^xuzuo-chromium-close-/.test(path.basename(parent)), 'ROOT_BOUNDARY');
  const parentOwner = read(path.join(parent, 'owner.json'));
  check(parentOwner.kind === 'xuzuo-chromium-close-root' && parentOwner.commit === process.env.GITHUB_SHA && parentOwner.directory.toLowerCase() === parent.toLowerCase(), 'PARENT_OWNER');
  check(owner.kind === 'xuzuo-chromium-close-case' && owner.commit === process.env.GITHUB_SHA && owner.parentNonce === parentOwner.nonce && owner.directory.toLowerCase() === directory.toLowerCase(), 'CASE_OWNER');
  check(process.versions.electron === owner.electronVersion, 'LOCKED_ELECTRON_VERSION');
  check(/^[a-f0-9-]{36}$/i.test(owner.nonce) && ['normal', 'validation', 'control'].includes(owner.strategy) && [1, 2, 3].includes(owner.iteration) && path.basename(directory) === owner.strategy + '-' + owner.iteration, 'CASE_IDENTITY');
  check(JSON.stringify(Object.keys(owner.sources).sort()) === JSON.stringify([...sourceNames].sort()), 'SOURCE_SET');
  for (const relative of sourceNames) { const filename = path.join(root, relative); ordinary(filename); check(hash(fs.readFileSync(filename)) === owner.sources[relative], 'SOURCE_HASH_CHANGED'); }
  for (const name of ['index.html', 'preload.cjs']) { const filename = path.join(directory, name); ordinary(filename); check(hash(fs.readFileSync(filename)) === owner.inputs[name], 'FIXTURE_INPUT_CHANGED'); }
  const profile = path.join(directory, 'profile'); ordinary(profile, true); check(owner.profile.toLowerCase() === profile.toLowerCase(), 'PROFILE_IDENTITY');
  check(!fs.existsSync(path.join(directory, mode + '-result.json')) && !fs.existsSync(path.join(directory, mode + '-failure.json')), 'PHASE_ALREADY_RUN');
  app.setPath('userData', profile); app.setPath('sessionData', profile); app.disableHardwareAcceleration();
  owned = true;
}
function controlClose() {
  // void return is not a disk acknowledgement; only the later cold read is proof.
  session.defaultSession.flushStorageData(); window.destroy(); app.quit();
}
async function run() {
  await app.whenReady(); app.on('window-all-closed', () => {});
  const html = path.join(directory, 'index.html'), url = pathToFileURL(html).href;
  const allowed = new Set([html, path.join(directory, 'preload.cjs')].map(value => value.toLowerCase()));
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    let permit = false; try { permit = details.url.startsWith('file:') && allowed.has(fileURLToPath(details.url).toLowerCase()); } catch {}
    callback({ cancel: !permit });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false)); session.defaultSession.setPermissionCheckHandler(() => false);
  window = new BrowserWindow({ width: 640, height: 400, show: false, webPreferences: { preload: path.join(directory, 'preload.cjs'), sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault()); window.webContents.on('will-redirect', event => event.preventDefault()); window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('render-process-gone', () => { if (!window.isDestroyed()) fail(Error('RENDER_PROCESS_GONE')); });
  window.on('show', () => fail(Error('UNEXPECTED_VISIBLE_WINDOW')));
  if (mode === 'edit' && owner.strategy === 'normal') {
    const { createApplicationExit } = require('../electron/application-exit.cjs');
    const trustedSender = event => event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === url;
    const exit = createApplicationExit({ app, ipcMain, getWindow: () => window, trustedSender,
      dialog: { showMessageBox: async () => { fail(Error('UNEXPECTED_CONFIRMATION')); throw Error('UNEXPECTED_CONFIRMATION'); } },
      getTaskState: async () => ({ running: 0 }), drain: async () => {}, beforeExit: async () => {}, onStatus: () => {} });
    exit.install(window);
  }
  await window.loadFile(html);
  const config = { key: 'xuzuo-home-chat-input-v1:ci-workspace:' + owner.nonce, nonce: owner.nonce, mode,
    baseline: '独立关闭验证基线：未发送。' + owner.nonce,
    edited: '独立关闭验证新输入：未发送；不调用模型。'.repeat(16) + '\n' + owner.nonce + '-最新尾-END' };
  const observed = await window.webContents.executeJavaScript(`(() => {
    const c = ${JSON.stringify(config)};
    if (!window.retentionFixture || window.retentionFixture.nonce !== c.nonce) throw Error('PRELOAD_NOT_READY');
    const old = localStorage.getItem(c.key);
    if (c.mode === 'prime') { if (old !== null) throw Error('BASELINE_NOT_EMPTY'); localStorage.setItem(c.key, c.baseline); return { baselineMatched: localStorage.getItem(c.key) === c.baseline }; }
    if (c.mode === 'edit') { if (old !== c.baseline) return { baselineMatched: false, readbackMatched: false }; localStorage.setItem(c.key, c.edited); return { baselineMatched: true, readbackMatched: localStorage.getItem(c.key) === c.edited }; }
    return { retained: old === c.edited, baselineOnly: old === c.baseline, absent: old === null, characters: old === null ? 0 : old.length };
  })()`);
  const metricPids = app.getAppMetrics().map(value => value.pid).filter(value => Number.isInteger(value) && value > 0);
  write(mode + '-result.json', { ok: true, mode, nonce: owner.nonce, commit: owner.commit, strategy: owner.strategy, iteration: owner.iteration, observed, metricPids,
    electron: process.versions.electron, chromium: process.versions.chrome, sameUrl: url, profile: owner.profile,
    validationOwnerLossInjected: mode === 'edit' && owner.strategy === 'validation', validationDefaultPollMs: 2000, readbackEvidenceWrittenBeforeClose: true });
  if (mode !== 'verify') check(observed.baselineMatched && (mode !== 'edit' || observed.readbackMatched), 'PRE_CLOSE_READBACK_MISMATCH');
  if (mode !== 'edit' || owner.strategy === 'control') { controlClose(); return; }
  if (owner.strategy === 'normal') { window.close(); return; }
  const { readValidationOwner, startValidationLifecycle } = require('../electron/validation-lifecycle.cjs');
  const validation = readValidationOwner(owner.profile); check(validation && validation.ownerPid === owner.ownerPid, 'VALIDATION_OWNER_INVALID');
  stoppingLifecycle = startValidationLifecycle({ ...validation, isAlive: () => false, requestExit: async () => { await Promise.resolve(); app.exit(0); }, forceExit: () => fail(Error('VALIDATION_FORCE_EXIT')) });
}
try { prepare(); deadline = setTimeout(() => fail(Error('CHILD_DEADLINE')), 15000); run().catch(fail); }
catch (error) { fail(error); }
