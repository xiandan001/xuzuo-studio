import type { WorkflowRun } from '../configuration-types';
import type { ArtifactMetadata } from '../live-types';
import { projectFiles } from './project-files';
import type { ProjectFileItem } from './project-files';

export function mergeProjectInventory(projectId: string, provided: ArtifactMetadata[], inventory: ArtifactMetadata[], trash?: ArtifactMetadata[]): ArtifactMetadata[] {
  const files = new Map<string, ArtifactMetadata>();
  for (const item of provided) if (item.projectId === projectId) files.set(item.id, item);
  for (const item of inventory) {
    if (item.projectId !== projectId) continue;
    const previous = files.get(item.id);
    files.set(item.id, { ...previous, ...item, unavailable: item.unavailable, unavailableReason: item.unavailableReason, trashedAt: item.trashedAt || (trash === undefined ? previous?.trashedAt : undefined) });
  }
  for (const item of trash || []) if (item.projectId === projectId) files.set(item.id, { ...files.get(item.id), ...item });
  return [...files.values()];
}
export function projectInventoryFiles(runs: WorkflowRun[], projectId: string, inventory: ArtifactMetadata[], trash?: ArtifactMetadata[]): ProjectFileItem[] {
  const linked = projectFiles(runs, projectId, trash), sources = new Map(linked.map(item => [item.artifact.id, item]));
  const recycled = new Set((trash || []).map(item => item.id));
  return mergeProjectInventory(projectId, linked.map(item => item.artifact), inventory, trash).map(artifact => {
    const known = sources.get(artifact.id);
    if (artifact.trashedAt || recycled.has(artifact.id)) return { artifact, group: 'trash', description: artifact.unavailableReason || '已移入回收站，恢复后可使用；费用记录保留。' };
    if (known) return { ...known, artifact, description: artifact.unavailableReason || known.description };
    return { artifact, group: artifact.kind === 'image' ? 'image' : artifact.kind === 'office' ? 'office' : artifact.kind === 'text' ? 'text' : 'other', description: artifact.unavailableReason || (artifact.kind === 'office' ? '未关联编辑版本，请打开实际文件核对。' : '本地登记文件，未关联运行记录。') };
  });
}
