import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createCloseCoordinator } = require('../../electron/close-coordinator.cjs');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(overrides = {}) {
  const dependencies = {
    getRendererState: vi.fn(async () => ({ blocked: false })),
    getTaskState: vi.fn(async () => ({ running: 0 })),
    drain: vi.fn(async () => undefined),
    confirm: vi.fn(async () => 'cancel'),
    status: vi.fn(),
    finalize: vi.fn(),
    record: vi.fn(async () => undefined),
    ...overrides,
  };
  return { ...dependencies, coordinator: createCloseCoordinator(dependencies) };
}

describe('退出协调器', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('重复退出请求共享同一请求，保存只执行一次', async () => {
    const saving = deferred(), f = fixture({ drain: vi.fn(() => saving.promise) });
    const first = f.coordinator.request('window');
    expect(f.coordinator.isClosing()).toBe(true);
    expect(f.coordinator.request('menu')).toBe(first);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.drain).toHaveBeenCalledTimes(1);
    saving.resolve();
    await first;
    expect(f.finalize).toHaveBeenCalledExactlyOnceWith({ forced: false });
    expect(f.coordinator.request()).toBe(first);
  });

  it.each(['renderer', 'backend'])('%s 不回包会有限时弹出确认，取消不会保存', async source => {
    const never = new Promise(() => undefined);
    const f = fixture({ [source === 'renderer' ? 'getRendererState' : 'getTaskState']: vi.fn(() => never) });
    const request = f.coordinator.request();
    await vi.advanceTimersByTimeAsync(1499);
    expect(f.confirm).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await request;
    expect(f.confirm).toHaveBeenCalledExactlyOnceWith({ kind: 'unresponsive' });
    expect(f.drain).not.toHaveBeenCalled();
    expect(f.finalize).not.toHaveBeenCalled();
    expect(f.coordinator.isClosing()).toBe(false);
    expect(f.status).toHaveBeenLastCalledWith({ phase: 'cancelled' });
  });

  it('renderer 错误后等待会重新检查，退出确认后仍安全保存', async () => {
    const f = fixture({
      getRendererState: vi.fn().mockRejectedValueOnce(new Error('private')).mockResolvedValue({ blocked: true }),
      confirm: vi.fn().mockResolvedValueOnce('wait').mockResolvedValueOnce('exit'),
    });
    await f.coordinator.request();
    expect(f.getRendererState).toHaveBeenCalledTimes(2);
    expect(f.confirm.mock.calls.map(([value]) => value.kind)).toEqual(['unresponsive', 'unsaved']);
    expect(f.drain).toHaveBeenCalledTimes(1);
    expect(f.finalize).toHaveBeenCalledWith({ forced: false });
    expect(JSON.stringify(f.record.mock.calls)).not.toContain('private');
  });

  it('接受无响应风险后仍等待 drain 完成', async () => {
    const saving = deferred(), f = fixture({
      getRendererState: vi.fn(() => new Promise(() => undefined)),
      confirm: vi.fn(async () => 'exit'),
      drain: vi.fn(() => saving.promise),
    });
    const request = f.coordinator.request();
    await vi.advanceTimersByTimeAsync(1500);
    expect(f.drain).toHaveBeenCalledTimes(1);
    expect(f.finalize).not.toHaveBeenCalled();
    saving.resolve();
    await request;
    expect(f.finalize).toHaveBeenCalledWith({ forced: false });
  });

  it.each(['unsaved', 'running'])('%s 取消不进入冻结保存，下次可以再次请求', async kind => {
    const f = fixture(kind === 'unsaved' ? { getRendererState: vi.fn(async () => ({ blocked: true })) } : { getTaskState: vi.fn(async () => ({ running: 2 })) });
    const first = f.coordinator.request();
    await first;
    expect(f.confirm).toHaveBeenCalledWith(kind === 'running' ? { kind, running: 2 } : { kind });
    expect(f.drain).not.toHaveBeenCalled();
    expect(f.coordinator.isClosing()).toBe(false);
    const second = f.coordinator.request();
    expect(second).not.toBe(first);
    await second;
  });

  it('慢保存选择等待不会重复 drain，随后完成正常退出', async () => {
    const saving = deferred(), f = fixture({ drain: vi.fn(() => saving.promise), confirm: vi.fn(async () => 'wait') });
    const request = f.coordinator.request();
    await vi.advanceTimersByTimeAsync(8000);
    expect(f.confirm).toHaveBeenCalledTimes(1);
    expect(f.confirm.mock.calls[0][0].kind).toBe('drain-timeout');
    expect(f.coordinator.isClosing()).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.drain).toHaveBeenCalledTimes(1);
    saving.resolve();
    await request;
    expect(f.finalize).toHaveBeenCalledWith({ forced: false });
  });

  it('超时后只有用户明确强退才跳过永不结束的 drain，日志不阻塞退出', async () => {
    const f = fixture({
      drain: vi.fn(() => new Promise(() => undefined)),
      confirm: vi.fn(async () => 'force'),
      record: vi.fn(() => new Promise(() => undefined)),
    });
    const request = f.coordinator.request();
    await vi.advanceTimersByTimeAsync(7999);
    expect(f.finalize).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await request;
    expect(f.finalize).toHaveBeenCalledExactlyOnceWith({ forced: true });
    expect(f.status).toHaveBeenLastCalledWith({ phase: 'forced' });
  });

  it('保存失败不会自动强退，明确选择等待才重试保存', async () => {
    const decision = deferred(), f = fixture({
      drain: vi.fn().mockRejectedValueOnce(new Error('private')).mockResolvedValueOnce(undefined),
      confirm: vi.fn(() => decision.promise),
    });
    const request = f.coordinator.request();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.confirm).toHaveBeenCalledExactlyOnceWith({ kind: 'drain-error' });
    expect(f.finalize).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20000);
    expect(f.drain).toHaveBeenCalledTimes(1);
    decision.resolve('wait');
    await request;
    expect(f.drain).toHaveBeenCalledTimes(2);
    expect(f.finalize).toHaveBeenCalledExactlyOnceWith({ forced: false });
  });

  it('超时确认仍待用户时 drain 完成会中止旧提示并立即退出', async () => {
    const saving = deferred(), decision = deferred();
    const f = fixture({ drain: vi.fn(() => saving.promise), confirm: vi.fn(() => decision.promise) });
    const request = f.coordinator.request();
    await vi.advanceTimersByTimeAsync(8000);
    const { signal } = f.confirm.mock.calls[0][0];
    expect(signal.aborted).toBe(false);
    expect(f.coordinator.request()).toBe(request);
    expect(f.confirm).toHaveBeenCalledTimes(1);
    saving.resolve();
    await request;
    expect(signal.aborted).toBe(true);
    expect(f.finalize).toHaveBeenCalledExactlyOnceWith({ forced: false });
    decision.resolve('force');
    await vi.advanceTimersByTimeAsync(0);
    expect(f.finalize).toHaveBeenCalledTimes(1);
  });

  it('超时确认打开时 drain 失败会中止旧提示并展示失败确认', async () => {
    const saving = deferred(), timeoutDecision = deferred();
    const f = fixture({
      drain: vi.fn(() => saving.promise),
      confirm: vi.fn().mockImplementationOnce(() => timeoutDecision.promise).mockResolvedValueOnce('force'),
    });
    const request = f.coordinator.request();
    await vi.advanceTimersByTimeAsync(8000);
    const { signal } = f.confirm.mock.calls[0][0];
    saving.reject(new Error('private'));
    await request;
    expect(signal.aborted).toBe(true);
    expect(f.confirm.mock.calls[1][0]).toEqual({ kind: 'drain-error' });
    expect(f.finalize).toHaveBeenCalledExactlyOnceWith({ forced: true });
    timeoutDecision.resolve('wait');
  });

  it('明确强退无响应检查不会等待 drain，日志失败不会泄露异常', async () => {
    const f = fixture({
      getTaskState: vi.fn(async () => { throw new Error('private'); }),
      confirm: vi.fn(async () => 'force'),
      record: vi.fn(async () => { throw new Error('private'); }),
    });
    await f.coordinator.request();
    expect(f.drain).not.toHaveBeenCalled();
    expect(f.finalize).toHaveBeenCalledExactlyOnceWith({ forced: true });
  });

  it('确认失败在冻结前取消，冻结后继续给出失败确认且不自动重试保存', async () => {
    const preflight = fixture({
      getRendererState: vi.fn(async () => ({ blocked: true })),
      confirm: vi.fn(async () => { throw new Error('private'); }),
    });
    await preflight.coordinator.request();
    expect(preflight.coordinator.isClosing()).toBe(false);
    expect(preflight.drain).not.toHaveBeenCalled();

    const frozen = fixture({
      drain: vi.fn(async () => { throw new Error('private'); }),
      confirm: vi.fn().mockRejectedValueOnce(new Error('private')).mockResolvedValueOnce('force'),
    });
    const request = frozen.coordinator.request();
    await vi.advanceTimersByTimeAsync(0);
    expect(frozen.coordinator.isClosing()).toBe(true);
    expect(frozen.drain).toHaveBeenCalledTimes(1);
    expect(frozen.finalize).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(8000);
    await request;
    expect(frozen.drain).toHaveBeenCalledTimes(1);
    expect(frozen.finalize).toHaveBeenCalledExactlyOnceWith({ forced: true });
  });
});
