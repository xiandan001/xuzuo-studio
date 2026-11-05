import type { Project } from '../types';

export function automationProjectAvailability(workspaceId: string, projects: readonly Project[], audits: readonly Project[] | undefined, targetId: string | undefined, billingOwnerId: string | undefined) {
  const find = (id: string | undefined) => id ? audits?.find(project => project.id === id && project.workspaceId === workspaceId && project.purgedAt) || projects.find(project => project.id === id && project.workspaceId === workspaceId && project.purgedAt) : undefined;
  return { targetPurged: find(targetId), billingOwnerPurged: find(billingOwnerId) };
}
