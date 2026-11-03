import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
const { createAppUpdater, INITIAL_UPDATE_DELAY_MS, AUTO_UPDATE_INTERVAL_MS } = createRequire(import.meta.url)('../../electron/app-updater.cjs');
const roots = [], services = [];
const bytes = Buffer.from('a verified installer fixture');
const sha512 = createHash('sha512').update(bytes).digest('base64');
const filename = 'Xuzuo-Studio-Setup-1.1.0.exe';
const assetBase = 'https://github.com/xiandan001/xuzuo-studio/releases/download/v1.1.0/';
const release = { tag_name: 'v1.1.0', assets: [{ name: 'latest.yml', browser_download_url: `${assetBase}latest.yml` }, { name: filename, browser_download_url: assetBase + filename, size: bytes.length }] };
const metadata = { version: '1.1.0', files: [{ url: filename, sha512, size: bytes.length }] };

async function fixture(overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-updater-')); roots.push(root);
  const calls = [], states = [], powerMonitor = new EventEmitter(), spawnImpl = vi.fn(() => { const child = new EventEmitter(); child.unref = vi.fn(); queueMicrotask(() => child.emit('spawn')); return child; });
  const fetchImpl = vi.fn(async url => { calls.push(String(url)); if (String(url).includes('api.github.com')) return Response.json([release]); if (String(url).endsWith('latest.yml')) return Response.json(metadata); return new Response(bytes); });
  const options = { app: { isPackaged: true, getPath: () => root, getVersion: () => '1.0.0' }, maintenance: { status: async () => ({ available: true }) }, platform: 'win32', executablePath: path.join(root, 'installed', 'app.exe'), processStartTime: 123456, powerMonitor, fetchImpl, spawnImpl, onStatus: value => states.push(value), ...overrides };
  const updater = createAppUpdater(options); services.push(updater);
  return { root, calls, states, spawnImpl, powerMonitor, options, updater };
}
async function reach(updater, phase) {
  await vi.waitFor(() => expect(updater.status().phase).toBe(phase), { timeout: 3000, interval: 10 });
}
async function download(f) { await f.updater.start(); await vi.advanceTimersByTimeAsync(INITIAL_UPDATE_DELAY_MS); await reach(f.updater, 'ready'); }
afterEach(async () => {
  for (const service of services.splice(0)) await service.stop(); vi.useRealTimers();
  for (const root of roots.splice(0)) { if (!root.startsWith(path.join(os.tmpdir(), 'xuzuo-updater-'))) throw Error('Unexpected test root'); await fs.rm(root, { recursive: true, force: true }); }
});

