import { useMemo } from 'react';
import type { LedgerEntry, Project } from '../types';
import { scopeWorkspace } from '../lib/workspace-state';

export function workspaceOwnerKey(projects: readonly Project[], workspaceId: string): string {
  return JSON.stringify(projects.filter(project => project.workspaceId === workspaceId).map(project => project.id).sort());
}
export function ledgerForOwners(ledger: LedgerEntry[], ownerKey: string): LedgerEntry[] {
  const ids = new Set<string>(JSON.parse(ownerKey));
  return ledger.filter(entry => ids.has(entry.projectId));
}
export function useWorkspaceProjection(projects: Project[], allLedger: LedgerEntry[], workspaceId: string) {
  const scoped = useMemo(() => scopeWorkspace(projects, [], workspaceId), [projects, workspaceId]);
  const owners = useMemo(() => workspaceOwnerKey(projects, workspaceId), [projects, workspaceId]);
  const ledger = useMemo(() => ledgerForOwners(allLedger, owners), [allLedger, owners]);
  return { projects: scoped.projects, trashedProjects: scoped.trashedProjects, ledger };
}
