import { describe, expect, it } from 'vitest';
import { INITIAL_PREFERENCES } from '../data';
import { emptyWorkspaceState, readWorkspaceState, WORKSPACE_STORAGE_KEY } from './workspace-persistence';
import { saveWorkspacePreferences } from './settings-save';

function fixture() {
  const state = emptyWorkspaceState(), id = state.activeWorkspaceId;
  state.workspaces.push({ id: 'other', name: '其他客户', description: '', createdAt: new Date().toISOString() });
  state.preferencesByWorkspace.other = { ...INITIAL_PREFERENCES, studioName: '其他客户', hourlyRate: 188 };
  const original = JSON.stringify(state), values = new Map([[WORKSPACE_STORAGE_KEY, original]]), writes: string[] = [];
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { writes.push(key); values.set(key, value); } };
  return { state, id, values, writes, storage, original };
}
describe('工作区设置的实际持久化确认', () => {
  it('同一次写入保存名称和偏好，重新读取真实快照且不改变其他工作区与费用', () => {
    const f = fixture(), result = saveWorkspacePreferences(f.storage, f.state, f.id, { studioName: '  客户新名称  ', hourlyRate: 99 });
    expect(result.ok).toBe(true); expect(f.writes).toEqual([WORKSPACE_STORAGE_KEY]);
    const saved = readWorkspaceState(f.storage); expect(saved.issue).toBeUndefined();
    expect(saved.state.workspaces.find(row => row.id === f.id)?.name).toBe('客户新名称');
    expect(saved.state.preferencesByWorkspace[f.id]).toMatchObject({ studioName: '客户新名称', hourlyRate: 99 });
    expect(saved.state.preferencesByWorkspace.other).toEqual(f.state.preferencesByWorkspace.other); expect(saved.state.ledger).toEqual(f.state.ledger);
    expect(JSON.stringify(f.state)).toBe(f.original);
  });
  it('配额失败不报成功、不覆盖原串或内存，恢复写入后可显式重试', () => {
    const f = fixture(), full = { ...f.storage, setItem: () => { throw Error('QuotaExceededError'); } };
    const result = saveWorkspacePreferences(full, f.state, f.id, { studioName: '待保存名称' });
    expect(result).toMatchObject({ ok: false, issue: { kind: 'write' } }); expect(f.storage.getItem(WORKSPACE_STORAGE_KEY)).toBe(f.original); expect(JSON.stringify(f.state)).toBe(f.original);
    expect(saveWorkspacePreferences(f.storage, f.state, f.id, { studioName: '待保存名称' }, result.ok ? undefined : result.issue).ok).toBe(true);
    expect(readWorkspaceState(f.storage).state.workspaces.find(row => row.id === f.id)?.name).toBe('待保存名称');
  });
  it('读取错误和过期工作区不允许覆盖；非法字段输入不写入', () => {
    const f = fixture(), issue = { kind: 'read' as const, message: '原数据无法读取', canExportOriginal: true };
    expect(saveWorkspacePreferences(f.storage, f.state, f.id, { hourlyRate: 2 }, issue)).toMatchObject({ ok: false, issue });
    expect(saveWorkspacePreferences(f.storage, f.state, 'other', { hourlyRate: 2 }).ok).toBe(false);
    expect(saveWorkspacePreferences(f.storage, f.state, f.id, { channelFeePercent: 100 }).ok).toBe(false);
    expect(f.writes).toEqual([]); expect(f.storage.getItem(WORKSPACE_STORAGE_KEY)).toBe(f.original);
  });
});
