import { afterEach, expect, it, vi } from 'vitest';
import { createLivePolling } from './live-polling';
afterEach(() => vi.useRealTimers());

it('reduces idle work, wakes immediately on a new task, and uses a slower hidden cadence', async () => {
  vi.useFakeTimers(); let active = false, hidden = false;
  const read = vi.fn(async () => undefined), polling = createLivePolling(read, () => active, () => hidden);
  polling.wake(); await vi.advanceTimersByTimeAsync(14999); expect(read).toHaveBeenCalledTimes(1);
  active = true; polling.wake(); await vi.advanceTimersByTimeAsync(899); expect(read).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1); expect(read).toHaveBeenCalledTimes(3);
  hidden = true; polling.wake(); await vi.advanceTimersByTimeAsync(2499); expect(read).toHaveBeenCalledTimes(4);
  await vi.advanceTimersByTimeAsync(1); expect(read).toHaveBeenCalledTimes(5);
  polling.stop(); await vi.advanceTimersByTimeAsync(30000); expect(read).toHaveBeenCalledTimes(5);
});

it('serializes slow reads and retains one wake that arrived while a read was pending', async () => {
  vi.useFakeTimers(); let resolve!: () => void;
  const read = vi.fn().mockImplementationOnce(() => new Promise<void>(done => { resolve = done; })).mockResolvedValue(undefined);
  const polling = createLivePolling(read, () => false, () => false);
  polling.wake(); polling.wake(); polling.wake(); expect(read).toHaveBeenCalledTimes(1);
  resolve(); await vi.advanceTimersByTimeAsync(0); expect(read).toHaveBeenCalledTimes(2);
  polling.stop(); await vi.advanceTimersByTimeAsync(60000); expect(read).toHaveBeenCalledTimes(2);
});
