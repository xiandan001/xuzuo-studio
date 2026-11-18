const PRIORITY = { interactive: 0, normal: 1, background: 2 };
const BACKGROUND = new Set(['office', 'delivery-preflight', 'image-alpha', 'commerce-compose', 'wallpaper', 'engineering', 'business-listing-zip', 'bead-export', 'bead-bundle']);
const INTERACTIVE = new Set(['commerce-preview', 'reference-text']);
const cancelled = () => Object.assign(Error('后台处理已取消，原文件与费用保留。'), { name: 'AbortError' });

function createCpuTaskScheduler(execute, { now = Date.now } = {}) {
  const pending = [], recent = [], drains = new Set();
  let active, timer, lowResource = false, lastInteraction = -Infinity, sequence = 0, interactiveStreak = 0;
  function clearTimer() { if (timer) clearTimeout(timer); timer = undefined; }
  function sample(job, outcome, started = now()) {
    recent.push({ task: job.task, priority: job.priority, queueMs: Math.max(0, started - job.queued), runMs: Math.max(0, now() - started), outcome });
    if (recent.length > 20) recent.shift();
  }
  function notifyDrained() {
    if (active || pending.length) return;
    for (const resolve of drains) resolve();
    drains.clear();
  }
  function pump() {
    clearTimer();
    if (active || !pending.length) { notifyDrained(); return; }
    pending.sort((a, b) => PRIORITY[a.priority] - PRIORITY[b.priority] || a.id - b.id);
    const aged = interactiveStreak >= 4 ? pending.findIndex(job => job.priority !== 'interactive' && now() - job.queued >= 4000) : -1;
    const index = aged < 0 ? 0 : aged, job = pending[index];
    const wait = lowResource && job.priority === 'background' ? Math.min(lastInteraction + 1000, job.queued + 4000) - now() : 0;
    if (wait > 0) { timer = setTimeout(pump, wait); return; }
    pending.splice(index, 1); job.signal?.removeEventListener('abort', job.abort);
    active = job; const started = now();
    interactiveStreak = job.priority === 'interactive' ? interactiveStreak + 1 : 0;
    Promise.resolve().then(() => execute(job.task, job.input, { ...job.options, signal: job.signal })).then(
      result => { sample(job, 'complete', started); job.resolve(result); },
      error => { sample(job, error?.name === 'AbortError' ? 'cancelled' : 'failed', started); job.reject(error); },
    ).finally(() => { active = undefined; pump(); });
  }
  function run(task, input, options = {}) {
    if (options.priority !== undefined && !Object.hasOwn(PRIORITY, options.priority)) return Promise.reject(Error('后台处理优先级无效。'));
    if (options.signal?.aborted) return Promise.reject(cancelled());
    const priority = options.priority || (INTERACTIVE.has(task) ? 'interactive' : BACKGROUND.has(task) ? 'background' : 'normal');
    return new Promise((resolve, reject) => {
      const job = { id: ++sequence, task, input, options, priority, queued: now(), signal: options.signal, resolve, reject };
      job.abort = () => {
        const index = pending.indexOf(job);
        if (index < 0) return;
        pending.splice(index, 1); job.signal.removeEventListener('abort', job.abort); sample(job, 'cancelled'); reject(cancelled()); pump();
      };
      job.signal?.addEventListener('abort', job.abort, { once: true }); pending.push(job); pump();
    });
  }
  return {
    run,
    drain: () => !active && !pending.length ? Promise.resolve() : new Promise(resolve => drains.add(resolve)),
    setLowResource(value) { lowResource = value === true; pump(); },
    noteInteraction() { lastInteraction = now(); if (lowResource) pump(); },
    isIdle({ quietMs = 1000 } = {}) { return !active && !pending.length && now() - lastInteraction >= quietMs; },
    async waitForBackground({ signal } = {}) {
      while (lowResource && now() - lastInteraction < 1000) {
        if (signal?.aborted) throw cancelled();
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (signal?.aborted) throw cancelled();
    },
    snapshot() { return { lowResource, pending: pending.length, ...(active ? { running: { task: active.task, priority: active.priority } } : {}), recent: recent.map(item => ({ ...item })) }; },
  };
}
module.exports = { createCpuTaskScheduler };
