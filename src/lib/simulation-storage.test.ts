import { describe, expect, it } from 'vitest';
import type { WorkflowRun } from '../configuration-types';
import { loadSimulationRuns, resetSimulationRuns, SIMULATION_RUNS_KEY, writeSimulationRuns } from './simulation-storage';

function run(status: WorkflowRun['status'] = 'complete'): WorkflowRun {
  return { id: 'fixture-run', workspaceId: 'fixture-workspace', projectId: 'fixture-project', workflowId: 'fixture-flow', workflowName: '固定模拟流程', snapshot: { id: 'fixture-flow', workspaceId: 'fixture-workspace', name: '固定流程', description: '', outputKind: 'word', updatedAt: '', steps: [{ id: 'text', name: '正文', kind: 'text', prompt: '仅模拟', inputSource: 'project', enabled: true }] }, status, stepIndex: status === 'complete' ? 1 : 0, attempts: [{ id: 'attempt', stepId: 'text', stepName: '正文', modelLabel: '仅模拟', status: status === 'running' ? 'running' : 'complete', costCents: 48, summary: '固定内容', input: '固定需求', prompt: '仅模拟', action: '初次生成' }], variables: {}, input: '固定需求', createdAt: '', updatedAt: '' };
}
function store(raw?: string) {
  const values = new Map<string, string>(raw === undefined ? [] : [[SIMULATION_RUNS_KEY, raw]]), writes: string[] = [];
  return { values, writes, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { writes.push(key); values.set(key, value); } };
}
describe('模拟历史存储保护', () => {
  it('空库首次读取不自动写入空数组', () => { const storage = store(), loaded = loadSimulationRuns(storage); expect(loaded).toEqual({ runs: [], raw: null }); expect(storage.writes).toEqual([]); });
  it.each(['BROKEN_FIXTURE', '', '{}', 'null', '[null]'])('坏JSON或结构%s保留原串且不覆盖为空数组', raw => {
    const storage = store(raw), loaded = loadSimulationRuns(storage); expect(loaded.issue).toMatchObject({ kind: 'read', canExportOriginal: true }); expect(loaded.runs).toEqual([]); expect(loaded.raw).toBe(raw); expect(storage.getItem(SIMULATION_RUNS_KEY)).toBe(raw); expect(storage.writes).toEqual([]);
  });
  it('嵌套snapshot/attempt和错误step成本输入均拒绝，避免加载后崩溃或NaN演示费用', () => {
    const mutations = [(value: WorkflowRun) => { value.snapshot.steps = null as never; }, (value: WorkflowRun) => { value.attempts[0].input = {} as never; }, (value: WorkflowRun) => { value.snapshot.steps[0].kind = 'unknown' as never; }, (value: WorkflowRun) => { value.snapshot.steps[0].count = -1; }];
    for (const mutate of mutations) { const value = run(); mutate(value); const raw = JSON.stringify([value]), storage = store(raw); expect(loadSimulationRuns(storage).issue?.kind).toBe('read'); expect(storage.getItem(SIMULATION_RUNS_KEY)).toBe(raw); expect(storage.writes).toEqual([]); }
  });
  it('不会把误放到模拟key的真实任务交给模拟tick', () => { const real = { ...run('running'), mode: 'live' }; expect(loadSimulationRuns(store(JSON.stringify([real]))).issue?.kind).toBe('read'); });
  it('旧running恢复为interrupted，原演示成本及原串保留，paused和waiting-review不变', () => {
    for (const status of ['running', 'paused', 'waiting-review'] as const) { const original = run(status), raw = JSON.stringify([original]), storage = store(raw), loaded = loadSimulationRuns(storage); expect(loaded.issue).toBeUndefined(); expect(loaded.runs[0].status).toBe(status === 'running' ? 'interrupted' : status); expect(loaded.runs[0].attempts[0].costCents).toBe(48); expect(storage.getItem(SIMULATION_RUNS_KEY)).toBe(raw); expect(storage.writes).toEqual([]); }
  });
  it('存储属性及getItem不可读时不抛出或写入', () => {
    const denied = () => { throw new Error('fixture accessor denied'); };
    expect(loadSimulationRuns(denied).issue).toMatchObject({ kind: 'read', canExportOriginal: false }); expect(resetSimulationRuns(denied, 'backup').issue?.kind).toBe('read');
  });
  it('写成功才返回可提交的新原串，quota时旧历史不变', () => {
    const raw = JSON.stringify([run()]), storage = store(raw), pending = run('running');
    const failed = writeSimulationRuns({ ...storage, setItem: () => { throw new Error('fixture quota'); } }, [pending]); expect(failed.issue?.kind).toBe('write'); expect(failed.raw).toBeUndefined(); expect(storage.getItem(SIMULATION_RUNS_KEY)).toBe(raw);
    const saved = writeSimulationRuns(storage, [pending]); expect(saved.issue).toBeUndefined(); expect(saved.raw).toBe(JSON.stringify([pending]));
  });
  it('显式重置先成功备份原串，失败时绝不清空历史', () => {
    const raw = 'BROKEN_FIXTURE', storage = store(raw);
    const failed = resetSimulationRuns({ ...storage, setItem: (key, value) => { if (key === 'backup') throw new Error('fixture quota'); storage.setItem(key, value); } }, 'backup', raw);
    expect(failed.issue?.kind).toBe('read'); expect(storage.getItem(SIMULATION_RUNS_KEY)).toBe(raw); expect(storage.writes).toEqual([]);
    const saved = resetSimulationRuns(storage, 'backup', raw); expect(saved.issue).toBeUndefined(); expect(storage.writes).toEqual(['backup', SIMULATION_RUNS_KEY]); expect(storage.getItem('backup')).toBe(raw); expect(storage.getItem(SIMULATION_RUNS_KEY)).toBe('[]');
  });
  it('陈旧面板拒绝覆盖别处恢复的新历史，失败不更新期望原串', () => {
    const expected = 'BROKEN_FIXTURE', repaired = JSON.stringify([run()]), storage = store(repaired), result = resetSimulationRuns(storage, 'backup', expected);
    expect(result.issue?.message).toContain('其他窗口'); expect(result.raw).toBe(expected); expect(storage.getItem(SIMULATION_RUNS_KEY)).toBe(repaired); expect(storage.writes).toEqual([]);
  });
  it('备份后发生更新时再次拒绝覆盖，同时保留原串副本', () => {
    const expected = 'BROKEN_FIXTURE', repaired = JSON.stringify([run()]), storage = store(expected);
    const result = resetSimulationRuns({ ...storage, setItem: (key, value) => { storage.setItem(key, value); if (key === 'backup') storage.values.set(SIMULATION_RUNS_KEY, repaired); } }, 'backup', expected);
    expect(result.issue?.message).toContain('备份期间'); expect(result.raw).toBe(expected); expect(storage.getItem('backup')).toBe(expected); expect(storage.getItem(SIMULATION_RUNS_KEY)).toBe(repaired); expect(storage.writes).toEqual(['backup']);
  });
});
