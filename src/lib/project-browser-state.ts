import type { ProjectKind, ProjectStatus } from '../types';

export interface ProjectBrowserState { version: 1; workspaceId: string; query: string; collection: 'active' | 'trash'; kind: ProjectKind | 'all'; status: ProjectStatus | 'all' | 'favorite'; businessCategory: string; layout: 'grid' | 'list'; page: number; scrollTop: number; }
export const projectBrowserKey = (workspaceId: string) => `xuzuo-project-browser-v1:${workspaceId}`;
export function defaultProjectBrowserState(workspaceId: string, collection: ProjectBrowserState['collection'] = 'active'): ProjectBrowserState { return { version: 1, workspaceId, query: '', collection, kind: 'all', status: 'all', businessCategory: 'all', layout: 'grid', page: 0, scrollTop: 0 }; }
export function readProjectBrowserState(storage: Pick<Storage, 'getItem'>, workspaceId: string, collection: ProjectBrowserState['collection'] = 'active'): ProjectBrowserState {
  const fallback = defaultProjectBrowserState(workspaceId, collection);
  try {
    const raw = storage.getItem(projectBrowserKey(workspaceId)); if (!raw || raw.length > 5000) return fallback;
    const value = JSON.parse(raw) as ProjectBrowserState;
    if (value.version !== 1 || value.workspaceId !== workspaceId || typeof value.query !== 'string' || value.query.length > 200 || typeof value.businessCategory !== 'string' || value.businessCategory.length > 500 || !['active', 'trash'].includes(value.collection) || !['all', 'ppt', 'word', 'excel', 'image'].includes(value.kind) || !['all', 'favorite', 'draft', 'processing', 'review', 'complete', 'paused'].includes(value.status) || !['grid', 'list'].includes(value.layout) || !Number.isSafeInteger(value.page) || value.page < 0 || value.page > 100000 || !Number.isFinite(value.scrollTop) || value.scrollTop < 0 || value.scrollTop > 10000000) return fallback;
    return value;
  } catch { return fallback; }
}
export function saveProjectBrowserState(storage: Pick<Storage, 'setItem'>, value: ProjectBrowserState) { storage.setItem(projectBrowserKey(value.workspaceId), JSON.stringify(value)); }
