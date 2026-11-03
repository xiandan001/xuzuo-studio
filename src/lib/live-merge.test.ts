import { describe, expect, it } from 'vitest';
import { applyLiveProjectState, mergeLiveLedger } from '../hooks/useLiveWorkflowRunner';
import type { LedgerEntry, Project } from '../types';
import type { WorkflowRun } from '../configuration-types';

const project: Project = { id: 'p', workspaceId: 'w', name: '任务', kind: 'word', description: '', status: 'draft', costCents: 0, budgetCents: 100, version: 0, updatedAt: '', accent: 'blue' };
const run = { id: 'run', projectId: 'p', status: 'failed', stepIndex: 0, attempts: [] } as unknown as WorkflowRun;
describe('真实快照合并不改写其它任务或重复累计', () => {
  it('历史失败已导入后，其它项目进度不把新的模拟/人工状态重置为草稿', () => {
    const imported = applyLiveProjectState(project, run, 0);
    const newer = { ...imported, status: 'processing' as const };
    expect(applyLiveProjectState(newer, run, 0)).toBe(newer);
    expect(applyLiveProjectState({ ...imported, status: 'complete' }, run, 0).status).toBe('complete');
  });
  it('一次真实完成只产生一个版本，核对费用只改差额', () => {
    const complete = { ...run, status: 'complete' as const, attempts: [{}] } as WorkflowRun;
    const imported = applyLiveProjectState(project, complete, 8);
    expect(imported.version).toBe(1); expect(imported.costCents).toBe(8);
    expect(applyLiveProjectState(imported, complete, 0)).toBe(imported);
    const reconciled = applyLiveProjectState(imported, complete, -3);
    expect(reconciled.version).toBe(1); expect(reconciled.costCents).toBe(5);
  });
  it('界面刷新临时恢复草稿时，后台同一真实任务仍恢复执行状态', () => {
    const running = { ...run, status: 'running' as const };
    const imported = applyLiveProjectState(project, running, 0);
    expect(applyLiveProjectState({ ...imported, status: 'draft' }, running, 0).status).toBe('processing');
  });
  it('同一费用ID用最新状态替换，旧模拟条目保持独立', () => {
    const base = { id: 'live', projectId: 'p', projectName: '任务', action: '初次生成', model: '模型', costCents: 0, time: '', status: 'processing', billingMode: 'live', costState: 'unknown' } as LedgerEntry;
    const sample = { ...base, id: 'simulation', billingMode: 'simulation' as const, costCents: 48 };
    const merged = mergeLiveLedger([base, sample], [{ ...base, status: 'complete', costCents: 5, costState: 'calculated' }]);
    expect(merged).toHaveLength(2); expect(merged.find(entry => entry.id === 'live')?.costCents).toBe(5); expect(merged.find(entry => entry.id === 'simulation')?.costCents).toBe(48);
  });
  it('项目最近时间采用真实任务ISO时间，历史重放和汇率差额不会抹掉较新人工修改时间', () => {
    const complete = { ...run, status: 'complete' as const, updatedAt: '2026-11-01T01:00:00+08:00', attempts: [{}] } as WorkflowRun;
    const imported = applyLiveProjectState(project, complete, 8);
    expect(imported.updatedAt).toBe('2026-10-31T17:00:00.000Z');
    const edited = { ...imported, updatedAt: '2026-11-01T02:00:00+08:00' };
    expect(applyLiveProjectState(edited, complete, -1).updatedAt).toBe(edited.updatedAt);
    expect(applyLiveProjectState({ ...project, updatedAt: edited.updatedAt }, complete, 0).updatedAt).toBe(edited.updatedAt);
    expect(applyLiveProjectState({ ...project, updatedAt: '昨天 12:00' }, { ...run, updatedAt: '今天 14:00' }, 0).updatedAt).toBe('昨天 12:00');
  });
});


it('batch native cost baseline is idempotent regardless of ledger/list arrival order', () => {
  const project = { id: 'batch-project', workspaceId: 'workspace', name: '批次项目', kind: 'word', costCents: 123, liveLedgerBaselineCents: 123, version: 0, status: 'draft', updatedAt: '2026-11-01', description: '', accent: 'blue' } as Project;
  expect(applyLiveProjectState(project, undefined, 123, 123).costCents).toBe(123);
  expect(applyLiveProjectState(project, undefined, 0, 123).costCents).toBe(123);
  const changed = applyLiveProjectState(project, undefined, 140, 140);
  expect(changed.costCents).toBe(140); expect(changed.liveLedgerBaselineCents).toBe(140);
  expect(applyLiveProjectState(changed, undefined, 140, 140)).toBe(changed);
});
