import { describe, expect, it } from 'vitest';
import type { Project } from '../types';
import type { BusinessCategory } from '../configuration-types';
import { filteredProjects, projectPage, recentActivity } from './project-browser';
const project = (id: string, changes: Partial<Project> = {}): Project => ({ id, workspaceId: 'one', name: `项目 ${id}`, kind: 'word', status: 'draft', description: '', updatedAt: '2026-11-02T00:00:00Z', costCents: 17, version: 1, accent: 'purple', ...changes });
describe('项目浏览边界', () => {
  it('24项分页、末页收缩和空列表均在合法范围，不改变源序列', () => {
    const items = Array.from({ length: 65 }, (_, i) => project(String(i))), before = [...items];
    expect(projectPage(items, 0)).toMatchObject({ page: 0, pages: 3, start: 0, end: 24 });
    expect(projectPage(items, 1).items.map(item => item.id)).toEqual(items.slice(24, 48).map(item => item.id));
    expect(projectPage(items, 99)).toMatchObject({ page: 2, pages: 3, start: 48, end: 65 });
    expect(projectPage([], 2)).toEqual({ page: 0, pages: 1, start: 0, end: 0, items: [] }); expect(items).toEqual(before);
  });
  it('关键词修剪、类型/收藏/状态和父子分类组合时保留稳定排序', () => {
    const categories = [{ id: 'parent', name: '业务', archived: false }, { id: 'child', parentId: 'parent', name: '方案', archived: false }] as BusinessCategory[];
    const items = [project('a', { name: 'Tea Plan', favorite: true, businessCategoryId: 'child', status: 'review' }), project('b', { name: 'tea image', kind: 'image', favorite: true, businessCategoryId: 'child' }), project('c', { name: 'Tea brief' })];
    expect(filteredProjects(items, categories, { query: '  TEA ', kind: 'word', status: 'favorite', category: 'parent' }).map(item => item.id)).toEqual(['a']);
    expect(filteredProjects(items, categories, { query: '', kind: 'all', status: 'review', category: 'all' }).map(item => item.id)).toEqual(['a']);
    expect(items).toHaveLength(3);
  });
  it('动态按明确时间排序，同时间稳定、未知旧时间排后，不把原数组当有序', () => {
    const items = [{ id: 'old', time: '2026-11-01T02:00:00Z' }, { id: 'unknown', time: '今天 12:30' }, { id: 'latest', time: '2026-11-02T02:00:00Z' }, { id: 'same', time: '2026-11-02T10:00:00+08:00' }];
    expect(recentActivity(items).map(item => item.id)).toEqual(['latest', 'same', 'old']); expect(items[0].id).toBe('old');
  });
});
