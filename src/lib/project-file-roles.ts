import type { ArtifactMetadata } from '../live-types';
import type { ProjectKind } from '../types';

export type ProjectFileRole = 'adopted' | 'editing' | 'history';
export const PROJECT_FILE_ROLE_LABEL: Record<ProjectFileRole, string> = { adopted: '当前采用成品', editing: '正在编辑', history: '历史版本' };
export function isProjectDeliverable(file: ArtifactMetadata, kind: ProjectKind) {
  if (file.trashedAt || file.unavailable || file.bytes <= 0) return false;
  const extension = kind === 'word' ? /\.docx$/i : kind === 'ppt' ? /\.pptx$/i : /\.xlsx$/i;
  return kind === 'image' ? file.kind === 'image' && /^image\//.test(file.mimeType) : file.kind === 'office' && extension.test(file.name) && /officedocument/.test(file.mimeType);
}
export function projectCurrentFiles(files: ArtifactMetadata[], kind: ProjectKind, adoptedIds: string[], localOutputIds: string[] = []) {
  const deliverables = files.filter(file => isProjectDeliverable(file, kind));
  if (adoptedIds.length) return deliverables.filter(file => adoptedIds.includes(file.id));
  const local = deliverables.filter(file => localOutputIds.includes(file.id));
  if (local.length) return local;
  if (kind === 'image') return [];
  return [...deliverables].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 1);
}