it('checks after startup and every two hours, catching overdue checks on resume without overlap', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const fetchImpl = vi.fn(async () => Response.json([])); const f = await fixture({ fetchImpl }); await f.updater.start();
  await vi.advanceTimersByTimeAsync(INITIAL_UPDATE_DELAY_MS - 1); expect(fetchImpl).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); await reach(f.updater, 'idle'); expect(fetchImpl).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(AUTO_UPDATE_INTERVAL_MS); await reach(f.updater, 'idle'); expect(fetchImpl).toHaveBeenCalledTimes(2);
  vi.setSystemTime(Date.now() + AUTO_UPDATE_INTERVAL_MS + 1); f.powerMonitor.emit('resume'); f.powerMonitor.emit('resume'); await reach(f.updater, 'idle'); expect(fetchImpl).toHaveBeenCalledTimes(3);
});
it('streams, verifies and reuses a complete cached update, then launches only after the explicit exit handoff', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }); const f = await fixture(); await download(f);
  expect(f.updater.status()).toMatchObject({ available: true, enabled: true, version: '1.1.0', progress: 100 }); expect(f.spawnImpl).not.toHaveBeenCalled();
  f.updater.stop(); const restored = createAppUpdater(f.options); services.push(restored); await restored.start(); expect(restored.status().phase).toBe('ready');
  expect(await restored.prepareInstall()).toBe(true); expect(f.spawnImpl).toHaveBeenCalledTimes(1);
  expect(f.spawnImpl.mock.calls[0]).toEqual([path.join(f.root, 'updates', filename), ['--update', '--root', path.join(f.root, 'installed'), '--wait-pid', String(process.pid), '--wait-start', '123456', '--result', path.join(f.root, 'updates', 'result.json')], { detached: true, windowsHide: true, stdio: 'ignore' }]);
  expect(await restored.prepareInstall()).toBe(false);
});
it('persists opt-out and prohibits a ready update until explicitly enabled again', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }); const f = await fixture(); await download(f); await f.updater.setEnabled(false);
  expect(f.updater.status().phase).toBe('disabled'); expect(await f.updater.prepareInstall()).toBe(false); expect(f.spawnImpl).not.toHaveBeenCalled();
  const restored = createAppUpdater(f.options); services.push(restored); await restored.start(); expect(restored.status()).toMatchObject({ enabled: false, phase: 'disabled' });
  await vi.advanceTimersByTimeAsync(AUTO_UPDATE_INTERVAL_MS); expect(f.calls.length).toBe(3);
  await restored.setEnabled(true); expect(restored.status().phase).toBe('ready');
});
it('rejects corrupted downloads, and revalidates cached bytes before spawning', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }); const f = await fixture(); await download(f);
  await fs.writeFile(path.join(f.root, 'updates', filename), 'corrupted'); expect(await f.updater.prepareInstall()).toBe(false); expect(f.spawnImpl).not.toHaveBeenCalled();
  const broken = await fixture({ fetchImpl: async url => String(url).includes('api.github.com') ? Response.json([release]) : String(url).endsWith('latest.yml') ? Response.json(metadata) : new Response(Buffer.alloc(bytes.length)) });
  await broken.updater.start(); await vi.advanceTimersByTimeAsync(INITIAL_UPDATE_DELAY_MS); await reach(broken.updater, 'error');
  await expect(fs.stat(path.join(broken.root, 'updates', 'ready.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});
it('cancels in-flight work when disabled and never registers a late completed package', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }); let downloadSignal;
  const f = await fixture({ fetchImpl: async (url, options) => {
    if (String(url).includes('api.github.com')) return Response.json([release]);
    if (String(url).endsWith('latest.yml')) return Response.json(metadata);
    downloadSignal = options.signal;
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.subarray(0, 2)); options.signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true }); } }));
  } });
  await f.updater.start(); await vi.advanceTimersByTimeAsync(INITIAL_UPDATE_DELAY_MS); await reach(f.updater, 'downloading'); await f.updater.setEnabled(false);
  expect(downloadSignal.aborted).toBe(true); expect(await f.updater.prepareInstall()).toBe(false); expect(f.updater.status().phase).toBe('disabled');
});
it('does not fetch or install development, unregistered, or session-ending instances', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  for (const overrides of [{ platform: 'validation' }, { app: { isPackaged: false, getPath: () => '', getVersion: () => '1.0.0' } }, { maintenance: { status: async () => ({ available: false, reason: 'Not installed' }) } }]) {
    const f = await fixture(overrides); await f.updater.start(); await vi.advanceTimersByTimeAsync(AUTO_UPDATE_INTERVAL_MS); expect(f.calls).toEqual([]); expect(f.updater.status().available).toBe(false);
  }
  const f = await fixture(); await download(f); f.updater.sessionEnding(); expect(await f.updater.prepareInstall()).toBe(false); expect(f.spawnImpl).not.toHaveBeenCalled();
});
it('rejects foreign download redirects without requesting them', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const fetchImpl = vi.fn(async url => String(url).includes('api.github.com') ? Response.json([release]) : new Response(null, { status: 302, headers: { location: 'https://foreign.test/update.exe' } }));
  const f = await fixture({ fetchImpl }); await f.updater.start(); await vi.advanceTimersByTimeAsync(INITIAL_UPDATE_DELAY_MS); await reach(f.updater, 'error');
  expect(fetchImpl).toHaveBeenCalledTimes(2); expect(await f.updater.prepareInstall()).toBe(false);
});
it('recovers from a failed check at the next regular deadline', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const fetchImpl = vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce(Response.json([]));
  const f = await fixture({ fetchImpl }); await f.updater.start(); await vi.advanceTimersByTimeAsync(INITIAL_UPDATE_DELAY_MS); await reach(f.updater, 'error');
  await vi.advanceTimersByTimeAsync(AUTO_UPDATE_INTERVAL_MS); await reach(f.updater, 'idle'); expect(fetchImpl).toHaveBeenCalledTimes(2);
});
it('fails closed for corrupted preferences and rechecks opt-out, registration and process identity before exit', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const invalid = await fixture(); await fs.mkdir(path.join(invalid.root, 'updates')); await fs.writeFile(path.join(invalid.root, 'updates', 'settings.json'), '{broken');
  await invalid.updater.start(); expect(invalid.updater.status()).toMatchObject({ enabled: false, phase: 'error' }); expect(invalid.calls).toEqual([]);
  for (const change of ['settings', 'registration', 'process']) {
    const f = await fixture(change === 'process' ? { processStartTime: null } : {}); await download(f);
    if (change === 'settings') await fs.writeFile(path.join(f.root, 'updates', 'settings.json'), JSON.stringify({ enabled: false }));
    if (change === 'registration') f.options.maintenance.status = async () => ({ available: false });
    expect(await f.updater.prepareInstall()).toBe(false); expect(f.spawnImpl).not.toHaveBeenCalled();
  }
});
it('rejects truncated and oversized responses and removes partial files', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  for (const body of [bytes.subarray(0, 3), Buffer.concat([bytes, bytes])]) {
    const f = await fixture({ fetchImpl: async url => String(url).includes('api.github.com') ? Response.json([release]) : String(url).endsWith('latest.yml') ? Response.json(metadata) : new Response(body) });
    await f.updater.start(); await vi.advanceTimersByTimeAsync(INITIAL_UPDATE_DELAY_MS); await reach(f.updater, 'error'); await f.updater.stop();
    const names = await fs.readdir(path.join(f.root, 'updates')); expect(names.some(name => name.endsWith('.part') || name === 'ready.json')).toBe(false);
  }
});

