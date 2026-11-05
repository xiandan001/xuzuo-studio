import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url), { exportAutomationBackup, validateAutomationBackup, mergeAutomationBackup } = require('../../electron/automation-backup.cjs'), { createIdMap, remap } = require('../../electron/backup-format.cjs');
const stamp = '2026-11-03T00:00:00Z';
function empty() { return { version: 1, revision: 0, context: { workspaces: [], projects: [], workflows: [], models: [], connections: [] }, rules: [], events: [], jobs: [], decisions: [], memories: [] }; }
function fixture() {
  const rule = { id: 'rule-one', workspaceId: 'workspace-one', projectId: 'project-one', workflowId: 'workflow-one', name: '自动交付', enabled: true, trigger: 'manual', input: '目标与事实', variables: {}, updatedAt: stamp };
  const workflow = { id: 'workflow-one', workspaceId: 'workspace-one', name: '制作检查', outputKind: 'word', steps: [{ id: 'producer', kind: 'text', modelConfigId: 'model-one', credentialId: 'MUST-NOT-BACKUP', prompt: '保留事实' }, { id: 'reviewer', kind: 'text', modelConfigId: 'model-one', qualityGate: { repairStepId: 'producer', maxRepairs: 1 } }] };
  const state = { ...empty(), context: { workspaces: [{ id: 'workspace-one', name: '本区' }, { id: 'workspace-other', name: '外区' }], projects: [{ id: 'project-one', workspaceId: 'workspace-one', kind: 'word', costCents: 17 }, { id: 'project-other', workspaceId: 'workspace-other', kind: 'word' }], workflows: [workflow, { id: 'workflow-other', workspaceId: 'workspace-other', steps: [] }], models: [{ id: 'model-one', connectionId: 'connection-one', modelId: 'model', apiKey: 'MUST-NOT-BACKUP' }, { id: 'model-other', connectionId: 'connection-other' }], connections: [{ id: 'connection-one', baseUrl: 'https://fixture.invalid', secret: 'MUST-NOT-BACKUP' }, { id: 'connection-other', secret: 'OTHER-WORKSPACE-SECRET' }] }, rules: [rule, { ...rule, id: 'rule-other', workspaceId: 'workspace-other', projectId: 'project-other', workflowId: 'workflow-other', input: 'OTHER-WORKSPACE-GOAL' }], events: [{ id: 'event-one', workspaceId: rule.workspaceId, projectId: rule.projectId, trigger: 'manual', sourceId: rule.id, createdAt: stamp }], jobs: [{ id: 'job-one', workspaceId: rule.workspaceId, projectId: rule.projectId, ruleId: rule.id, eventId: 'event-one', dispatchKey: 'a'.repeat(64), status: 'running', runId: 'run-one', ruleSnapshot: rule, workflowSnapshot: workflow, attachmentIds: ['artifact-one'], ruleChain: [rule.id], input: '完整目标', createdAt: stamp, updatedAt: stamp }], decisions: [], memories: [{ id: 'memory-one', workspaceId: rule.workspaceId, projectId: rule.projectId, ruleId: rule.id, note: '用户决定保留原始数字', createdAt: stamp }] };
  const records = exportAutomationBackup(state, { workspaceIds: ['workspace-one'], projectIds: ['project-one'] }), idMap = createIdMap({ records, run: { id: 'run-one' }, artifact: { id: 'artifact-one' } });
  const availableRuns = [{ id: idMap['run-one'], projectId: idMap['project-one'], workspaceId: idMap['workspace-one'], dispatchKey: 'a'.repeat(64), status: 'interrupted', attempts: [] }];
  return { state, records, idMap, availableRuns };
}
describe('自动化严格作用域备份和手动恢复', () => {
  it('只选中项目/工作区和用到的配置，无凭证字段，不更改源状态', () => {
    const f = fixture(), text = JSON.stringify(f.records); expect(f.records.rules).toHaveLength(1); expect(f.records.context.models).toHaveLength(1); expect(f.records.context.connections).toHaveLength(1);
    expect(text).not.toContain('MUST-NOT-BACKUP'); expect(text).not.toContain('OTHER-WORKSPACE'); expect(text).not.toContain('credentialId'); expect(f.state.rules[0].enabled).toBe(true);
    expect(() => validateAutomationBackup(f.records, { projects: [{ id: 'outside', workspaceId: 'workspace-one' }], workspaces: f.records.context.workspaces })).toThrow('超出');
  });
  it('禁用规则、未完任务变待办、恢复真实run绑定且检查target和引用全重绑', () => {
    const f = fixture(), current = { ...empty(), externalLedger: [{ costCents: 17 }] }, original = structuredClone(current);
    const result = mergeAutomationBackup(current, { records: f.records, idMap: f.idMap, backupId: 'backup-one', availableRuns: f.availableRuns, now: stamp });
    expect(result.changed).toBe(true); expect(result.state.rules[0].enabled).toBe(false); expect(result.state.jobs[0].status).toBe('decision'); expect(result.state.jobs[0].runId).toBe(f.availableRuns[0].id); expect(result.state.jobs[0].dispatchKey).not.toBe(f.records.jobs[0].dispatchKey); expect(result.state.decisions[0].kind).toBe('uncertain');
    expect(result.state.jobs[0].ruleChain).toEqual([f.idMap['rule-one']]); expect(result.state.jobs[0].workflowSnapshot.steps[1].qualityGate.repairStepId).toBe(f.idMap.producer); expect(result.state.memories[0].projectId).toBe(f.idMap['project-one']); expect(current).toEqual(original); expect(result.state.externalLedger).toEqual(original.externalLedger);
  });
  it('丢ACK时按原dispatchKey找回已有run，错误项目的同key不绑定，无记录不沿用原机runId', () => {
    const f = fixture(); delete f.records.jobs[0].runId;
    const found = mergeAutomationBackup(empty(), { records: f.records, idMap: f.idMap, backupId: 'backup-one', availableRuns: f.availableRuns }); expect(found.state.jobs[0].runId).toBe(f.availableRuns[0].id);
    const missing = mergeAutomationBackup(empty(), { records: f.records, idMap: f.idMap, backupId: 'backup-one', availableRuns: [{ ...f.availableRuns[0], projectId: 'foreign' }] }); expect(missing.state.jobs[0].runId).toBeUndefined(); expect(missing.state.jobs[0].status).toBe('decision');
  });
  it('同backupId幂等，内容/映射或实体冲突都不覆盖现有数据', () => {
    const f = fixture(), once = mergeAutomationBackup(empty(), { records: f.records, idMap: f.idMap, backupId: 'backup-one', availableRuns: f.availableRuns }).state;
    once.rules[0].name = '恢复后用户改名'; const again = mergeAutomationBackup(once, { records: f.records, idMap: f.idMap, backupId: 'backup-one', availableRuns: f.availableRuns }); expect(again.changed).toBe(false); expect(again.state.rules[0].name).toBe('恢复后用户改名');
    expect(() => mergeAutomationBackup(once, { records: { ...f.records, memories: [] }, idMap: f.idMap, backupId: 'backup-one', availableRuns: f.availableRuns })).toThrow('内容或编号映射');
    const collision = empty(); collision.rules = [{ ...once.rules[0] }]; const before = structuredClone(collision); expect(() => mergeAutomationBackup(collision, { records: f.records, idMap: f.idMap, backupId: 'different-backup', availableRuns: f.availableRuns })).toThrow('编号已存在'); expect(collision).toEqual(before);
  });
  it('已有待办转uncertain不重复，完整历史缺失运行时不假标已完成，旧字段为空兼容', () => {
    const f = fixture(); f.records.jobs[0].status = 'decision'; f.records.decisions = [{ id: 'decision-one', workspaceId: 'workspace-one', projectId: 'project-one', jobId: 'job-one', kind: 'review', title: '旧审批', detail: '', createdAt: stamp }]; f.idMap['decision-one'] = 'mapped-decision';
    const restored = mergeAutomationBackup(empty(), { records: f.records, idMap: f.idMap, backupId: 'backup-one', availableRuns: f.availableRuns }).state; expect(restored.decisions).toHaveLength(1); expect(restored.decisions[0].kind).toBe('uncertain');
    f.records.decisions = []; f.records.jobs[0].status = 'complete'; expect(mergeAutomationBackup(empty(), { records: f.records, idMap: f.idMap, backupId: 'backup-one', availableRuns: [] }).state.jobs[0].status).toBe('decision'); expect(mergeAutomationBackup(empty(), { records: undefined }).changed).toBe(false);
    expect(exportAutomationBackup(empty(), { workspaceIds: ['workspace-one'] })).toBeUndefined();
  });
  it('普通工作流的质检修订引用重绑，用户正文与变量不误替换', () => {
    const source = { id: 'review', qualityGate: { repairStepId: 'producer' }, prompt: 'producer', variables: { repairStepId: 'producer' } }; expect(remap(source, { review: 'new-review', producer: 'new-producer' })).toEqual({ id: 'new-review', qualityGate: { repairStepId: 'new-producer' }, prompt: 'producer', variables: { repairStepId: 'producer' } });
  });
  it('项目移组只备份当前归属，冻结历史保留旧owner，context副本重绑且不漏其他工作区资料', () => {
    const f = fixture(); f.state.jobs[0].ruleSnapshot = structuredClone(f.state.jobs[0].ruleSnapshot); f.state.context.workspaces.push({ id: 'workspace-target', name: '移入区' }); f.state.context.projects[0].workspaceId = 'workspace-target';
    for (const key of ['rules', 'events', 'jobs', 'memories']) for (const item of f.state[key].filter(item => item.projectId === 'project-one')) { item.originWorkspaceId = item.workspaceId; item.workspaceId = 'workspace-target'; }
    const records = exportAutomationBackup(f.state, { workspaceIds: ['workspace-target'], projectIds: ['project-one'] }); expect(records.context.workspaces.map(item => item.id)).toEqual(['workspace-target']); expect(records.jobs[0].ruleSnapshot.workspaceId).toBe('workspace-one'); expect(records.jobs[0].workflowSnapshot.workspaceId).toBe('workspace-one'); expect(records.context.workflows[0]).toMatchObject({ workspaceId: 'workspace-target', originWorkspaceId: 'workspace-one' }); expect(JSON.stringify(records)).not.toContain('OTHER-WORKSPACE'); expect(f.state.jobs[0].workflowSnapshot.workspaceId).toBe('workspace-one');
    const idMap = createIdMap({ records }), restored = mergeAutomationBackup(empty(), { records, idMap, backupId: 'moved-backup', availableRuns: [] }).state; expect(restored.rules[0].enabled).toBe(false); expect(restored.jobs[0].status).toBe('decision'); expect(restored.context.projects[0].workspaceId).toBe(idMap['workspace-target']);
  });
});
