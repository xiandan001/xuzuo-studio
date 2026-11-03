function createCloseCoordinator({ getRendererState, getTaskState, drain, confirm, status, finalize, record, stateTimeoutMs = 1500, drainTimeoutMs = 8000 }) {
  let active = null, closing = false, frozen = false, finished = false;

  function note(event) {
    try { void Promise.resolve(record?.(event)).catch(() => undefined); } catch {}
  }

  function phase(value, message) {
    status({ phase: value, ...(message ? { message } : {}) });
    note({ type: 'phase', phase: value });
  }

  function boundedState(read, source) {
    return new Promise(resolve => {
      let settled = false;
      const complete = result => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => {
        note({ type: 'state-timeout', source });
        complete({ available: false });
      }, stateTimeoutMs);
      Promise.resolve().then(read).then(value => complete({ available: true, value }), () => {
        note({ type: 'state-error', source });
        complete({ available: false });
      });
    });
  }

  async function ask(kind, detail = {}) {
    phase('waiting');
    try {
      const choice = await confirm({ kind, ...detail });
      note({ type: 'confirmation', kind, choice });
      return choice;
    } catch { note({ type: 'confirmation-error', kind }); }
  }

  function finish(forced) {
    if (finished) return;
    finished = true;
    phase(forced ? 'forced' : 'done');
    note({ type: 'finalized', forced });
    finalize({ forced });
    return { forced };
  }

  function cancel() {
    closing = false;
    phase('cancelled');
    return { cancelled: true };
  }

  async function checkState() {
    while (true) {
      phase('checking');
      const [renderer, tasks] = await Promise.all([
        boundedState(getRendererState, 'renderer'),
        boundedState(getTaskState, 'backend'),
      ]);
      if (!renderer.available || !tasks.available) {
        const choice = await ask('unresponsive');
        if (choice === 'force') return 'force';
        if (choice === 'wait') continue;
        if (choice !== 'exit') return 'cancel';
      }
      if (renderer.available && renderer.value.blocked) {
        const choice = await ask('unsaved');
        if (choice !== 'exit') return 'cancel';
      }
      if (tasks.available && tasks.value.running > 0) {
        const choice = await ask('running', { running: tasks.value.running });
        if (choice !== 'exit') return 'cancel';
      }
      return 'exit';
    }
  }

  function startDrain() {
    const operation = { outcome: null, promise: null };
    operation.promise = Promise.resolve().then(drain).then(
      () => (operation.outcome = { kind: 'done' }),
      () => {
        note({ type: 'drain-error' });
        return (operation.outcome = { kind: 'error' });
      },
    );
    return operation;
  }

  async function waitForDrain(operation) {
    let timer;
    try {
      return await Promise.race([
        operation.promise,
        new Promise(resolve => { timer = setTimeout(() => resolve({ kind: 'timeout' }), drainTimeoutMs); }),
      ]);
    } finally { clearTimeout(timer); }
  }

  async function askWhileDraining(operation) {
    if (operation.outcome) return operation.outcome;
    const controller = new AbortController();
    try {
      return await Promise.race([
        operation.promise,
        ask('drain-timeout', { signal: controller.signal }).then(choice => ({ kind: 'choice', choice })),
      ]);
    } finally { controller.abort(); }
  }

  async function save() {
    frozen = true;
    phase('saving');
    let operation = startDrain();
    while (true) {
      let outcome = await waitForDrain(operation);
      if (outcome.kind === 'timeout') outcome = await askWhileDraining(operation);
      if (outcome.kind === 'done') return finish(false);
      if (outcome.kind === 'choice') {
        if (outcome.choice === 'force') return finish(true);
        phase('waiting', '正在等待保存完成。');
        continue;
      }
      const choice = await ask('drain-error');
      if (choice === 'force') return finish(true);
      if (choice === 'wait') {
        phase('saving');
        operation = startDrain();
      } else await new Promise(resolve => setTimeout(resolve, drainTimeoutMs));
    }
  }

  async function run() {
    const choice = await checkState();
    if (choice === 'cancel') return cancel();
    if (choice === 'force') return finish(true);
    return save();
  }

  function request() {
    if (active) return active;
    closing = true;
    note({ type: 'requested' });
    active = Promise.resolve().then(run).finally(() => {
      if (!frozen && !finished) active = null;
    });
    return active;
  }

  return { request, isClosing: () => closing };
}

module.exports = { createCloseCoordinator };
