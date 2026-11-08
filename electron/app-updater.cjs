const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { RELEASES_URL, compareVersions, selectRelease, parseUpdateManifest, validateUpdateRecord, isAllowedDownloadUrl } = require('./update-release.cjs');
const INITIAL_UPDATE_DELAY_MS = 3000;
const AUTO_UPDATE_INTERVAL_MS = 2 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15 * 60 * 1000;

async function readJson(file, limit = 16384) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) throw Error('更新本地记录无效。');
  return JSON.parse(await fs.readFile(file, 'utf8'));
}
async function writeJson(file, value) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  try { await fs.writeFile(temporary, JSON.stringify(value) + '\n', { encoding: 'utf8', flag: 'wx' }); await fs.rename(temporary, file); }
  finally { await fs.unlink(temporary).catch(() => undefined); }
}
async function verifyFile(file, expected) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== expected.size) throw Error('更新安装包大小校验失败。');
  const hash = createHash('sha512'); let size = 0;
  for await (const chunk of createReadStream(file)) { size += chunk.length; if (size > expected.size) throw Error('更新安装包大小校验失败。'); hash.update(chunk); }
  if (size !== expected.size || hash.digest('base64') !== expected.sha512) throw Error('更新安装包校验失败，请等待重新下载。');
}
async function readBounded(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) throw Error('更新信息过大。');
  const chunks = []; let size = 0;
  for await (const data of response.body || []) { const chunk = Buffer.from(data); size += chunk.length; if (size > limit) throw Error('更新信息过大。'); chunks.push(chunk); }
  return Buffer.concat(chunks).toString('utf8');
}
async function fetchTrusted(fetchImpl, initial, signal, currentVersion) {
  let url = initial;
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (url !== initial && !isAllowedDownloadUrl(url)) throw Error('更新下载重定向地址无效。');
    const response = await fetchImpl(url, { signal, redirect: 'manual', headers: { 'User-Agent': `xuzuo-studio/${currentVersion}`, Accept: initial === RELEASES_URL ? 'application/vnd.github+json' : 'application/octet-stream', 'Cache-Control': 'no-cache' } });
    if (response.url && response.url !== url && !isAllowedDownloadUrl(response.url)) throw Error('更新下载重定向地址无效。');
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel?.();
      if (!location || initial === RELEASES_URL) throw Error('GitHub 更新重定向异常。');
      url = new URL(location, url).href; continue;
    }
    if (!response.ok) { await response.body?.cancel?.(); throw Error(`GitHub 更新服务返回 ${response.status}，稍后将自动重试。`); }
    return response;
  }
  throw Error('更新下载重定向次数过多。');
}

