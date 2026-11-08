import type { BusinessOrder, BusinessRecipe } from '../business-types';
import type { ArtifactMetadata } from '../live-types';
import { newBusinessState } from '../lib/business-data';
import { newBusinessOrderDefaults } from '../lib/business-production';

// Synthetic state shared by renderer tests and the isolated browser fixture; no customer data or secrets.
export const time = '2026-11-08T00:00:00Z';
export function order(id: string, recipe: BusinessRecipe = 'documents', extra: Partial<BusinessOrder> = {}): BusinessOrder {
  return { ...newBusinessOrderDefaults(recipe), id, name: `制作单${id}`, recipe, sourceProjectId: `project-${id}`, brief: '基于已确认资料制作，参数不能编造。', productIds: [], projectIds: [`project-${id}`], runIds: [], outputIds: [], status: 'draft', factsRevision: 1, facts: { 目标与受众: '已有客户' }, tasks: [], bindings: {}, createdAt: time, updatedAt: time, ...extra };
}
export function artifact(id: string, projectId: string, extra: Partial<ArtifactMetadata> = {}): ArtifactMetadata {
  return { id, projectId, name: `${id}.pptx`, mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', kind: 'office', bytes: 1024, path: `managed/${id}.pptx`, createdAt: time, ...extra };
}
export function seeded(workspaceId: string, orders: BusinessOrder[]) { return { ...newBusinessState(workspaceId), orders }; }
