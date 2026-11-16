export function createLivePolling(poll: () => Promise<void>, active: () => boolean, hidden: () => boolean) {
  let stopped = false, pending = false, wakeAgain = false, timer: ReturnType<typeof setTimeout> | undefined;
  async function read() {
    if (stopped) return;
    if (pending) { wakeAgain = true; return; }
    pending = true;
    try { await poll(); }
    finally {
      pending = false;
      if (!stopped) {
        clearTimeout(timer);
        const delay = wakeAgain ? 0 : active() ? hidden() ? 2500 : 900 : 15000;
        wakeAgain = false;
        timer = setTimeout(() => { void read(); }, delay);
      }
    }
  }
  return {
    wake() { clearTimeout(timer); void read(); },
    stop() { stopped = true; clearTimeout(timer); },
  };
}
