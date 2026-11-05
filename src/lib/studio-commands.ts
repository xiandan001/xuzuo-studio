import type { ProjectKind } from '../types';

export type StudioTool = 'ai' | 'assets' | 'format' | 'versions' | 'files' | 'delivery';
export interface StudioCommand { id: string; label: string; run: () => void; disabled?: boolean; }
export interface StudioToolRequest { workspaceId: string; projectId: string; tool: StudioTool; }
export const STUDIO_TOOL_EVENT = 'xuzuo:studio-tool';
export const STUDIO_TOOLS: StudioTool[] = ['ai', 'assets', 'format', 'versions', 'files', 'delivery'];
export const STUDIO_KIND_LABELS: Record<ProjectKind, string> = { word: 'Word 文档', ppt: 'PPT 演示', excel: 'Excel 表格', image: '图片创作' };

export function studioToolRequest(value: unknown, workspaceId: string, projectId: string): StudioTool | undefined {
  const item = value as Partial<StudioToolRequest> | undefined;
  return item?.workspaceId === workspaceId && item.projectId === projectId && STUDIO_TOOLS.includes(item.tool as StudioTool) ? item.tool as StudioTool : undefined;
}
/** UI-only request: opening a tool never starts generation, export or delivery. */
export function openStudioTool(request: StudioToolRequest): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(STUDIO_TOOL_EVENT, { detail: request }));
}