function createAppUpdater({ app, maintenance, fetchImpl = globalThis.fetch, powerMonitor, onStatus = () => {}, platform = process.platform,
  executablePath = process.execPath, spawnImpl = spawn, processStartTime = typeof process.getCreationTime === 'function' ? process.getCreationTime() : undefined,
  now = Date.now, schedule = setTimeout, cancel = clearTimeout }) {
  const directory = path.join(app.getPath('userData'), 'updates'), settingsFile = path.join(directory, 'settings.json'), readyFile = path.join(directory, 'ready.json');
  const resultFile = path.join(directory, 'result.json');
  const state = { available: false, enabled: true, phase: 'unavailable', currentVersion: app.getVersion() };
  let started, stopped = false, ending = false, installed = false, enabled = true, confirmedEnabled = true, ready = null, timer = null, nextDueAt = null, generation = 0;
  let flight = null, controller = null, settingsQueue = Promise.resolve(), installFlight = null;
  const status = () => ({ ...state });
  function update(patch) { Object.assign(state, patch); try { onStatus(status()); } catch { /* Renderer shutdown does not invalidate background work. */ } }
  function clearTimer() { if (timer !== null) cancel(timer); timer = null; }
  function cancelWork() { generation++; clearTimer(); controller?.abort(); }
  function arm(delay) {
    clearTimer(); if (stopped || !enabled || !state.available) return;
    timer = schedule(() => { timer = null; void tick(); }, Math.max(0, delay)); timer?.unref?.();
  }
  async function setting() {
    try { const value = await readJson(settingsFile); if (typeof value?.enabled !== 'boolean') throw Error('自动更新设置无效。'); return value.enabled; }
    catch (error) { if (error.code === 'ENOENT') return true; throw error; }
  }
  async function cachedUpdate() {
    const value = validateUpdateRecord(await readJson(readyFile));
    if (compareVersions(value.version, state.currentVersion) <= 0) throw Error('更新缓存版本已过期。');
    await verifyFile(path.join(directory, value.filename), value); return value;
  }
  async function restoreReady() {
    try { ready = await cachedUpdate(); return true; }
    catch { ready = null; await fs.unlink(readyFile).catch(() => undefined); return false; }
  }
  function idleStatus(message) {
    update({ phase: enabled ? (ready ? 'ready' : 'idle') : 'disabled', version: ready?.version, progress: ready ? 100 : undefined,
      message: message || (ready ? '更新已下载，将在正常退出后安装。' : enabled ? '启动后检查更新，此后每 2 小时自动检查。' : '自动更新已关闭。') });
  }
  async function resultMessage() {
    try { const result = await readJson(resultFile); if (typeof result.success !== 'boolean' || typeof result.version !== 'string') return;
      if (result.success && compareVersions(result.version, state.currentVersion) === 0) return `已更新至 ${state.currentVersion}。`;
      if (!result.success) return '上次自动更新未完成，当前版本可继续使用；稍后将重试。';
    } catch { /* An absent or obsolete installer result does not prevent future checks. */ }
  }
  async function saveDownload(record, response, signal, isCurrent) {
    const file = path.join(directory, record.filename), temporary = file + '.' + randomUUID() + '.part'; let handle;
    const hash = createHash('sha512'); let size = 0;
    try {
      if (response.headers.has('content-length') && Number(response.headers.get('content-length')) !== record.size) throw Error('更新安装包大小与清单不一致。');
      handle = await fs.open(temporary, 'wx');
      for await (const data of response.body || []) {
        if (signal.aborted || !isCurrent()) throw Error('更新下载已取消。');
        const chunk = Buffer.from(data); size += chunk.length;
        if (size > record.size) throw Error('更新安装包大小校验失败。');
        hash.update(chunk); await handle.writeFile(chunk); update({ progress: Math.min(99, size / record.size * 100) });
      }
      if (signal.aborted || !isCurrent()) throw Error('更新下载已取消。');
      if (size !== record.size || hash.digest('base64') !== record.sha512) throw Error('更新安装包校验失败，请等待重新下载。');
      await handle.sync(); await handle.close(); handle = null;
      await fs.rename(temporary, file);
      if (!isCurrent()) return;
      await writeJson(readyFile, record); const previous = ready; ready = record;
      if (previous && previous.filename !== record.filename) await fs.unlink(path.join(directory, previous.filename)).catch(() => undefined);
      if (isCurrent()) idleStatus();
    } finally { await handle?.close().catch(() => undefined); await fs.unlink(temporary).catch(() => undefined); }
  }
  function check() {
    if (flight || stopped || !enabled || !state.available) return flight || Promise.resolve();
    const revision = generation, current = () => !stopped && enabled && generation === revision;
    const activeController = new AbortController(); controller = activeController;
    const timeout = schedule(() => activeController.abort(), REQUEST_TIMEOUT_MS); timeout?.unref?.();
    const pending = Promise.resolve().then(async () => {
      if (!current()) return;
      update({ phase: 'checking', progress: undefined, message: '正在检查 GitHub 新版本。' });
      try {
        const response = await fetchTrusted(fetchImpl, RELEASES_URL, activeController.signal, state.currentVersion);
        const release = selectRelease(JSON.parse(await readBounded(response, 1024 * 1024)), state.currentVersion);
        if (!current()) return;
        update({ lastCheckedAt: new Date(now()).toISOString() });
        if (!release) { idleStatus(ready ? undefined : '当前已是最新正式版本。'); return; }
        if (ready && compareVersions(release.version, ready.version) <= 0) { idleStatus(); return; }
        const manifest = await fetchTrusted(fetchImpl, release.manifestUrl, activeController.signal, state.currentVersion);
        const record = parseUpdateManifest(await readBounded(manifest, 65536), release);
        if (!current()) return;
        const installer = await fetchTrusted(fetchImpl, record.url, activeController.signal, state.currentVersion);
        if (!current()) { await installer.body?.cancel?.(); return; }
        update({ phase: 'downloading', version: record.version, progress: 0, message: '正在下载更新，完成后将在正常退出时安装。' });
        await saveDownload(record, installer, activeController.signal, current);
      } catch (error) {
        if (current()) {
          const message = activeController.signal.aborted ? '更新请求超时，稍后将自动重试。' : error.message || '更新失败，稍后将自动重试。';
          if (ready) idleStatus(`${message} 已下载的 ${ready.version} 仍将在正常退出后安装。`);
          else update({ phase: 'error', progress: undefined, message });
        }
      }
    }).finally(() => { cancel(timeout); activeController.abort(); if (flight === pending) flight = null; if (controller === activeController) controller = null; });
    flight = pending; return pending;
  }
  function tick() {
    if (stopped || !enabled || !state.available) return Promise.resolve();
    if (nextDueAt > now()) { arm(nextDueAt - now()); return Promise.resolve(); }
    nextDueAt = now() + AUTO_UPDATE_INTERVAL_MS; arm(AUTO_UPDATE_INTERVAL_MS); return check();
  }
  const wake = () => { if (nextDueAt !== null && now() >= nextDueAt) { clearTimer(); void tick(); } };
  function stop() { stopped = true; cancelWork(); powerMonitor?.removeListener?.('resume', wake); return flight || Promise.resolve(); }
  function start() {
    if (started) return started;
    started = Promise.resolve().then(async () => {
      try {
        if (platform !== 'win32' || !app.isPackaged) { update({ enabled: false, message: platform === 'darwin' ? 'macOS 请下载与本机架构一致的新版 DMG，退出应用后替换“应用程序”中的序作工作台。工作区和本地资料会保留。' : '自动更新仅适用于 Windows 正式安装版。' }); return status(); }
        const installation = await maintenance.status();
        if (!installation.available) { update({ message: installation.reason || '当前未检测到有效安装登记。' }); return status(); }
        await fs.mkdir(directory, { recursive: true }); const stat = await fs.lstat(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('自动更新目录无效。');
        enabled = await setting(); confirmedEnabled = enabled; update({ available: true, enabled });
        await restoreReady(); idleStatus(await resultMessage());
        if (!stopped) { powerMonitor?.on?.('resume', wake); nextDueAt = now() + INITIAL_UPDATE_DELAY_MS; arm(INITIAL_UPDATE_DELAY_MS); }
      } catch (error) { enabled = false; update({ enabled: false, phase: 'error', message: error.message || '自动更新初始化失败。' }); }
      return status();
    }); return started;
  }
  async function setEnabled(value) {
    if (typeof value !== 'boolean') throw new TypeError('自动更新设置必须是布尔值。');
    await start(); if (stopped) throw Error('自动更新服务已停止。'); if (!state.available) return status();
    cancelWork(); enabled = value; update({ enabled }); idleStatus(); const revision = generation;
    settingsQueue = settingsQueue.catch(() => undefined).then(async () => { await writeJson(settingsFile, { enabled: value }); confirmedEnabled = value; });
    try {
      await settingsQueue;
      if (revision === generation && enabled) { await restoreReady(); if (revision === generation) { idleStatus(); nextDueAt = now() + INITIAL_UPDATE_DELAY_MS; arm(INITIAL_UPDATE_DELAY_MS); } }
    } catch (error) {
      if (revision === generation) {
        enabled = confirmedEnabled; cancelWork(); update({ enabled, phase: 'error', message: '自动更新设置保存失败，已保留上次确认的设置，请重试。' });
        if (enabled) { nextDueAt = now() + INITIAL_UPDATE_DELAY_MS; arm(INITIAL_UPDATE_DELAY_MS); }
      }
      throw error;
    }
    return status();
  }
  async function install() {
    stop();
    try {
      await settingsQueue;
      if (ending || installed || !state.available || !enabled || !ready || !await setting()) return false;
      if (!Number.isFinite(processStartTime) || processStartTime <= 0) throw Error('无法核验当前进程，已跳过退出更新。');
      if (!(await maintenance.status()).available) throw Error('安装登记校验未通过，已跳过退出更新。');
      const record = await cachedUpdate();
      const installEnabled = await setting();
      if (ending || !enabled || !installEnabled) return false;
      const args = ['--update', '--root', path.dirname(executablePath), '--wait-pid', String(process.pid), '--wait-start', String(processStartTime), '--result', resultFile];
      const child = spawnImpl(path.join(directory, record.filename), args, { detached: true, windowsHide: true, stdio: 'ignore' });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); }); child.unref(); installed = true; return true;
    } catch (error) { update({ phase: 'error', message: error.message || '未能启动自动更新，当前版本可继续使用。' }); return false; }
  }
  function prepareInstall() { if (installed) return Promise.resolve(false); if (installFlight) return installFlight; installFlight = install().finally(() => { installFlight = null; }); return installFlight; }
  return { start, status, setEnabled, prepareInstall, stop, sessionEnding() { ending = true; stop(); } };
}

module.exports = { createAppUpdater, INITIAL_UPDATE_DELAY_MS, AUTO_UPDATE_INTERVAL_MS };