it('does not start an installer if the session ends during the last preference read', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const f = await fixture(); await download(f);
  await fs.writeFile(path.join(f.root, 'updates', 'settings.json'), JSON.stringify({ enabled: true }));
  const original = fs.readFile; let reads = 0;
  const read = vi.spyOn(fs, 'readFile').mockImplementation(async (...args) => {
    if (String(args[0]).endsWith('settings.json') && ++reads === 2) f.updater.sessionEnding();
    return original(...args);
  });
  try { expect(await f.updater.prepareInstall()).toBe(false); expect(f.spawnImpl).not.toHaveBeenCalled(); }
  finally { read.mockRestore(); }
});
it('keeps checking with a ready package, avoids downloading it twice and replaces it with a newer release', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }); const f = await fixture(); await download(f);
  await vi.advanceTimersByTimeAsync(AUTO_UPDATE_INTERVAL_MS); await reach(f.updater, 'ready'); expect(f.calls).toHaveLength(4);
  const newerName = 'Xuzuo-Studio-Setup-1.2.0.exe', newerBase = assetBase.replace('v1.1.0', 'v1.2.0');
  f.options.fetchImpl.mockImplementation(async url => {
    if (String(url).includes('api.github.com')) return Response.json([{ tag_name: 'v1.2.0', assets: [{ name: 'latest.yml', browser_download_url: newerBase + 'latest.yml' }, { name: newerName, browser_download_url: newerBase + newerName, size: bytes.length }] }]);
    if (String(url).endsWith('latest.yml')) return Response.json({ version: '1.2.0', files: [{ url: newerName, size: bytes.length, sha512 }] });
    return new Response(bytes);
  });
  await vi.advanceTimersByTimeAsync(AUTO_UPDATE_INTERVAL_MS); await vi.waitFor(() => expect(f.updater.status()).toMatchObject({ phase: 'ready', version: '1.2.0' }));
  await expect(fs.stat(path.join(f.root, 'updates', filename))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(JSON.parse(await fs.readFile(path.join(f.root, 'updates', 'ready.json'), 'utf8')).version).toBe('1.2.0');
});
it('retains a verified ready package if downloading a later version fails', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }); const f = await fixture(); await download(f);
  const newerName = 'Xuzuo-Studio-Setup-1.2.0.exe', newerBase = assetBase.replace('v1.1.0', 'v1.2.0');
  f.options.fetchImpl.mockImplementation(async url => {
    if (String(url).includes('api.github.com')) return Response.json([{ tag_name: 'v1.2.0', assets: [{ name: 'latest.yml', browser_download_url: newerBase + 'latest.yml' }, { name: newerName, browser_download_url: newerBase + newerName, size: bytes.length }] }]);
    if (String(url).endsWith('latest.yml')) return Response.json({ version: '1.2.0', files: [{ url: newerName, size: bytes.length, sha512 }] });
    return new Response('broken');
  });
  await vi.advanceTimersByTimeAsync(AUTO_UPDATE_INTERVAL_MS); await vi.waitFor(() => expect(f.updater.status()).toMatchObject({ phase: 'ready', version: '1.1.0' }));
  expect(f.updater.status().message).toContain('仍将在正常退出后安装'); expect(await f.updater.prepareInstall()).toBe(true);
  expect(f.spawnImpl.mock.calls[0][0]).toBe(path.join(f.root, 'updates', filename));
});
it('restores the last confirmed setting if writing the new preference fails', async () => {
  const f = await fixture(); await f.updater.start(); await fs.mkdir(path.join(f.root, 'updates', 'settings.json'));
  await expect(f.updater.setEnabled(false)).rejects.toBeDefined(); expect(f.updater.status()).toMatchObject({ enabled: true, phase: 'error' });
  expect(f.updater.status().message).toContain('保留上次确认');
});
