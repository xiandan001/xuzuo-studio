import { expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const { createDialogLocations, readLocalDrives } = createRequire(import.meta.url)('../../electron/dialog-locations.cjs');
const app = { getPath: key => `C:\\Users\\fixture\\${key}` };
const drive = (letter, removable = false) => ({ name: `${removable ? '可移动磁盘' : '本地磁盘'} (${letter}:)`, path: `${letter}:\\`, kind: 'drive' });
const roots = result => result.locations.filter(item => item.kind === 'drive').map(item => item.path);
const payload = drives => JSON.stringify({ version: 1, drives });

it('prepares a synchronous first screen from known paths without starting discovery', async () => {
  let clock = 0;
  const readDrives = vi.fn().mockResolvedValue([drive('C'), drive('D'), drive('F', true)]);
  const locations = createDialogLocations(app, { readDrives, platform: 'win32', now: () => clock });
  const initial = locations.peek('D:\\project');
  expect(initial.pending).toBe(true); expect(roots(initial)).toEqual(['D:\\', 'C:\\']); expect(initial.warning).toBeUndefined();
  expect(readDrives).not.toHaveBeenCalled(); expect(initial).not.toBeInstanceOf(Promise);
  await locations('D:\\project');
  expect(locations.peek('D:\\project').pending).toBe(false); expect(readDrives).toHaveBeenCalledTimes(1);
  clock = 15000;
  const stale = locations.peek('D:\\project');
  expect(stale.pending).toBe(true); expect(roots(stale)).toEqual(['C:\\', 'D:\\', 'F:\\']); expect(readDrives).toHaveBeenCalledTimes(1);
});

it('does not schedule background work through peek during a failure cooldown', async () => {
  let clock = 0;
  const readDrives = vi.fn().mockRejectedValue(new Error('failure'));
  const locations = createDialogLocations(app, { readDrives, platform: 'win32', now: () => clock });
  await locations('D:\\project');
  const failed = locations.peek('D:\\project');
  expect(failed.pending).toBe(false); expect(failed.warning).toContain('完整磁盘列表'); expect(roots(failed)).toEqual(['D:\\', 'C:\\']);
  clock = 15000; expect(locations.peek('D:\\project').pending).toBe(true); expect(readDrives).toHaveBeenCalledTimes(1);
});

it('runs only the small helper with bounded hidden execution and validates local/removable letters', async () => {
  const controller = new AbortController();
  const execute = vi.fn((_file, _args, _options, callback) => callback(null, '\uFEFF' + payload([
    { letter: 'C', type: 3 }, { letter: 'd', type: 3 }, { letter: 'F', type: 2 },
    { letter: 'Z', type: 4 }, { letter: 'G', type: 5 }, { letter: '\\\\server\\disk', type: 3 },
    { letter: 'D', type: 3 }, { letter: 'H:\\..\\', type: 3 },
  ])));
  await expect(readLocalDrives({ execute, platform: 'win32', signal: controller.signal, helperPath: 'C:/fixture/windows-drive-info.exe' })).resolves.toEqual([drive('C'), drive('D'), drive('F', true)]);
  const [file, args, options] = execute.mock.calls[0];
  expect(file).toBe('C:/fixture/windows-drive-info.exe'); expect(args).toEqual([]);
  expect(options).toMatchObject({ timeout: 4000, windowsHide: true, maxBuffer: 16384, signal: controller.signal });
  expect(file).not.toMatch(/powershell|cmd\.exe/i);
});

it('rejects invalid protocol, empty output and failed helpers', async () => {
  for (const stdout of ['', 'not json', '[]', '{"version":2,"drives":[]}', payload([]), payload([{ letter: 'Z', type: 4 }]), payload(Array.from({ length: 27 }, () => ({ letter: 'C', type: 3 })))]) {
    await expect(readLocalDrives({ execute: (_file, _args, _options, callback) => callback(null, stdout), platform: 'win32' })).rejects.toBeInstanceOf(Error);
  }
  await expect(readLocalDrives({ execute: (_file, _args, _options, callback) => callback(new Error('timeout')), platform: 'win32' })).rejects.toThrow('timeout');
});

it('does not start a child for an already canceled request or a non-Windows filesystem', async () => {
  const execute = vi.fn(), controller = new AbortController(); controller.abort();
  await expect(readLocalDrives({ execute, platform: 'win32', signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  await expect(readLocalDrives({ execute, platform: 'linux' })).resolves.toEqual([{ name: '文件系统', path: '/', kind: 'drive' }]);
  expect(execute).not.toHaveBeenCalled();
});

it('resolves a packaged helper from app.asar.unpacked instead of executing inside the archive', async () => {
  const source = fs.readFileSync(new URL('../../electron/dialog-locations.cjs', import.meta.url), 'utf8');
  const calls = [], target = { exports: {} };
  vm.runInNewContext(source, { __dirname: 'C:/fixture/resources/app.asar/electron', module: target, process: { platform: 'win32' }, require: name => name === 'node:path' ? path.win32 : { execFile: (file, args, options, callback) => { calls.push(file); callback(null, payload([{ letter: 'C', type: 3 }])); } } });
  await target.exports.readLocalDrives();
  expect(calls).toEqual(['C:\\fixture\\resources\\app.asar.unpacked\\assets\\windows-drive-info.exe']);
});

it('caches successful results for fifteen seconds across repeated focus/open requests', async () => {
  let clock = 0;
  const readDrives = vi.fn().mockResolvedValue([drive('C'), drive('D'), drive('F', true)]);
  const locations = createDialogLocations(app, { readDrives, platform: 'win32', now: () => clock });
  for (let count = 0; count < 20; count++) expect(roots(await locations('C:\\fixture'))).toEqual(['C:\\', 'D:\\', 'F:\\']);
  expect(readDrives).toHaveBeenCalledTimes(1);
  clock = 14999; await locations('D:\\fixture'); expect(readDrives).toHaveBeenCalledTimes(1);
  clock = 15000; await locations('D:\\fixture'); expect(readDrives).toHaveBeenCalledTimes(2);
});

it('allows a deliberate manual refresh to discover removed and inserted drives before the cache expires', async () => {
  const readDrives = vi.fn().mockResolvedValueOnce([drive('C'), drive('D'), drive('F', true)]).mockResolvedValueOnce([drive('C'), drive('D'), drive('H', true)]);
  const locations = createDialogLocations(app, { readDrives, platform: 'win32', now: () => 0 });
  await locations('C:\\fixture');
  const refreshed = await locations('C:\\fixture', { force: true });
  expect(roots(refreshed)).toEqual(['C:\\', 'D:\\', 'H:\\']); expect(refreshed.warning).toBeUndefined();
  expect(readDrives).toHaveBeenCalledTimes(2);
});

it('merges overlapping forced and ordinary queries into one child process', async () => {
  let complete;
  const readDrives = vi.fn(() => new Promise(resolve => { complete = resolve; }));
  const locations = createDialogLocations(app, { readDrives, platform: 'win32' });
  const first = locations('C:\\fixture'), second = locations('D:\\fixture', { force: true });
  await Promise.resolve(); expect(readDrives).toHaveBeenCalledTimes(1);
  complete([drive('C'), drive('D')]);
  expect(roots(await first)).toEqual(['C:\\', 'D:\\']); expect(roots(await second)).toEqual(['C:\\', 'D:\\']);
});

it('keeps known disks during failures and imposes a one-second minimum forced retry and normal fifteen-second cooldown', async () => {
  let clock = 0;
  const readDrives = vi.fn().mockResolvedValueOnce([drive('C'), drive('D'), drive('F', true)]).mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce([drive('C'), drive('D')]);
  const locations = createDialogLocations(app, { readDrives, platform: 'win32', now: () => clock });
  await locations('C:\\fixture'); clock = 10;
  const failed = await locations('E:\\Project', { force: true });
  expect(roots(failed)).toEqual(['C:\\', 'D:\\', 'F:\\', 'E:\\']); expect(failed.warning).toContain('刷新重试');
  clock = 1009; await locations('C:\\fixture', { force: true }); expect(readDrives).toHaveBeenCalledTimes(2);
  clock = 1010;
  const recovered = await locations('C:\\fixture', { force: true });
  expect(roots(recovered)).toEqual(['C:\\', 'D:\\']); expect(recovered.warning).toBeUndefined(); expect(readDrives).toHaveBeenCalledTimes(3);
});

it('does not repeatedly spawn during an initial failure and retries after the cooldown', async () => {
  let clock = 0;
  const readDrives = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([drive('C'), drive('D'), drive('F', true)]);
  const locations = createDialogLocations(app, { readDrives, platform: 'win32', now: () => clock });
  const failed = await locations('D:\\Project');
  expect(roots(failed)).toEqual(['D:\\', 'C:\\']); expect(failed.warning).toContain('完整磁盘列表');
  clock = 14999; await locations('D:\\Project'); expect(readDrives).toHaveBeenCalledTimes(1);
  clock = 15000; const recovered = await locations('D:\\Project');
  expect(roots(recovered)).toEqual(['C:\\', 'D:\\', 'F:\\']); expect(recovered.warning).toBeUndefined();
});

it('cancels pending work immediately without caching a warning and ignores a late canceled result', async () => {
  let complete;
  const readDrives = vi.fn().mockImplementationOnce(() => new Promise(resolve => { complete = resolve; })).mockResolvedValueOnce([drive('C'), drive('D')]);
  const locations = createDialogLocations(app, { readDrives, platform: 'win32' });
  const first = locations('C:\\fixture'), rejection = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  await Promise.resolve(); const signal = readDrives.mock.calls[0][0].signal;
  locations.cancelPending(); await rejection; expect(signal.aborted).toBe(true);
  const recovered = await locations('C:\\fixture'); expect(recovered.warning).toBeUndefined();
  complete([drive('F', true)]); await Promise.resolve();
  expect(roots(await locations('C:\\fixture'))).toEqual(['C:\\', 'D:\\']); expect(readDrives).toHaveBeenCalledTimes(2);
});

it('preserves a successful cache when an explicit refresh is canceled', async () => {
  const readDrives = vi.fn().mockResolvedValueOnce([drive('C'), drive('D')]).mockImplementationOnce(() => new Promise(() => {})).mockResolvedValueOnce([drive('C'), drive('D'), drive('F', true)]);
  const locations = createDialogLocations(app, { readDrives, platform: 'win32', now: () => 0 });
  await locations('C:\\fixture'); const pending = locations('C:\\fixture', { force: true }), rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  locations.cancelPending(); await rejection;
  expect(roots(await locations('C:\\fixture'))).toEqual(['C:\\', 'D:\\']); expect(readDrives).toHaveBeenCalledTimes(2);
  expect(roots(await locations('C:\\fixture', { force: true }))).toEqual(['C:\\', 'D:\\', 'F:\\']);
});
