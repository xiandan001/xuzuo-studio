import { describe, expect, it } from 'vitest';
import { DEFAULT_WORKSPACE_ID, INITIAL_LEDGER, INITIAL_PREFERENCES, INITIAL_PROJECTS } from '../data';
import { blocksProjectTrash, migrateLegacyWorkspace, moveProjectWorkspace, projectTrashError, recoverInterruptedTasks, restoreProjectState, scopeWorkspace, trashProjectState } from './workspace-state';

describe('工作区隔离与旧数据迁移', () => {
  it('旧版项目和费用完整保留到初始工作区', () => {
    const state = migrateLegacyWorkspace({ projects: INITIAL_PROJECTS.map(({ workspaceId: _workspaceId, ...project }) => project), ledger: INITIAL_LEDGER, preferences: { ...INITIAL_PREFERENCES, studioName: '已有工作室' } });
    expect(state.workspaces[0].name).toBe('已有工作室');
    expect(state.projects).toHaveLength(INITIAL_PROJECTS.length);
    expect(state.projects.every(project => project.workspaceId === DEFAULT_WORKSPACE_ID)).toBe(true);
    expect(state.ledger.reduce((sum, entry) => sum + entry.costCents, 0)).toBe(1846);
  });
  it('新工作区不显示其它工作区的项目和调用账本', () => {
    const state = migrateLegacyWorkspace();
    expect(scopeWorkspace(state.projects, state.ledger, 'empty-workspace')).toEqual({ projects: [], trashedProjects: [], ledger: [] });
  });
  it('移动项目后费用随项目归属变化且原始流水不被改写', () => {
    const state = migrateLegacyWorkspace();
    const originalLedger = JSON.stringify(state.ledger);
    const moved = moveProjectWorkspace(state.projects, 'p1', 'client-workspace');
    const target = scopeWorkspace(moved, state.ledger, 'client-workspace');
    expect(target.projects.map(project => project.id)).toEqual(['p1']);
    expect(target.ledger.reduce((sum, entry) => sum + entry.costCents, 0)).toBe(486);
    expect(scopeWorkspace(moved, state.ledger, DEFAULT_WORKSPACE_ID).ledger.reduce((sum, entry) => sum + entry.costCents, 0)).toBe(1360);
    expect(JSON.stringify(state.ledger)).toBe(originalLedger);
    expect(state.projects[0].workspaceId).toBe(DEFAULT_WORKSPACE_ID);
  });
  it('跨工作区移动时不携带原工作区业务分类', () => {
    const projects = INITIAL_PROJECTS.map(item => item.id === 'p1' ? { ...item, businessCategoryId: 'old-workspace-category' } : item);
    const moved = moveProjectWorkspace(projects, 'p1', 'new-workspace');
    expect(moved[0].businessCategoryId).toBeUndefined();
    expect(moved[0].costCents).toBe(projects[0].costCents);
    expect(projects[0].businessCategoryId).toBe('old-workspace-category');
  });
  it('刷新恢复任务时费用不消失，且不会留下无法继续的虚假运行任务', () => {
    const state = migrateLegacyWorkspace();
    state.projects[0].status = 'paused';
    state.ledger[0].status = 'processing';
    const recovered = recoverInterruptedTasks(state);
    expect(recovered.projects[0].status).toBe('draft');
    expect(recovered.ledger[0].status).toBe('cancelled');
    expect(recovered.ledger[0].costCents).toBe(state.ledger[0].costCents);
  });
  it('迁移空的旧工作区不会自动塞入演示项目', () => {
    const state = migrateLegacyWorkspace({ projects: [], ledger: [], preferences: INITIAL_PREFERENCES });
    expect(state.projects).toEqual([]);
    expect(state.ledger).toEqual([]);
  });
  it('回收项目不再出现在活跃列表，项目历史费用仍完整计入当前工作区', () => {
    const state = migrateLegacyWorkspace();
    const original = JSON.stringify(state.projects);
    const moved = trashProjectState(state.projects, 'p1', DEFAULT_WORKSPACE_ID, new Set(), '2026-10-30T01:00:00Z');
    const scoped = scopeWorkspace(moved, state.ledger, DEFAULT_WORKSPACE_ID);
    expect(scoped.projects.some(project => project.id === 'p1')).toBe(false);
    expect(scoped.trashedProjects.map(project => project.id)).toEqual(['p1']);
    expect(scoped.ledger.reduce((sum, entry) => sum + entry.costCents, 0)).toBe(1846);
    expect(JSON.stringify(state.projects)).toBe(original);
    expect(moved.find(project => project.id === 'p1')?.costCents).toBe(state.projects[0].costCents);
  });
  it('恢复仅清除trashedAt，草稿项目ID、版本、费用和其它属性保留', () => {
    const state = migrateLegacyWorkspace();
    const trashed = trashProjectState(state.projects, 'p1', DEFAULT_WORKSPACE_ID, new Set(), '2026-10-30T01:00:00Z');
    expect(restoreProjectState(trashed, 'p1', DEFAULT_WORKSPACE_ID)).toEqual(state.projects);
    expect(restoreProjectState(trashed, 'p1', 'another-workspace')).toEqual(trashed);
  });
  it('运行和暂停的项目不能移入回收站，不能操作其它工作区项目', () => {
    const state = migrateLegacyWorkspace();
    for (const status of ['processing', 'paused'] as const) {
      const projects = state.projects.map(project => project.id === 'p1' ? { ...project, status } : project);
      expect(trashProjectState(projects, 'p1', DEFAULT_WORKSPACE_ID, new Set(), 'now')).toBe(projects);
    }
    expect(projectTrashError(state.projects[0], DEFAULT_WORKSPACE_ID, new Set(['p1']))).not.toBe('');
    expect(trashProjectState(state.projects, 'p1', DEFAULT_WORKSPACE_ID, new Set(['p1']), 'now')).toBe(state.projects);
    expect(trashProjectState(state.projects, 'p1', 'another-workspace', new Set(), 'now')).toBe(state.projects);
  });
  it('待检查和中断项目可以回收，任务状态与历史账本保留，真实运行仍受保护', () => {
    const state = migrateLegacyWorkspace();
    for (const status of ['waiting-review', 'interrupted', 'failed', 'cancelled'] as const) {
      const run = { status };
      const project = { ...state.projects[0], status: 'review' as const };
      const busy = new Set([run].filter(blocksProjectTrash).map(() => project.id));
      const hidden = trashProjectState([project], project.id, project.workspaceId, busy, 'now');
      expect(hidden[0].trashedAt).toBe('now');
      expect(restoreProjectState(hidden, project.id, project.workspaceId)).toEqual([project]);
      expect(scopeWorkspace(hidden, state.ledger, project.workspaceId).ledger).toEqual(state.ledger.filter(entry => entry.projectId === project.id));
      expect(run.status).toBe(status);
    }
    expect(blocksProjectTrash({ status: 'running' })).toBe(true);
    expect(blocksProjectTrash({ status: 'paused' })).toBe(true);
  });
  it('最后一个项目回收后工作区仍保留账本及可恢复项目，而不是空白重置', () => {
    const state = migrateLegacyWorkspace();
    const projects = [state.projects[0]];
    const ledger = state.ledger.filter(entry => entry.projectId === projects[0].id);
    const scoped = scopeWorkspace(trashProjectState(projects, projects[0].id, DEFAULT_WORKSPACE_ID, new Set(), 'now'), ledger, DEFAULT_WORKSPACE_ID);
    expect(scoped.projects).toEqual([]);
    expect(scoped.trashedProjects).toHaveLength(1);
    expect(scoped.ledger).toEqual(ledger);
  });
});
