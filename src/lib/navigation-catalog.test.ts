import { describe, expect, it } from 'vitest';
import { APP_NAVIGATION, PRIMARY_NAVIGATION, TOOL_GROUPS, navigationTaskSummary, primaryNavigationView } from './navigation-catalog';
import type { WorkflowRun } from '../configuration-types';
import type { ViewId } from '../types';

describe('聚焦主导航与高级路由目录', () => {
  it('只有四个主入口，保留全部旧路由和工作台搜索入口', () => {
    expect(PRIMARY_NAVIGATION.map(item => item.label)).toEqual(['创作', '项目', '资源库', '自动化']);
    const routes: ViewId[] = ['overview', 'documents', 'images', 'projects', 'assets', 'prompts', 'categories', 'workflows', 'automation', 'models', 'activity', 'finance', 'settings', 'tools', 'business'];
    expect(APP_NAVIGATION.map(item => item.id).sort()).toEqual(routes.sort());
    expect(new Set(APP_NAVIGATION.map(item => item.id)).size).toBe(15);
    expect(APP_NAVIGATION.every(item => item.label && item.icon)).toBe(true);
  });
  it('工作台归属我的作品，高级页面归属工具，八项工具没有遗漏或重复', () => {
    for (const route of ['projects', 'documents', 'images'] as const) expect(primaryNavigationView(route)).toBe('projects');
    expect(primaryNavigationView('overview')).toBe('overview'); expect(primaryNavigationView('assets')).toBe('assets');
    const routes = TOOL_GROUPS.flatMap(group => group.items.map(item => item.id));
    expect(routes.sort()).toEqual(['automation', 'workflows', 'activity', 'prompts', 'categories', 'models', 'finance', 'settings', 'business'].sort());
    for (const route of ['prompts', 'categories'] as const) expect(primaryNavigationView(route)).toBe('assets');
    for (const route of ['workflows', 'automation', 'activity'] as const) expect(primaryNavigationView(route)).toBe('automation');
    for (const route of ['models', 'finance', 'settings', 'tools'] as const) expect(primaryNavigationView(route)).toBeNull();
    expect(TOOL_GROUPS).toHaveLength(3);
    expect(TOOL_GROUPS.every(group => group.items.every(item => item.description.length > 8))).toBe(true);
  });
  it('任务摘要按真实运行状态统计，包含规划任务，隔离外区、已回收项目与隐藏记录', () => {
    const run = (id: string, status: WorkflowRun['status'], extra: Partial<WorkflowRun> = {}) => ({ id, status, projectId: 'one', workspaceId: 'workspace', ...extra } as WorkflowRun);
    const runs = [run('production', 'running'), run('planning', 'running', { purpose: 'automation-plan' }), run('paused', 'paused'), run('review', 'waiting-review'), run('finished', 'complete'), run('failed', 'failed'), run('foreign', 'running', { workspaceId: 'other' }), run('hidden', 'paused', { hiddenAt: 'now' }), run('trashed', 'waiting-review', { trashedAt: 'now' }), run('trashed-project', 'running', { projectId: 'gone' }), run('missing-project', 'running', { projectId: 'missing' })];
    const before = JSON.stringify(runs);
    expect(navigationTaskSummary(runs, 'workspace', [{ id: 'one', workspaceId: 'workspace' }, { id: 'gone', workspaceId: 'workspace', trashedAt: 'now' }])).toEqual({ running: 2, paused: 1, review: 1 });
    expect(navigationTaskSummary(runs, 'workspace', [])).toEqual({ running: 0, paused: 0, review: 0 });
    expect(navigationTaskSummary([], 'workspace')).toEqual({ running: 0, paused: 0, review: 0 });
    expect(JSON.stringify(runs)).toBe(before);
  });
});
