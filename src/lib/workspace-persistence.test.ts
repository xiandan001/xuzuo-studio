import { describe, expect, it } from 'vitest';
import { INITIAL_PREFERENCES } from '../data';
import { emptyWorkspaceState, readWorkspaceState, resetWorkspaceState, writeWorkspaceState, WORKSPACE_STORAGE_KEY } from './workspace-persistence';

function store(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial)), writes: string[] = [];
  return { values, writes, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { writes.push(key); values.set(key, value); } };
}
describe('工作室索引读取与保存保护', () => {
  it('全新生产配置从空工作区开始，不把演示项目和模拟成本放入真实工作室', () => {
    const loaded = readWorkspaceState(store());
    expect(loaded.issue).toBeUndefined(); expect(loaded.state.projects).toEqual([]); expect(loaded.state.ledger).toEqual([]);
    expect(loaded.state.workspaces).toHaveLength(1); expect(loaded.state.activeWorkspaceId).toBe(loaded.state.workspaces[0].id);
  });
  it('坏JSON及坏结构不写回，也不显示示例项目冒充用户索引', () => {
    for (const raw of ['{"broken":', '{"workspaces":[null]}', 'null', '']) {
      const storage = store({ [WORKSPACE_STORAGE_KEY]: raw }), loaded = readWorkspaceState(storage);
      expect(loaded.issue?.kind).toBe('read'); expect(loaded.raw).toBe(raw); expect(loaded.state.projects).toEqual([]);
      expect(writeWorkspaceState(storage, loaded.state, loaded.issue)?.kind).toBe('read');
      expect(storage.getItem(WORKSPACE_STORAGE_KEY)).toBe(raw); expect(storage.writes).toEqual([]);
    }
  });
  it('旧合法状态正确迁移，保留0金额和工作区隔离', () => {
    const state = emptyWorkspaceState();
    state.preferencesByWorkspace[state.activeWorkspaceId] = { ...INITIAL_PREFERENCES, monthlyBudget: 0, confirmGeneration: true, confirmGenerationVersion: undefined };
    const storage = store({ [WORKSPACE_STORAGE_KEY]: JSON.stringify(state) }), loaded = readWorkspaceState(storage);
    expect(loaded.issue).toBeUndefined(); expect(loaded.state.activeWorkspaceId).toBe(state.activeWorkspaceId);
    expect(loaded.state.preferencesByWorkspace[state.activeWorkspaceId]).toMatchObject({ monthlyBudget: 0, confirmGeneration: false, confirmGenerationVersion: 1 });
    expect(writeWorkspaceState(storage, loaded.state)).toBeUndefined();
  });
  it('legacy合法索引迁移时保留原key，损坏legacy不写新key', () => {
    const key = 'xuzuo-ui-prototype-v1', raw = JSON.stringify({ projects: [], ledger: [], preferences: INITIAL_PREFERENCES });
    const storage = store({ [key]: raw }), loaded = readWorkspaceState(storage);
    expect(loaded.issue).toBeUndefined(); expect(loaded.originalKey).toBe(key); expect(loaded.state.projects).toEqual([]);
    writeWorkspaceState(storage, loaded.state); expect(storage.getItem(key)).toBe(raw);
    const broken = store({ [key]: '{bad' }); expect(readWorkspaceState(broken).issue?.kind).toBe('read'); expect(broken.getItem(WORKSPACE_STORAGE_KEY)).toBeNull();
  });
  it('展示字段和自定义模板结构损坏也进入保护，不留到React渲染才崩溃', () => {
    const state = emptyWorkspaceState();
    for (const broken of [
      { ...state, customPrompts: [null] },
      { ...state, workspaces: [{ ...state.workspaces[0], description: {} }] },
      { ...state, preferencesByWorkspace: { [state.activeWorkspaceId]: { hourlyRate: {} } } },
    ]) {
      const raw = JSON.stringify(broken), storage = store({ [WORKSPACE_STORAGE_KEY]: raw });
      expect(readWorkspaceState(storage).issue?.kind).toBe('read'); expect(storage.getItem(WORKSPACE_STORAGE_KEY)).toBe(raw); expect(storage.writes).toEqual([]);
    }
  });
  it('访问存储属性和写配额失败均返回可见错误，不覆盖原内容', () => {
    const inaccessible = () => { throw new Error('SecurityError'); };
    expect(readWorkspaceState(inaccessible).issue).toMatchObject({ kind: 'read', canExportOriginal: false });
    expect(writeWorkspaceState(inaccessible, emptyWorkspaceState())?.kind).toBe('write');
    const storage = store({ [WORKSPACE_STORAGE_KEY]: 'ORIGINAL' });
    const full = { ...storage, setItem: () => { throw new Error('QuotaExceededError'); } };
    expect(writeWorkspaceState(full, emptyWorkspaceState())?.kind).toBe('write'); expect(storage.getItem(WORKSPACE_STORAGE_KEY)).toBe('ORIGINAL');
  });
  it('显式重置先备份完整原串，再建立新空工作室；备份失败则不清空', () => {
    const raw = '{original-bad-json', storage = store({ [WORKSPACE_STORAGE_KEY]: raw }), loaded = readWorkspaceState(storage);
    expect(resetWorkspaceState(storage, loaded).ok).toBe(true);
    const backupKey = storage.writes.find(key => key.includes('.recovery.'))!;
    expect(JSON.parse(storage.getItem(backupKey)!).raw).toBe(raw); expect(storage.writes.indexOf(backupKey)).toBeLessThan(storage.writes.indexOf(WORKSPACE_STORAGE_KEY));
    expect(readWorkspaceState(storage).state.projects).toEqual([]);
    const failed = store({ [WORKSPACE_STORAGE_KEY]: raw }), blocked = { ...failed, setItem: () => { throw new Error('full'); } };
    expect(resetWorkspaceState(blocked, readWorkspaceState(failed)).ok).toBe(false); expect(failed.getItem(WORKSPACE_STORAGE_KEY)).toBe(raw);
  });
  it('另一窗口更新后拒绝陈旧重置，写失败恢复副本同时保留未保存数据', () => {
    const storage = store({ [WORKSPACE_STORAGE_KEY]: '{broken' }), loaded = readWorkspaceState(storage);
    const newRaw = JSON.stringify(emptyWorkspaceState()); storage.values.set(WORKSPACE_STORAGE_KEY, newRaw);
    expect(resetWorkspaceState(storage, loaded).ok).toBe(false); expect(storage.writes).toEqual([]); expect(storage.getItem(WORKSPACE_STORAGE_KEY)).toBe(newRaw);
    const draft = emptyWorkspaceState(); draft.workspaces[0].name = '尚未保存的名称';
    const result = resetWorkspaceState(storage, { ...readWorkspaceState(storage), issue: { kind: 'write', message: 'full', canExportOriginal: true } }, draft);
    expect(result.ok).toBe(true);
    const backup = JSON.parse(storage.getItem(storage.writes.find(key => key.includes('.recovery.'))!)!);
    expect(backup.raw).toBe(newRaw); expect(backup.currentDraft.workspaces[0].name).toBe('尚未保存的名称');
  });
});
