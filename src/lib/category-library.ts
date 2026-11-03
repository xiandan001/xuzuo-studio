import type { BusinessCategory } from '../configuration-types';

export function categoryPath(categories: BusinessCategory[], id?: string): string {
  if (!id) return '未分类';
  const category = categories.find(item => item.id === id);
  if (!category) return '原分类已不可用';
  const parent = categories.find(item => item.id === category.parentId);
  return parent ? `${parent.name} / ${category.name}` : category.name;
}

export function categoryContains(categories: BusinessCategory[], selectedId: string, itemId?: string): boolean {
  if (selectedId === 'all') return true;
  if (selectedId === 'none') return !itemId;
  return itemId === selectedId || categories.some(item => item.id === itemId && item.parentId === selectedId);
}

export function categoryRows(categories: BusinessCategory[], archived: boolean, query = ''): BusinessCategory[] {
  const needle = query.trim().toLowerCase();
  return categories.filter(item => !item.parentId).flatMap(parent => [parent, ...categories.filter(item => item.parentId === parent.id)]).filter(item => {
    const parent = categories.find(candidate => candidate.id === item.parentId);
    const effectiveArchived = item.archived || !!parent?.archived;
    return effectiveArchived === archived && (!needle || categoryPath(categories, item.id).toLowerCase().includes(needle));
  });
}
