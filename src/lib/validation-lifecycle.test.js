import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { readValidationOwner, startValidationLifecycle, MARKER } = require('../../electron/validation-lifecycle.cjs');
afterEach(() => vi.useRealTimers());
it('只有完整的独立测试标记可启用自动清理，不接管正常目录', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xuzuo-validation-owner-'));
  expect(readValidationOwner(directory)).toBeNull();
  fs.writeFileSync(path.join(directory, MARKER), JSON.stringify({ version: 1, kind: 'xuzuo-owned-validation', directory, ownerPid: process.pid }));
  expect(readValidationOwner(directory)).toMatchObject({ ownerPid: process.pid, maxAgeMs: 600000 });
  fs.writeFileSync(path.join(directory, MARKER), JSON.stringify({ version: 1, kind: 'xuzuo-owned-validation', directory: os.tmpdir(), ownerPid: process.pid }));
  expect(readValidationOwner(directory)).toBeNull();
});
it('测试父进程消失后只发起一次关闭，关闭不回应时限定时间强退', async () => {
  vi.useFakeTimers(); const requestExit = vi.fn(() => new Promise(() => {})), forceExit = vi.fn();
  const stop = startValidationLifecycle({ ownerPid: 42, isAlive: () => false, requestExit, forceExit, pollMs: 20, closeTimeoutMs: 50 });
  await vi.advanceTimersByTimeAsync(20); expect(requestExit).toHaveBeenCalledTimes(1); expect(forceExit).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(50); expect(forceExit).toHaveBeenCalledTimes(1); stop();
});
it('测试父进程还在且未超时不会关闭', async () => {
  vi.useFakeTimers(); const requestExit = vi.fn(), forceExit = vi.fn();
  const stop = startValidationLifecycle({ ownerPid: 42, isAlive: () => true, requestExit, forceExit, maxAgeMs: 1000, pollMs: 20 });
  await vi.advanceTimersByTimeAsync(900); expect(requestExit).not.toHaveBeenCalled(); expect(forceExit).not.toHaveBeenCalled(); stop();
});
it('测试最长生命周期到期时清理，不能遗留无人管理的窗口', async () => {
  vi.useFakeTimers(); const requestExit = vi.fn(() => new Promise(() => {})), forceExit = vi.fn();
  const stop = startValidationLifecycle({ ownerPid: 42, isAlive: () => true, requestExit, forceExit, maxAgeMs: 100, pollMs: 20, closeTimeoutMs: 50 });
  await vi.advanceTimersByTimeAsync(100); expect(requestExit).toHaveBeenCalledTimes(1); await vi.advanceTimersByTimeAsync(50); expect(forceExit).toHaveBeenCalledTimes(1); stop();
});
it('清理监听取消后不再触发关闭或强退', async () => {
  vi.useFakeTimers(); const requestExit = vi.fn(), forceExit = vi.fn();
  const stop = startValidationLifecycle({ ownerPid: 42, isAlive: () => false, requestExit, forceExit, pollMs: 20 }); stop();
  await vi.advanceTimersByTimeAsync(10000); expect(requestExit).not.toHaveBeenCalled(); expect(forceExit).not.toHaveBeenCalled();
});
