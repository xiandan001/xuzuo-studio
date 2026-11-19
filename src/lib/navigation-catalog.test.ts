import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { AppNavigation } from '../components/AppNavigation';
import { APP_NAVIGATION, PRIMARY_NAVIGATION, TOOL_GROUPS, navigationTaskSummary, primaryNavigationView } from './navigation-catalog';
import type { WorkflowRun } from '../configuration-types';
import type { ViewId } from '../types';

describe('聚焦主导航与高级路由目录', () => {
  it('macOS 真实打包验收点击主导航后等待其实际页面路由', () => {
    const source = readFileSync(new URL('../../scripts/verify-macos-launch.mjs', import.meta.url), 'utf8');
    const literal = source.match(/^const lazyPages = (\[[^\n]+\]);$/m)?.[1];
    expect(literal).toBeDefined();
    const pages = JSON.parse(literal!);
    expect(pages.map(([label]: [string, string]) => label)).toEqual(PRIMARY_NAVIGATION.filter(item => item.id !== 'overview').map(item => item.label));
    const visited: ViewId[] = [];
    const navigation = AppNavigation({ view: 'overview', onNavigate: id => visited.push(id) });
    for (const [label, route] of pages) {
      const button = navigation.props.children.find((item: { props: { 'aria-label': string } }) => item.props['aria-label'] === label);
      button.props.onClick();
      expect(visited.at(-1)).toBe(route);
    }
    expect(source).toContain('for (const [label, content] of lazyPages)');
  });
  it('只有四个主入口，保留全部旧路由和工作台搜索入口', () => {
    expect(PRIMARY_NAVIGATION.map(item => item.label)).toEqual(['创作', '项目', '资源库', '自动化']);
    const routes: ViewId[] = ['overview', 'project', 'documents', 'images', 'projects', 'assets', 'prompts', 'categories', 'workflows', 'automation', 'models', 'activity', 'finance', 'settings', 'tools', 'business'];
    expect(APP_NAVIGATION.map(item => item.id).sort()).toEqual(routes.sort());
    expect(new Set(APP_NAVIGATION.map(item => item.id)).size).toBe(16);
    expect(APP_NAVIGATION.every(item => item.label && item.icon)).toBe(true);
  });
  it('工作台归属我的作品，高级页面归属工具，八项工具没有遗漏或重复', () => {
    for (const route of ['project', 'projects', 'documents', 'images'] as const) expect(primaryNavigationView(route)).toBe('projects');
    expect(primaryNavigationView('overview')).toBe('overview'); expect(primaryNavigationView('assets')).toBe('assets');
    const routes = TOOL_GROUPS.flatMap(group => group.items.map(item => item.id));
    expect(routes.sort()).toEqual(['automation', 'workflows', 'activity', 'prompts', 'categories', 'models', 'finance', 'settings', 'business'].sort());
    for (const route of ['prompts', 'categories'] as const) expect(primaryNavigationView(route)).toBe('assets');
    for (const route of ['workflows', 'automation', 'activity'] as const) expect(primaryNavigationView(route)).toBe('automation');
    for (const route of ['models', 'finance', 'settings', 'tools'] as const) expect(primaryNavigationView(route)).toBeNull();
    expect(TOOL_GROUPS).toHaveLength(3);
    expect(TOOL_GROUPS.every(group => group.items.every(item => item.description.trim().length > 0))).toBe(true);
  });
  it('任务摘要按真实运行状态统计，包含规划任务，隔离外区、已回收项目与隐藏记录', () => {
    const run = (id: string, status: WorkflowRun['status'], extra: Partial<WorkflowRun> = {}) => ({ id, status, projectId: 'one', workspaceId: 'workspace', ...extra } as WorkflowRun);
    const runs = [run('production', 'running'), run('planning', 'running', { purpose: 'automation-plan' }), run('paused', 'paused'), run('review', 'waiting-review'), run('finished', 'complete'), run('failed', 'failed'), run('interrupted', 'interrupted'), run('foreign', 'failed', { workspaceId: 'other' }), run('hidden', 'failed', { hiddenAt: 'now' }), run('trashed', 'interrupted', { trashedAt: 'now' }), run('trashed-project', 'running', { projectId: 'gone' }), run('missing-project', 'running', { projectId: 'missing' })];
    const before = JSON.stringify(runs);
    expect(navigationTaskSummary(runs, 'workspace', [{ id: 'one', workspaceId: 'workspace' }, { id: 'gone', workspaceId: 'workspace', trashedAt: 'now' }])).toEqual({ running: 2, paused: 1, review: 1, failed: 1, interrupted: 1 });
    expect(navigationTaskSummary(runs, 'workspace', [])).toEqual({ running: 0, paused: 0, review: 0, failed: 0, interrupted: 0 });
    expect(navigationTaskSummary([], 'workspace')).toEqual({ running: 0, paused: 0, review: 0, failed: 0, interrupted: 0 });
    expect(JSON.stringify(runs)).toBe(before);
  });
});
