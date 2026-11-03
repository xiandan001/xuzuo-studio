function createAutomaticBilling({ needsRecalculation, recalculate, intervalMs = 60000, clock = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, onError = () => undefined }) {
  let stopped = false, started = false, timer, pending, controller, lastAttempt;
  function schedule() {
    if (stopped || !started) return;
    clearTimer(timer); timer = setTimer(() => { void trigger(); }, intervalMs); timer.unref?.();
  }
  function trigger() {
    if (stopped) return Promise.resolve();
    if (pending) return pending;
    if (lastAttempt !== undefined && clock() - lastAttempt < intervalMs) return Promise.resolve();
    lastAttempt = clock(); controller = new AbortController();
    pending = Promise.resolve().then(async () => {
      if (stopped) return;
      const needed = await needsRecalculation();
      if (!stopped && needed) await recalculate({ pendingOnly: true, signal: controller.signal });
    }).catch(error => { if (!stopped) onError(error); }).finally(() => { pending = undefined; controller = undefined; schedule(); });
    return pending;
  }
  return {
    start() { if (started || stopped) return; started = true; void trigger(); },
    trigger,
    async stop() { stopped = true; clearTimer(timer); controller?.abort(); await pending; },
  };
}
function pendingBilling(entries) {
  return entries.some(entry => entry.billingMode === 'live' && entry.status !== 'processing' && !entry.queryOnly && entry.usage && (entry.costState === 'unknown' || entry.costState === 'calculated' && entry.calculation?.nativeCurrency === 'USD' && entry.calculation.cnyAmount === undefined));
}
module.exports = { createAutomaticBilling, pendingBilling };
