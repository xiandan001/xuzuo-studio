import { describe, expect, it, vi } from 'vitest';
import type { WorkflowRun } from '../configuration-types';
import { organizeTaskBatch, taskCanOrganizeAs } from './bulk-task-management';
const run = (id: string, status: WorkflowRun['status'] = 'complete'): WorkflowRun => ({ id, workspaceId: 'w', projectId: 'p', workflowId: 'flow', workflowName: '任务', snapshot: { id: 'flow', workspaceId: 'w', name: '', description: '', outputKind: 'word', steps: [], updatedAt: '' }, status, stepIndex: 0, attempts: [], input: '', variables: {}, createdAt: '', updatedAt: '' });
describe('批量任务整理只处理可整理的元数据', () => {
  it('结束态可整理，运行/暂停/人工检查态均不允许，归档恢复动作分明', () => {
    for (const status of ['running', 'paused', 'waiting-review'] as const) for (const action of ['hide', 'trash', 'restore'] as const) expect(taskCanOrganizeAs(run('a', status), action)).toBe(false);
    expect(taskCanOrganizeAs(run('a'), 'hide')).toBe(true); expect(taskCanOrganizeAs(run('a'), 'restore')).toBe(false);
    expect(taskCanOrganizeAs({ ...run('a'), hiddenAt: 'now' }, 'restore')).toBe(true); expect(taskCanOrganizeAs({ ...run('a'), trashedAt: 'now' }, 'hide')).toBe(false);
  });
  it('去重并逐项重查状态，不调用其他工作区/项目且不更改费用或文件', async () => {
    const records = [run('a'), run('b'), { ...run('foreign'), workspaceId: 'other' }, { ...run('foreign-project'), projectId: 'outside' }], before = structuredClone(records);
    const manage = vi.fn(async (id: string) => { if (id === 'a') records[1].status = 'running'; });
    const result = await organizeTaskBatch({ ids: ['a', 'a', 'b', 'foreign', 'foreign-project', 'missing'], action: 'trash', workspaceId: 'w', getRuns: () => records, projectIds: new Set(['p']), manage });
    expect(result).toEqual({ done: 1, skipped: 4, failedIds: ['b', 'foreign', 'foreign-project', 'missing'] }); expect(manage).toHaveBeenCalledExactlyOnceWith('a', 'trash');
    expect(records[0]).toEqual(before[0]); expect(records[2]).toEqual(before[2]);
  });
  it('部分失败继续报告其余结果，作用域失效后不派发剩余项', async () => {
    const records = [run('a'), run('b'), run('c')]; let current = true;
    const manage = vi.fn(async (id: string) => { if (id === 'a') throw Error('目录离线'); if (id === 'b') current = false; });
    const result = await organizeTaskBatch({ ids: ['a', 'b', 'c'], action: 'hide', workspaceId: 'w', getRuns: () => records, projectIds: new Set(['p']), manage, stillCurrent: () => current });
    expect(result).toEqual({ done: 1, skipped: 2, failedIds: ['a', 'c'] }); expect(manage.mock.calls.map(call => call[0])).toEqual(['a', 'b']);
  });
  it('等待一个整理结束后才派发下一项，不并发重排记录', async () => {
    let release!: () => void; const records = [run('a'), run('b')], manage = vi.fn((id: string) => id === 'a' ? new Promise<void>(resolve => { release = resolve; }) : Promise.resolve());
    const pending = organizeTaskBatch({ ids: ['a', 'b'], action: 'trash', workspaceId: 'w', getRuns: () => records, projectIds: new Set(['p']), manage });
    expect(manage).toHaveBeenCalledTimes(1); release(); expect(await pending).toMatchObject({ done: 2, skipped: 0 }); expect(manage).toHaveBeenCalledTimes(2);
  });
  it('单次最多100项，超出仍保留为未处理项而非丢弃', async () => {
    const records = Array.from({ length: 103 }, (_, index) => run(`item-${index}`)), manage = vi.fn(async () => undefined);
    const result = await organizeTaskBatch({ ids: records.map(item => item.id), action: 'hide', workspaceId: 'w', getRuns: () => records, projectIds: new Set(['p']), manage });
    expect(result).toEqual({ done: 100, skipped: 3, failedIds: ['item-100', 'item-101', 'item-102'] }); expect(manage).toHaveBeenCalledTimes(100);
  });
});
