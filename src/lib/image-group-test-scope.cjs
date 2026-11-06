const { setTimeout: sleep } = require('node:timers/promises');

function createImageGroupTestScope(testSignal) {
  const controller = new AbortController(), fixtures = new Set(), pending = new Set();
  const check = () => controller.signal.throwIfAborted();
  const abort = () => controller.abort(testSignal.reason);
  testSignal.addEventListener('abort', abort, { once: true });
  if (testSignal.aborted) abort();

  async function delay(ms) {
    check(); await sleep(ms, undefined, { signal: controller.signal }); check();
  }
  function run(action) {
    check();
    const raw = Promise.resolve().then(() => { check(); return action(); });
    pending.add(raw);
    void raw.then(() => pending.delete(raw), () => pending.delete(raw));
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', onAbort, { once: true });
      const cleanup = () => controller.signal.removeEventListener('abort', onAbort);
      raw.then(value => {
        cleanup();
        try { check(); resolve(value); } catch (error) { reject(error); }
      }, error => { cleanup(); reject(controller.signal.aborted ? controller.signal.reason : error); });
    });
  }
  async function drain() {
    while (pending.size) await Promise.allSettled([...pending]);
  }
  async function until(read, predicate) {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      check(); const value = await run(read); check();
      if (predicate(value)) return value;
      const failed = value?.status === 'paused' && Array.isArray(value.items) ? value.items.find(item => item.status === 'failed') : undefined;
      if (failed) throw Error(failed.error || 'Image group item failed while waiting for the expected state');
      await delay(15);
    }
    check(); throw Error('Image group fixture timeout');
  }
  function gate() {
    check();
    let resolve, reject, settled = false;
    const wait = new Promise((yes, no) => { resolve = yes; reject = no; });
    const onAbort = () => settle(false, controller.signal.reason);
    function settle(success, reason) {
      if (settled) return false;
      settled = true; controller.signal.removeEventListener('abort', onAbort);
      if (success) resolve(); else reject(reason);
      return true;
    }
    controller.signal.addEventListener('abort', onAbort, { once: true });
    void wait.catch(() => undefined); // A gate may be aborted before its consumer starts waiting.
    return { wait, release: () => controller.signal.aborted ? (onAbort(), false) : settle(true) };
  }
  const scope = {
    signal: controller.signal, check, run, drain, until, delay, gate,
    register(fixture) {
      check();
      if (fixture.scope && fixture.scope !== scope) throw Error('Fixture belongs to another image-group test scope');
      fixture.scope = scope; fixtures.add(fixture); return fixture;
    },
    replace(previous, createNext) {
      check();
      if (!fixtures.has(previous)) throw Error('Previous fixture is not registered in this image-group test scope');
      const next = createNext();
      if (next.scope && next.scope !== scope) throw Error('Replacement fixture belongs to another image-group test scope');
      next.scope = scope; fixtures.delete(previous); fixtures.add(next); return next;
    },
    close() {
      testSignal.removeEventListener('abort', abort);
      if (!controller.signal.aborted) controller.abort(Error('Image-group test scope closed'));
      return [...fixtures]; // Keep registration after abort so teardown can still drain every owner.
    },
  };
  return scope;
}

module.exports = { createImageGroupTestScope };
