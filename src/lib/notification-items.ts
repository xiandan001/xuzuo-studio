import type { LedgerEntry } from '../types';

export function recentNotificationItems(ledger: LedgerEntry[], workspaceId: string, projectIds: Set<string>) {
  const selected: { key: string; entry: LedgerEntry; time: number }[] = [];
  for (const entry of ledger) {
    if (entry.workspaceId !== undefined ? entry.workspaceId !== workspaceId : !projectIds.has(entry.projectId)) continue;
    const key = entry.scope === 'chat' && entry.conversationId ? 'chat:' + entry.conversationId : entry.workflowRunId ? 'run:' + entry.workflowRunId : 'entry:' + entry.id;
    const time = Date.parse(entry.time) || 0, existing = selected.findIndex(item => item.key === key);
    if (existing >= 0) { if (selected[existing].time > time) continue; selected.splice(existing, 1); }
    if (selected.length === 4 && selected[3].time > time) continue;
    selected.push({ key, entry, time }); selected.sort((a, b) => b.time - a.time); selected.length = Math.min(4, selected.length);
  }
  return selected;
}
