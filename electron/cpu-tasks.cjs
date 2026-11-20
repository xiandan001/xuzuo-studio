const { Worker } = require('node:worker_threads');
const path = require('node:path');
const { createCpuTaskScheduler } = require('./cpu-task-scheduler.cjs');

function createCpuTasks({ workerFile = path.join(__dirname, 'cpu-worker.cjs'), timeoutMs = 60000, createWorker = (file, options) => new Worker(file, options) } = {}) {
  function execute(task, input, { signal } = {}) {
    return new Promise((resolve, reject) => {
      const cancelled = () => Object.assign(new Error('后台处理已取消，原文件与费用保留。'), { name: 'AbortError' });
      if (signal?.aborted) { reject(cancelled()); return; }
      let worker;
      try { worker = createWorker(workerFile, { workerData: { task, input } }); }
      catch (error) { reject(error); return; }
      let settled = false;
      const abort = () => finish(cancelled());
      const finish = (error, result) => {
        if (settled) return;
        settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
        Promise.resolve().then(() => worker.terminate()).catch(() => undefined).then(() => { if (error) reject(error); else resolve(result); });
      };
      const timer = setTimeout(() => finish(new Error('后台文件处理超时，原稿保留，请缩小文件后重试。')), timeoutMs);
      worker.once('message', value => finish(value.error ? Object.assign(new Error(value.error), { code: value.code }) : null, value.result));
      worker.once('error', error => finish(new Error(`后台文件处理失败：${error.message}`)));
      worker.once('exit', code => { if (!settled) finish(new Error(`后台文件处理意外退出（${code}），未覆盖原稿。`)); });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
  return createCpuTaskScheduler(execute);
}
module.exports = { createCpuTasks };
