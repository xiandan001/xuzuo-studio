import { describe, expect, it, vi } from 'vitest';
import type { SpreadsheetCalculation, SpreadsheetDocument } from '../spreadsheet-types';
import { createSpreadsheetWorkerClient } from './spreadsheet-worker-client';
import type { SpreadsheetWorkerPort, SpreadsheetWorkerResponse } from './spreadsheet-worker-client';
const workbook = (title: string): SpreadsheetDocument => ({ schemaVersion: 1, kind: 'excel', title, sheets: [{ id: 'one', name: '明细', rowCount: 10, columnCount: 2, cells: {} }] });
const result: SpreadsheetCalculation = { engineVersion: '1', cells: {}, formulaCount: 0, calculatedCount: 0, issues: [], allFormulasValid: true };
const port = () => ({ postMessage: vi.fn(), onmessage: null, onerror: null, terminate: vi.fn() } as SpreadsheetWorkerPort & { postMessage: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn> });
const reply = (worker: SpreadsheetWorkerPort, data: SpreadsheetWorkerResponse) => worker.onmessage?.({ data } as MessageEvent<SpreadsheetWorkerResponse>);
describe('后台计算只运行一个任务并保留最新排队请求', () => {
  it('迅速多次编辑仅发送首个和最新，过时排队请求可识别取消', async () => {
    const worker = port(), client = createSpreadsheetWorkerClient(worker);
    const first = client.calculate(workbook('首个')), skipped = client.calculate(workbook('中间')).catch(error => error.name), last = client.calculate(workbook('最新'));
    expect(worker.postMessage).toHaveBeenCalledTimes(1); expect(await skipped).toBe('AbortError'); reply(worker, { id: 1, calculation: result }); expect(await first).toEqual(result);
    expect(worker.postMessage).toHaveBeenCalledTimes(2); expect(worker.postMessage.mock.calls[1][0].document.title).toBe('最新'); reply(worker, { id: 3, calculation: result }); expect(await last).toEqual(result); client.dispose();
  });
  it('旧/未知响应不完成新请求，失败与销毁明确释放计算', async () => {
    const worker = port(), client = createSpreadsheetWorkerClient(worker), pending = client.calculate(workbook('当前')).catch(error => error.message);
    reply(worker, { id: 55, calculation: result }); reply(worker, { id: 1, error: '公式有问题' }); expect(await pending).toBe('公式有问题');
    const active = client.calculate(workbook('退出')).catch(error => error.name); client.dispose(); expect(await active).toBe('AbortError'); expect(worker.terminate).toHaveBeenCalled();
  });
  it('无响应超时会终止worker而不是积压计算或假称成功', async () => {
    vi.useFakeTimers(); const worker = port(), client = createSpreadsheetWorkerClient(worker), pending = client.calculate(workbook('超时')).catch(error => error.message);
    vi.advanceTimersByTime(20000); expect(await pending).toContain('超时'); expect(worker.terminate).toHaveBeenCalled(); client.dispose(); vi.useRealTimers();
  });
});
