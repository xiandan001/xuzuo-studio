const { Worker } = require('node:worker_threads');
const path = require('node:path');

function createCpuTasks({ workerFile = path.join(__dirname, 'cpu-worker.cjs'), timeoutMs = 60000, createWorker = (file, options) => new Worker(file, options) } = {}) {
  let tail = Promise.resolve();
  function execute(task, input) {
    return new Promise((resolve, reject) => {
      const worker = createWorker(workerFile, { workerData: { task, input } });
      let settled = false;
      const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); void worker.terminate(); if (error) reject(error); else resolve(result); };
      const timer = setTimeout(() => finish(new Error('后台文件处理超时，原稿保留，请缩小文件后重试。')), timeoutMs);
      worker.once('message', value => finish(value.error ? new Error(value.error) : null, value.result));
      worker.once('error', error => finish(new Error(`后台文件处理失败：${error.message}`)));
      worker.once('exit', code => { if (!settled) finish(new Error(`后台文件处理意外退出（${code}），未覆盖原稿。`)); });
    });
  }
  return {
    run(task, input) { const pending = tail.then(() => execute(task, input)); tail = pending.catch(() => undefined); return pending; },
    drain() { return tail; },
  };
}
module.exports = { createCpuTasks };
