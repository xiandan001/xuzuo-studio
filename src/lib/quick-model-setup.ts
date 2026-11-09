import type { ModelConnection } from '../configuration-types';
import { MODEL_CATALOG, catalogConnectionDraft, catalogConnectionMatches } from '../model-catalog';
import type { ModelCatalogEntry } from '../model-catalog';

export function quickSetupEntries(providerId: string, baseUrl?: string): ModelCatalogEntry[] {
  return MODEL_CATALOG.filter(entry => {
    if (entry.providerId !== providerId || !entry.support.ready || entry.status === 'older' || baseUrl && entry.defaultBaseUrl !== baseUrl) return false;
    if (!entry.capabilities.some(capability => ['text', 'image-generation'].includes(capability))) return false;
    try { catalogConnectionDraft(entry); return true; } catch { return false; }
  });
}

export function quickSetupSites(providerId: string): { value: string; label: string }[] {
  const sites = new Map<string, string>();
  for (const entry of quickSetupEntries(providerId)) if (!sites.has(entry.defaultBaseUrl)) sites.set(entry.defaultBaseUrl, entry.region);
  return [...sites].map(([value, label]) => ({ value, label }));
}

export function quickSetupConnections(entries: ModelCatalogEntry[], connections: ModelConnection[]) {
  const selected: { connection: ModelConnection; entries: ModelCatalogEntry[]; create: boolean }[] = [];
  for (const entry of entries) {
    const grouped = selected.find(item => catalogConnectionMatches(entry, item.connection));
    if (grouped) { grouped.entries.push(entry); continue; }
    const existing = connections.find(connection => catalogConnectionMatches(entry, connection));
    const connection = existing || { ...catalogConnectionDraft(entry), id: `setup-${entry.id}`, status: 'configured' as const };
    selected.push({ connection, entries: [entry], create: !existing });
  }
  return selected;
}
