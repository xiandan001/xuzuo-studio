import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { createAutomaticBilling, pendingBilling } = require('../../electron/automatic-billing.cjs');
afterEach(() => vi.useRealTimers());

describe('native automatic billing', () => {
  it('runs immediately and retries after a bounded interval, with single-flight focus triggers', async () => {
    vi.useFakeTimers(); let finish!: () => void, calls = 0;
    const service = createAutomaticBilling({ needsRecalculation: async () => true, recalculate: async (options: { pendingOnly: boolean; signal: AbortSignal }) => { calls++; expect(options.pendingOnly).toBe(true); await new Promise<void>(resolve => { finish = resolve; }); } });
    service.start(); await vi.advanceTimersByTimeAsync(0); expect(calls).toBe(1);
    const first = service.trigger(), second = service.trigger(); expect(first).toBe(second); finish(); await first;
    await service.trigger(); expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(60000); expect(calls).toBe(2); finish(); await service.trigger();
    await service.stop(); await vi.advanceTimersByTimeAsync(180000); expect(calls).toBe(2);
  });
  it('does no network-style work when every charge is already calculated', async () => {
    vi.useFakeTimers(); const recalculate = vi.fn();
    const service = createAutomaticBilling({ needsRecalculation: async () => false, recalculate });
    service.start(); await vi.advanceTimersByTimeAsync(120000); expect(recalculate).not.toHaveBeenCalled(); await service.stop();
  });
  it('retries failure without an unhandled rejection and aborts active work on shutdown', async () => {
    vi.useFakeTimers(); let calls = 0, aborted = false; const onError = vi.fn();
    const service = createAutomaticBilling({ needsRecalculation: async () => true, onError, recalculate: async ({ signal }: { signal: AbortSignal }) => {
      if (++calls === 1) throw new Error('temporary failure');
      await new Promise<void>(resolve => signal.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true }));
    } });
    service.start(); await vi.advanceTimersByTimeAsync(0); expect(onError).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60000); expect(calls).toBe(2); await service.stop(); expect(aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(180000); expect(calls).toBe(2);
  });
  it('does not start reconciliation after closing while the pending check is reading', async () => {
    let finish!: (needed: boolean) => void; const recalculate = vi.fn();
    const service = createAutomaticBilling({ needsRecalculation: () => new Promise<boolean>(resolve => { finish = resolve; }), recalculate });
    service.start(); await Promise.resolve(); const stopped = service.stop(); finish(true); await stopped;
    expect(recalculate).not.toHaveBeenCalled();
  });
  it('selects actual unresolved charges, not ordinary in-progress or free work', () => {
    const base = { billingMode: 'live', status: 'complete', costState: 'unknown', usage: { inputTokens: 10 } };
    expect(pendingBilling([base])).toBe(true);
    for (const changes of [{ status: 'processing' }, { queryOnly: true }, { usage: undefined }, { costState: 'manual' }, { costState: 'not-incurred' }]) expect(pendingBilling([{ ...base, ...changes }])).toBe(false);
    expect(pendingBilling([{ ...base, costState: 'calculated', calculation: { nativeCurrency: 'USD', nativeAmount: '0.01' } }])).toBe(true);
    expect(pendingBilling([{ ...base, costState: 'calculated', calculation: { nativeCurrency: 'USD', nativeAmount: '0.01', cnyAmount: '0.06' } }])).toBe(false);
  });
});
