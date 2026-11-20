const { setTimeout: delay } = require('node:timers/promises');

function createLocalExportRetry(signal, onRetry) {
  let retried = false;
  return async operation => {
    try { return await operation(); }
    catch (error) {
      if (retried || !['EBUSY', 'EAGAIN'].includes(error?.code)) throw error;
      signal.throwIfAborted();
      retried = true;
      onRetry();
      await delay(160, undefined, { signal });
      return operation();
    }
  };
}

module.exports = { createLocalExportRetry };
