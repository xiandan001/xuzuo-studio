import { describe, expect, it } from 'vitest';
import type { WorkflowRun } from '../configuration-types';
import type { ArtifactMetadata } from '../live-types';
import { filterTaskRuns, taskGroup, taskNextAction, taskStatusLabel } from './task-center';

const run = (id: string, status: WorkflowRun['status'], changes: Partial<WorkflowRun> = {}) => ({ id, status, projectId: 'p', workflowName: '宣传图工作流', updatedAt: '2026-11-02T08:00:00.000Z', ...changes }) as WorkflowRun;
const projects = [{ id: 'p', name: '清禾夏日新品' }, { id: 'other', name: '客户手册' }];
const filter = { scope: 'visible' as const, group: 'all' as const, projectId: 'all', query: '' };

describe('任务中心筛选与下一步', () => {
  it('优先呈现待处理任务，其次执行中、最后结束，不修改源数组', () => {
    const runs = [run('done', 'complete'), run('progress', 'running'), run('failed', 'failed'), run('review', 'waiting-review', { updatedAt: '2026-11-02T09:00:00Z' })];
    expect(filterTaskRuns(runs, projects, filter).map(item => item.id)).toEqual(['review', 'failed', 'progress', 'done']);
    expect(runs[0].id).toBe('done');
  });
  it('当前任务、隐藏、回收站保持独立，状态筛选不恢复或删除记录', () => {
    const runs = [run('failed', 'failed'), run('hidden', 'complete', { hiddenAt: 'today' }), run('trash', 'interrupted', { trashedAt: 'today' })];
    expect(filterTaskRuns(runs, projects, { ...filter, group: 'attention' }).map(item => item.id)).toEqual(['failed']);
    expect(filterTaskRuns(runs, projects, { ...filter, scope: 'hidden' }).map(item => item.id)).toEqual(['hidden']);
    expect(filterTaskRuns(runs, projects, { ...filter, scope: 'trash' }).map(item => item.id)).toEqual(['trash']);
    expect(runs[2].trashedAt).toBe('today');
  });
  it('项目、工作流、异常关键词可以组合筛选，并支持缺失项目记录', () => {
    const runs = [run('a', 'failed', { error: 'HTTP 429 限流' }), run('b', 'complete', { projectId: 'other' }), run('orphan', 'interrupted', { projectId: 'removed' })];
    expect(filterTaskRuns(runs, projects, { ...filter, projectId: 'p', query: '清禾' }).map(item => item.id)).toEqual(['a']);
    expect(filterTaskRuns(runs, projects, { ...filter, query: ' http 429 ' }).map(item => item.id)).toEqual(['a']);
    expect(filterTaskRuns(runs, projects, { ...filter, projectId: 'removed' }).map(item => item.id)).toEqual(['orphan']);
  });
  it('只有已登记可用项目成品才直接去工作台，规划和无成品检查保留上下文', () => {
    const file = { id: 'image', name: '成品.png', kind: 'image', mimeType: 'image/png', bytes: 100, path: '/owned/成品.png', createdAt: '2026-11-04' } as ArtifactMetadata;
    const result = { snapshot: { outputKind: 'image', steps: [] } as unknown as WorkflowRun['snapshot'], attempts: [{ status: 'complete', artifacts: [file] }] as WorkflowRun['attempts'] };
    expect(taskNextAction(run('a', 'complete', result))).toBe('project');
    expect(taskNextAction(run('a', 'waiting-review', result))).toBe('project');
    expect(taskNextAction(run('a', 'complete', { ...result, purpose: 'automation-plan' }))).toBe('detail');
    expect(taskNextAction(run('a', 'waiting-review'))).toBe('detail');
    expect(taskNextAction(run('a', 'complete', { ...result, attempts: [{ status: 'complete', artifacts: [{ ...file, unavailable: true }] }] as WorkflowRun['attempts'] }))).toBe('detail');
    expect(taskNextAction(run('a', 'complete', { ...result, attempts: [{ status: 'complete', artifacts: [{ ...file, trashedAt: 'today' }] }] as WorkflowRun['attempts'] }))).toBe('detail');
    const office = { snapshot: { outputKind: 'word', steps: [] } as unknown as WorkflowRun['snapshot'], attempts: [{ status: 'complete', artifacts: [{ ...file, name: '交付.docx', kind: 'office' }] }] as WorkflowRun['attempts'] };
    expect(taskNextAction(run('a', 'waiting-review', office))).toBe('project');
    expect(taskNextAction(run('a', 'complete', { ...office, attempts: [{ status: 'complete', artifacts: [{ ...file, name: 'result.txt', kind: 'text', mimeType: 'text/plain' }] }] as WorkflowRun['attempts'] }))).toBe('detail');
    expect(taskNextAction(run('a', 'interrupted'))).toBe('detail');
    expect(taskNextAction(run('a', 'paused'))).toBe('detail');
    expect(taskGroup(run('a', 'cancelled'))).toBe('finished');
    expect(taskStatusLabel(run('a', 'cancelled', { supersededByRunId: 'b' }))).toBe('已由后续创作替代');
  });
});
