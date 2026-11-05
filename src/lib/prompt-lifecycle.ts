import type { PromptTemplate } from '../types';
export const promptAvailable = (prompt: PromptTemplate): boolean => !prompt.archivedAt && !prompt.trashedAt;
export function promptLibraryItems(prompts: PromptTemplate[], workspaceId: string, collection: 'builtin' | 'mine' | 'archived' | 'trash', filter: 'all' | 'favorite' | 'recent' = 'all'): PromptTemplate[] {
  return prompts.filter(prompt => (prompt.builtin || prompt.workspaceId === workspaceId) && (collection === 'builtin' ? prompt.builtin && promptAvailable(prompt) : !prompt.builtin && (collection === 'trash' ? !!prompt.trashedAt : collection === 'archived' ? !!prompt.archivedAt && !prompt.trashedAt : promptAvailable(prompt))) && (filter === 'favorite' ? prompt.favorite : filter === 'recent' ? !!prompt.lastUsedAt : true)).sort((first, second) => filter === 'recent' ? (second.lastUsedAt || '').localeCompare(first.lastUsedAt || '') : 0);
}
