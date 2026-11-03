import { describe, expect, it } from 'vitest';
import { INITIAL_PREFERENCES } from '../data';
import { migrateLegacyWorkspace, removeWorkspaceState, restoreWorkspaceState, visibleWorkspaces, workspaceRemoveError } from './workspace-state';
import { readWorkspaceState, WORKSPACE_STORAGE_KEY, writeWorkspaceState } from './workspace-persistence';

const when = '2026-11-02T03:00:00.000Z';
function fixture() {
  const state = migrateLegacyWorkspace();
  state.workspaces.push({ id: 'second', name: '第二工作区', description: '', directory: 'D:/retained/workspace', createdAt: when });
  state.preferencesByWorkspace.second = { ...INITIAL_PREFERENCES };
  return state;
}
describe('工作区移除与恢复', () => {
  it('移除当前工作区切换到可见工作区，文件登记、项目、费用和自定义资料完整保留', () => {
    const state = fixture(), original = JSON.stringify(state), current = state.activeWorkspaceId;
    const removed = removeWorkspaceState(state, current, when);
    expect(removed.activeWorkspaceId).toBe('second'); expect(visibleWorkspaces(removed.workspaces).map(item => item.id)).toEqual(['second']);
    expect(removed.workspaces.find(item => item.id === current)?.removedAt).toBe(when);
    expect(removed.projects).toBe(state.projects); expect(removed.ledger).toBe(state.ledger);
    expect(removed.preferencesByWorkspace).toBe(state.preferencesByWorkspace); expect(removed.customPrompts).toBe(state.customPrompts);
    expect(JSON.stringify(state)).toBe(original);
    expect(restoreWorkspaceState(removed, current).workspaces).toEqual(state.workspaces);
  });
  it('移除非当前工作区不改变当前选择，恢复不自动切换、不丢原路径', () => {
    const state = fixture(), removed = removeWorkspaceState(state, 'second', when);
    expect(removed.activeWorkspaceId).toBe(state.activeWorkspaceId);
    const restored = restoreWorkspaceState(removed, 'second');
    expect(restored.activeWorkspaceId).toBe(state.activeWorkspaceId); expect(restored.workspaces[1]).toEqual(state.workspaces[1]);
    expect(restoreWorkspaceState(state, 'second')).toBe(state);
  });
  it('拒绝移除最后一个可见工作区、重复移除及不存在的编号', () => {
    const state = fixture(), removed = removeWorkspaceState(state, 'second', when);
    expect(workspaceRemoveError(removed.workspaces, state.activeWorkspaceId)).toContain('至少保留一个');
    expect(() => removeWorkspaceState(removed, state.activeWorkspaceId, when)).toThrow('至少保留一个');
    expect(() => removeWorkspaceState(removed, 'second', when)).toThrow('已移除');
    expect(() => removeWorkspaceState(state, 'missing', when)).toThrow('不存在');
    expect(() => restoreWorkspaceState(state, 'missing')).toThrow('不存在');
  });
  it('保存重开保留移除状态和完整费用，旧的已移除active会改选可见工作区', () => {
    const state = fixture(), removed = removeWorkspaceState(state, state.activeWorkspaceId, when);
    let saved = '';
    const store = { getItem: (key: string) => key === WORKSPACE_STORAGE_KEY ? saved : null, setItem: (_key: string, value: string) => { saved = value; } };
    expect(writeWorkspaceState(store, removed)).toBeUndefined();
    const loaded = readWorkspaceState(store);
    expect(loaded.issue).toBeUndefined(); expect(loaded.state.workspaces).toEqual(removed.workspaces); expect(loaded.state.ledger).toEqual(removed.ledger);
    saved = JSON.stringify({ ...removed, activeWorkspaceId: state.activeWorkspaceId });
    expect(readWorkspaceState(store).state.activeWorkspaceId).toBe('second');
  });
  it('非法移除时间或全被移除的索引进入读保护，原串不被覆盖', () => {
    const state = fixture();
    for (const workspaces of [state.workspaces.map(item => ({ ...item, removedAt: when })), [{ ...state.workspaces[0], removedAt: {} }, state.workspaces[1]], [{ ...state.workspaces[0], removedAt: 'invalid-date' }, state.workspaces[1]]]) {
      const raw = JSON.stringify({ ...state, workspaces }), writes: string[] = [];
      const store = { getItem: () => raw, setItem: (_key: string, value: string) => { writes.push(value); } };
      const loaded = readWorkspaceState(store);
      expect(loaded.issue?.kind).toBe('read'); expect(loaded.raw).toBe(raw);
      expect(writeWorkspaceState(store, loaded.state, loaded.issue)?.kind).toBe('read'); expect(writes).toEqual([]);
    }
  });
});
