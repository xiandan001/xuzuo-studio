import { describe, expect, it } from 'vitest';
import type { AutomationDecision, AutomationJob, AutomationSnapshot } from '../automation-types';
import type { WorkflowRun } from '../configuration-types';
import { buildDispatchTasks, filterDispatchTasks, resolveDispatchRun } from './dispatch-tasks';

const time = '2026-11-18T09:00:00Z';
const job = (id: string, fields: Partial<AutomationJob> = {}): AutomationJob => ({
  id, workspaceId: 'workspace', projectId: 'project', ruleId: 'rule', eventId: 'event', dispatchKey: `key-${id}`,
  status: 'queued', createdAt: time, updatedAt: time, attachmentIds: [], input: '', ...fields,
});
const decision = (id: string, jobId: string, fields: Partial<AutomationDecision> = {}): AutomationDecision => ({
  id, jobId, workspaceId: 'workspace', projectId: 'project', kind: 'uncertain', title: '派工尚未确认', detail: '后台未返回执行编号。', createdAt: time, ...fields,
});
const snapshot = (jobs: AutomationJob[], decisions: AutomationDecision[] = []): AutomationSnapshot => ({
  revision: 1, jobs, decisions, available: true, events: [], memories: [], rules: [{ id: 'rule', workspaceId: 'workspace', projectId: 'project', workflowId: 'workflow', name: '表情包流程', input: '', variables: {}, enabled: true, trigger: 'manual', updatedAt: time }],
});
const project = { id: 'project', name: '粉兔工作室' };
const run = (id: string, fields: Partial<WorkflowRun> = {}): WorkflowRun => ({ id, projectId: 'project', workspaceId: 'workspace', mode: 'live', ...fields } as WorkflowRun);
const params = { scope: 'visible', group: 'all', projectId: 'all', query: '' } as const;

describe('统一运行台的调度任务', () => {
  it('根据可信本机关联去重，隐藏和回收的运行不会再出现调度副本', () => {
    const jobs = [job('hidden', { runId: 'hidden-run' }), job('trash'), job('visible', { runId: 'visible-run' }), job('missing', { runId: 'missing-run' }), job('another-project', { runId: 'other-run' }), job('another-workspace', { workspaceId: 'elsewhere' }), job('legacy', { status: 'decision' })];
    const runs = [run('hidden-run', { hiddenAt: time }), run('trash-run', { trashedAt: time, dispatchKey: jobs[1].dispatchKey }), run('visible-run'), run('other-run', { projectId: 'other' }), run('legacy-run')];
    const cards = [decision('legacy-card', 'legacy', { runId: 'legacy-run' })];
    const tasks = buildDispatchTasks(snapshot(jobs, cards), runs, [project], 'workspace');
    expect(tasks.map(task => task.id)).toEqual(['missing', 'another-project']);
    expect(tasks[0]).toMatchObject({ linkedRunId: 'missing-run', summary: '关联的运行记录暂不可见。' });
    expect(resolveDispatchRun(jobs[0], runs)?.id).toBe('hidden-run');
    expect(resolveDispatchRun(jobs[1], runs)?.id).toBe('trash-run');
    expect(resolveDispatchRun(jobs[4], runs)).toBeUndefined();
    expect(resolveDispatchRun(jobs[6], runs, cards)?.id).toBe('legacy-run');
    expect(filterDispatchTasks(tasks, { ...params, scope: 'hidden' })).toEqual([]);
    expect(filterDispatchTasks(tasks, { ...params, scope: 'trash' })).toEqual([]);
  });

  it('按项目、状态和关键词查询，已取消任务保留在结束记录', () => {
    const queued = job('queued'), dispatch = job('dispatch', { status: 'dispatching', updatedAt: '2026-11-18T09:01:00Z' });
    const jobs = [queued, dispatch, job('cancelled', { status: 'cancelled' }), job('uncertain', { status: 'decision' }), job('other', { projectId: 'other', error: '连接需要检查', status: 'decision' }), queued];
    const tasks = buildDispatchTasks(snapshot(jobs, [decision('decision-one', 'uncertain')]), [], [project], 'workspace');
    expect(tasks).toHaveLength(5);
    expect(filterDispatchTasks(tasks, { ...params, group: 'running', projectId: 'project', query: '表情包' }).map(task => task.id)).toEqual(['dispatch', 'queued']);
    expect(filterDispatchTasks(tasks, { ...params, group: 'attention', query: '执行编号' }).map(task => task.id)).toEqual(['uncertain']);
    expect(filterDispatchTasks(tasks, { ...params, group: 'attention', query: '连接' }).map(task => task.id)).toEqual(['other']);
    expect(filterDispatchTasks(tasks, { ...params, group: 'finished' }).map(task => task.id)).toEqual(['cancelled']);
  });

  it('待取消、已有运行编号和人工验收均不能通过补充调度行重新派工', () => {
    const cancelling = { ...job('stop', { status: 'decision' }), cancellationPending: true };
    const cancellationRequested = { ...job('requested', { status: 'decision' }), cancelRequestedAt: time };
    const jobs = [cancelling, cancellationRequested, job('linked', { status: 'decision', runId: 'missing-run' }), job('review', { status: 'decision' }), job('continue', { status: 'decision' })];
    const cards = jobs.map(item => decision(item.id, item.id, { kind: item.id === 'review' ? 'review' : 'uncertain' }));
    const tasks = buildDispatchTasks(snapshot(jobs, cards), [], [project], 'workspace');
    expect(tasks[0]).toMatchObject({ group: 'attention', statusLabel: '正在核对取消', canStop: true, canContinue: false });
    expect(tasks.filter(item => item.canContinue).map(item => item.id)).toEqual(['continue']);
  });
});
