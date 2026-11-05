import { describe, expect, it } from 'vitest';
import type { WorkflowRun } from '../configuration-types';
import type { LedgerEntry } from '../types';
import type { HomeAutomationMessage } from './home-automation-chat';
import type { AutomationRule } from '../automation-types';
import { homeConversationCosts, linkHomeConversationWorkflows } from './home-conversation-costs';

const message = (value: Partial<HomeAutomationMessage>): HomeAutomationMessage => ({ id: 'message', role: 'system', kind: 'created', text: '', createdAt: '', ...value });
const run = (id: string, workflowId: string, changes = {}): WorkflowRun => ({ id, workflowId, workspaceId: 'workspace', projectId: 'same-project', mode: 'live', ...changes } as WorkflowRun);
const entry = (id: string, workflowRunId: string, costCents: number, billingMode: LedgerEntry['billingMode'] = 'live'): LedgerEntry => ({ id, workflowRunId, costCents, billingMode, projectId: 'same-project' } as LedgerEntry);
describe('首页对话与运行费用精确关联', () => {
  it('只合计本聊天规划与已保存流程的真实运行，隐藏/回收照计，不混入同项目编辑、别聊或模拟费', () => {
    const messages = [message({ kind: 'plan', runId: 'plan-run' }), message({ id: 'created', ruleId: 'rule', workflowId: 'owned-flow' })];
    const runs = [run('hidden', 'owned-flow', { hiddenAt: 'now' }), run('trashed', 'owned-flow', { trashedAt: 'now' }), run('editor', 'document-image-edit-other'), run('other-chat', 'other-flow'), run('simulation', 'owned-flow', { mode: 'simulation' }), run('elsewhere', 'owned-flow', { workspaceId: 'other' })];
    const ledger = [entry('p', 'plan-run', 150), entry('h', 'hidden', 12), entry('t', 'trashed', 12), entry('e', 'editor', 700), entry('o', 'other-chat', 900), entry('s', 'simulation', 100, 'simulation'), entry('x', 'elsewhere', 200), entry('h', 'hidden', 12)], before = JSON.stringify(ledger);
    const result = homeConversationCosts('workspace', messages, runs, ledger, 'plan-run');
    expect(result.entries.map(item => item.id)).toEqual(['p', 'h', 't']); expect(result.entries.reduce((sum, item) => sum + item.costCents, 0)).toBe(174); expect(JSON.stringify(ledger)).toBe(before);
  });
  it('旧规则缺失仍可用同区job→run精确关联；无足够信息时标待同步而不是零成本', () => {
    const messages = [message({ ruleId: 'archived-rule' })], ledger = [entry('old', 'old-production', 88)];
    expect(homeConversationCosts('workspace', messages, [], ledger).pendingRuleIds).toEqual(['archived-rule']);
    const recovered = homeConversationCosts('workspace', messages, [], ledger, undefined, [{ workspaceId: 'workspace', ruleId: 'archived-rule', runId: 'old-production' }]); expect(recovered.entries).toEqual(ledger); expect(recovered.pendingRuleIds).toEqual([]);
    expect(homeConversationCosts('workspace', messages, [], ledger, undefined, [{ workspaceId: 'elsewhere', ruleId: 'archived-rule', runId: 'old-production' }]).pendingRuleIds).toEqual(['archived-rule']);
  });
  it('回填只改关联元数据，不重写原消息、规划run引用或已有workflow；拒绝跨区规则关联', () => {
    const messages = [message({ id: 'p', kind: 'plan', runId: 'plan-run' }), message({ ruleId: 'old' }), message({ id: 'already', ruleId: 'existing', workflowId: 'original' })], before = JSON.stringify(messages);
    const rules = [{ id: 'old', workspaceId: 'workspace', workflowId: 'restored-flow' }, { id: 'existing', workspaceId: 'workspace', workflowId: 'wrong-replacement' }] as AutomationRule[];
    const linked = linkHomeConversationWorkflows('workspace', messages, rules); expect(linked[1].workflowId).toBe('restored-flow'); expect(linked[0]).toBe(messages[0]); expect(linked[2]).toBe(messages[2]); expect(JSON.stringify(messages)).toBe(before);
    expect(linkHomeConversationWorkflows('elsewhere', messages, rules)[1].workflowId).toBeUndefined();
  });
  it('已核实运行ID随消息保留，项目回收导致可见runs为空后费用仍完整；旧jobs也可持久回填', () => {
    const messages = [message({ ruleId: 'rule', workflowId: 'flow' })], ledger = [entry('paid', 'production', 88)];
    const remembered = linkHomeConversationWorkflows('workspace', messages, [], [], [run('production', 'flow', { hiddenAt: 'now' })]); expect(remembered[0].productionRunIds).toEqual(['production']);
    expect(homeConversationCosts('workspace', remembered, [], ledger).entries).toEqual(ledger);
    const legacy = linkHomeConversationWorkflows('workspace', [message({ ruleId: 'rule' })], [], [{ workspaceId: 'workspace', ruleId: 'rule', runId: 'production' }]); expect(legacy[0].productionRunIds).toEqual(['production']); expect(homeConversationCosts('workspace', legacy, [], ledger).pendingRuleIds).toEqual([]);
  });
});
