import type { SpreadsheetCalculation, SpreadsheetDocument } from '../spreadsheet-types';

export interface SpreadsheetWorkerResponse { id: number; calculation?: SpreadsheetCalculation; error?: string; }
export interface SpreadsheetWorkerPort {
  postMessage: (message: { id: number; document: SpreadsheetDocument }) => void;
  onmessage: ((event: MessageEvent<SpreadsheetWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  terminate: () => void;
}
interface Job { id: number; document: SpreadsheetDocument; resolve: (value: SpreadsheetCalculation) => void; reject: (error: Error) => void; }
export function createSpreadsheetWorkerClient(worker: SpreadsheetWorkerPort) {
  let sequence = 0, running: Job | undefined, queued: Job | undefined, disposed = false, failed: Error | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  const cancelled = () => Object.assign(new Error('计算请求已被更新的内容替代。'), { name: 'AbortError' });
  function fail(error: Error) { failed = error; clearTimeout(timer); running?.reject(error); queued?.reject(error); running = queued = undefined; worker.terminate(); }
  function send(job: Job) { running = job; try { worker.postMessage({ id: job.id, document: job.document }); timer = setTimeout(() => fail(new Error('后台计算超时，当前编辑和上次结果保留。请保存后检查公式范围。')), 20000); } catch (error) { fail(error instanceof Error ? error : new Error('后台计算未能开始。')); } }
  worker.onmessage = ({ data }) => {
    if (disposed || !running || running.id !== data.id) return;
    const done = running; running = undefined; clearTimeout(timer);
    if (data.error || !data.calculation) done.reject(new Error(data.error || '后台计算没有返回结果。')); else done.resolve(data.calculation);
    if (queued) { const next = queued; queued = undefined; send(next); }
  };
  worker.onerror = event => { event.preventDefault(); fail(new Error(event.message || '后台公式计算暂不可用。')); };
  return {
    calculate(document: SpreadsheetDocument) {
      if (disposed || failed) return Promise.reject(failed || cancelled());
      return new Promise<SpreadsheetCalculation>((resolve, reject) => {
        const job = { id: ++sequence, document, resolve, reject };
        if (running) { queued?.reject(cancelled()); queued = job; } else send(job);
      });
    },
    dispose() { disposed = true; clearTimeout(timer); running?.reject(cancelled()); queued?.reject(cancelled()); running = queued = undefined; worker.onmessage = null; worker.onerror = null; worker.terminate(); },
  };
}
