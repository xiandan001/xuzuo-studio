import { describe, expect, it } from 'vitest';
import { mergeNativeSnapshot } from './native-snapshot';
import { mergeLiveLedger, applyLiveProjectState } from '../hooks/useLiveWorkflowRunner';
import type { LiveSnapshot } from '../live-types';
import type { WorkflowRun } from '../configuration-types';
import type { LedgerEntry, Project } from '../types';
const run = (id: string, projectId: string, status = 'complete') => ({ id, projectId, status, attempts: [], createdAt: id, updatedAt: '2026-11-01', stepIndex: 1 } as unknown as WorkflowRun);
const entry = (id: string, projectId: string, costCents: number, time: string) => ({ id, projectId, costCents, time } as LedgerEntry);
describe('增量快照不丢历史也不重复计费', () => {
  it('更新旧任务不改变新任务顺序，保留其他项目和旧账单', () => {
    const previous: LiveSnapshot = { runs: [run('new', 'a'), run('old', 'b')], ledger: [entry('fee-new', 'a', 10, '2026-11-02'), entry('fee-old', 'b', 5, '2026-11-01')] };
    const next = mergeNativeSnapshot(previous, { delta: true, runs: [run('old', 'b', 'running')], ledger: [entry('fee-old', 'b', 7, '2026-11-01')], revision: 2 });
    expect(next.runs.map(item => item.id)).toEqual(['new', 'old']); expect(next.runs[0]).toBe(previous.runs[0]);
    expect(next.ledger.map(item => [item.id, item.costCents])).toEqual([['fee-new', 10], ['fee-old', 7]]);
    const again = mergeNativeSnapshot(next, { delta: true, runs: [], ledger: [], revision: 3 });
    expect(mergeLiveLedger(next.ledger, again.ledger)).toBe(next.ledger);
  });
  it('新任务追加在前；完整刷新取代摘要但UI账本保留已发生记录', () => {
    const previous: LiveSnapshot = { runs: [run('old', 'b')], ledger: [entry('old', 'b', 5, '')] };
    const next = mergeNativeSnapshot(previous, { delta: true, runs: [run('new', 'a')], ledger: [entry('new', 'a', 7, '')] }); expect(next.runs.map(item => item.id)).toEqual(['new', 'old']);
    const full = { runs: [], ledger: [] }; expect(mergeNativeSnapshot(next, full)).toBe(full); expect(mergeLiveLedger(next.ledger, full.ledger)).toEqual(next.ledger);
    const project = { costCents: 12, liveLedgerBaselineCents: 12 } as Project;
    expect(applyLiveProjectState(project, undefined, 2, 14).costCents).toBe(14); expect(applyLiveProjectState({ ...project, costCents: 14, liveLedgerBaselineCents: 14 }, undefined, 0, 14).costCents).toBe(14);
  });
});
