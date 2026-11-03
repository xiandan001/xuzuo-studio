import type { BusinessCategory } from '../configuration-types';
import type { Project, ProjectKind, ProjectStatus } from '../types';
import { categoryMatches } from './configuration';
import { explicitTimestamp } from './studio-time';

export const PROJECT_PAGE_SIZE = 24;
export interface ProjectFilters { query: string; kind: ProjectKind | 'all'; status: ProjectStatus | 'all' | 'favorite'; category: string; }
export function filteredProjects(projects: Project[], categories: BusinessCategory[], filter: ProjectFilters): Project[] {
  const query = filter.query.trim().toLocaleLowerCase();
  return projects.filter(project => project.name.toLocaleLowerCase().includes(query) && (filter.kind === 'all' || project.kind === filter.kind) && (filter.status === 'all' || (filter.status === 'favorite' ? project.favorite : project.status === filter.status)) && categoryMatches(categories, filter.category, project.businessCategoryId));
}
export function projectPage<T>(items: T[], requestedPage: number) {
  const pages = Math.max(1, Math.ceil(items.length / PROJECT_PAGE_SIZE)), page = Math.max(0, Math.min(requestedPage, pages - 1)), start = page * PROJECT_PAGE_SIZE;
  return { page, pages, start, end: Math.min(items.length, start + PROJECT_PAGE_SIZE), items: items.slice(start, start + PROJECT_PAGE_SIZE) };
}
export function recentActivity<T extends { time: string }>(entries: T[], limit = 3): T[] {
  return entries.map((entry, index) => ({ entry, index, time: explicitTimestamp(entry.time) })).sort((a, b) => a.time === undefined ? b.time === undefined ? a.index - b.index : 1 : b.time === undefined ? -1 : b.time - a.time || a.index - b.index).slice(0, limit).map(item => item.entry);
}
