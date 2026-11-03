function createOperationTracker() {
  const pending = new Set();
  function track(action) {
    const task = Promise.resolve().then(action);
    pending.add(task);
    void task.finally(() => pending.delete(task)).catch(() => undefined);
    return task;
  }
  async function drain() {
    while (pending.size) await Promise.allSettled([...pending]);
  }
  return { track, drain, flush: drain };
}
function createSerialQueue() {
  const queues = new Map(), operations = createOperationTracker();
  function run(id, action) {
    return operations.track(() => {
      const previous = queues.get(id) || Promise.resolve();
      const task = previous.catch(() => undefined).then(action);
      queues.set(id, task);
      void task.finally(() => { if (queues.get(id) === task) queues.delete(id); }).catch(() => undefined);
      return task;
    });
  }
  return { run, drain: operations.drain, flush: operations.flush };
}
module.exports = { createOperationTracker, createSerialQueue };
