import { describe, expect, it } from 'vitest';
import type { BusinessCategory } from '../configuration-types';
import { categoryContains, categoryPath, categoryRows } from './category-library';

const categories: BusinessCategory[] = [
  { id: 'client', workspaceId: 'w', name: '品牌业务', archived: false },
  { id: 'launch', workspaceId: 'w', name: '新品发布', parentId: 'client', archived: false },
  { id: 'archive', workspaceId: 'w', name: '旧方案', parentId: 'client', archived: true },
  { id: 'old', workspaceId: 'w', name: '历史客户', archived: true },
  { id: 'old-child', workspaceId: 'w', name: '历史子项', parentId: 'old', archived: false },
];
describe('业务分类目录与内容定位', () => {
  it('大分类包含小分类，未分类单独定位，不把归档内容当成未分类', () => {
    expect(categoryContains(categories, 'client', 'launch')).toBe(true);
    expect(categoryContains(categories, 'client', 'archive')).toBe(true);
    expect(categoryContains(categories, 'launch', 'client')).toBe(false);
    expect(categoryContains(categories, 'none', undefined)).toBe(true);
    expect(categoryContains(categories, 'none', 'archive')).toBe(false);
    expect(categoryContains(categories, 'all', 'old')).toBe(true);
  });
  it('父分类归档后小分类仍可在归档目录找到，且不会继续作为可选新归属', () => {
    expect(categoryRows(categories, false).map(item => item.id)).toEqual(['client', 'launch']);
    expect(categoryRows(categories, true).map(item => item.id)).toEqual(['archive', 'old', 'old-child']);
  });
  it('搜索完整父子路径并忽略首尾空格，缺失分类不误报为未分类', () => {
    expect(categoryRows(categories, false, ' 品牌 ').map(item => item.id)).toEqual(['client', 'launch']);
    expect(categoryRows(categories, false, '新品').map(item => item.id)).toEqual(['launch']);
    expect(categoryPath(categories, 'launch')).toBe('品牌业务 / 新品发布');
    expect(categoryPath(categories, 'missing')).toBe('原分类已不可用');
  });
});
