import type { BusinessOrder } from '../business-types';
import type { ArtifactMetadata } from '../live-types';

export function businessReplacementSelection(order: BusinessOrder, replacedId: string, output: ArtifactMetadata[]) {
  const ids = output.filter(file => file.kind === 'image' && file.mimeType === 'image/png' && !file.trashedAt && !file.unavailable).map(file => file.id);
  if (!ids.length) return undefined;
  const task = order.tasks.find(item => item.operation === 'compose' && item.artifactIds.includes(replacedId));
  return { taskId: task?.id, ids: [...new Set([...(task?.artifactIds || order.outputIds).filter(id => id !== replacedId), ...ids])] };
}
