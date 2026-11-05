import { describe, expect, it } from 'vitest';
import { promptAvailable, promptLibraryItems } from './prompt-lifecycle';
import type { PromptTemplate } from '../types';
const prompt: PromptTemplate = { id: 'p', workspaceId: 'w', builtin: false, name: '提案', description: '', content: '保留原正文', category: 'ppt', mode: 'create', updatedAt: '' };
describe('提示词整理只改变可用性，不改变内容副本', () => {
  it('当前可用、归档、回收站与其他工作区互不混淆', () => {
    const items = [prompt, { ...prompt, id: 'archive', archivedAt: 'now' }, { ...prompt, id: 'trash', archivedAt: 'now', trashedAt: 'now' }, { ...prompt, id: 'other', workspaceId: 'x' }, { ...prompt, id: 'builtin', builtin: true, workspaceId: undefined }];
    expect(promptLibraryItems(items, 'w', 'mine').map(item => item.id)).toEqual(['p']); expect(promptLibraryItems(items, 'w', 'archived').map(item => item.id)).toEqual(['archive']); expect(promptLibraryItems(items, 'w', 'trash').map(item => item.id)).toEqual(['trash']); expect(promptLibraryItems(items, 'w', 'builtin').map(item => item.id)).toEqual(['builtin']);
    expect(promptAvailable(items[1])).toBe(false); expect(promptAvailable(items[2])).toBe(false); expect(items[1].content).toBe(prompt.content);
  });
  it('收藏和最近使用可筛选且不重排调用方数组', () => {
    const items = [{ ...prompt, id: 'a', favorite: true, lastUsedAt: '2026-11-01' }, { ...prompt, id: 'b', lastUsedAt: '2026-11-03' }];
    expect(promptLibraryItems(items, 'w', 'mine', 'favorite').map(item => item.id)).toEqual(['a']); expect(promptLibraryItems(items, 'w', 'mine', 'recent').map(item => item.id)).toEqual(['b', 'a']); expect(items[0].id).toBe('a');
  });
});
