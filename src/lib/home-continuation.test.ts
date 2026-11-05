import { describe, expect, it } from 'vitest';
import type { WorkflowRun } from '../configuration-types';
import type { HomeAutomationMessage } from './home-automation-chat';
import { homeConversationContinuation } from './home-continuation';

const created = (ruleId = 'old-rule', workflowId = 'old-flow'): HomeAutomationMessage => ({ id: ruleId, role: 'system', kind: 'created', text: '已保存', ruleId, workflowId, createdAt: '2026-11-05T00:00:00Z' });
const run = (id = 'old-run'): WorkflowRun => ({ id, mode: 'live', workspaceId: 'workspace', projectId: 'project', workflowId: 'old-flow', workflowName: '上一轮', snapshot: { id: 'old-flow', workspaceId: 'workspace', name: '上一轮', description: '', outputKind: 'image', steps: [], updatedAt: '' }, status: 'waiting-review', stepIndex: 0, attempts: [], variables: {}, input: '', createdAt: '2026-11-05T00:00:00Z', updatedAt: '2026-11-05T00:00:00Z' });
const select = (messages: HomeAutomationMessage[], runs: WorkflowRun[], current?: string) => homeConversationContinuation('workspace', 'project', current, messages, runs);

describe('首页只衔接当前对话自己的上一轮待检查任务', () => {
  it('兼容2.0.4仅有规则/流程引用的旧对话，新方案确认后可衔接且不修改历史', () => {
    const messages = [created()], runs = [run()], before = JSON.stringify({ messages, runs });
    expect(select(messages, runs)).toEqual({ previousRuleId: 'old-rule', previousRunId: 'old-run' });
    expect(select([...messages, created('new-rule', 'new-flow')], runs, 'new-rule')).toEqual({ previousRuleId: 'old-rule', previousRunId: 'old-run' });
    expect(JSON.stringify({ messages, runs })).toBe(before);
    expect(select(messages, runs, 'old-rule')).toBeUndefined();
  });
  it.each(['running', 'paused', 'complete', 'cancelled', 'failed', 'interrupted'] as const)('上一轮为%s时不自动替换或翻出更早任务', status => {
    expect(select([created()], [{ ...run(), status }])).toBeUndefined();
    expect(select([created()], [run('earlier'), { ...run('later'), status, createdAt: '2026-11-05T01:00:00Z' }])).toBeUndefined();
  });
  it('不替换其他工作区、项目、流程、模拟或规划任务，也不接受其他对话的全局运行', () => {
    for (const changes of [{ workspaceId: 'foreign' }, { projectId: 'foreign' }, { workflowId: 'foreign' }, { mode: 'simulation' }, { purpose: 'automation-plan' }]) expect(select([created()], [{ ...run(), ...changes } as WorkflowRun])).toBeUndefined();
    expect(select([], [run()])).toBeUndefined();
    expect(select([{ ...created(), role: 'user' }], [run()])).toBeUndefined();
    expect(select([created('older-rule'), created('latest-rule', 'other-flow')], [run()])).toBeUndefined();
  });
  it('已有具体运行关联时必须匹配，不以旧流程引用覆盖新的运行', () => {
    expect(select([{ ...created(), productionRunIds: ['old-run'] }], [run()])).toEqual({ previousRuleId: 'old-rule', previousRunId: 'old-run' });
    expect(select([{ ...created(), productionRunIds: ['another-run'] }], [run()])).toBeUndefined();
    expect(select([{ ...created(), workflowId: undefined }], [run()])).toBeUndefined();
  });
});
