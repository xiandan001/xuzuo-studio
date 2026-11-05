import type { Project } from '../types';
import type { QuoteBackupRecord } from '../quote-backup-types';
import { projectQuoteKey, readProjectQuote } from './project-quotes';
import type { ProjectQuote } from './project-quotes';
import { quoteWorkingKey, readQuoteWorkingDraft } from './quote-working-drafts';

type QuoteStorage = Pick<Storage, 'getItem'>;
function savedFromRaw(raw: string | null, workspaceId: string, projectId: string): ProjectQuote | null {
  if (raw === null) return null;
  const read = readProjectQuote({ getItem: () => raw, setItem: () => undefined }, workspaceId, projectId);
  if (read.error || !read.draft) throw Error('报价输入关联的正式版本无法核验，请先导出报价恢复稿，再创建内部备份。');
  return read.draft;
}
export function collectQuoteBackups(storage: QuoteStorage, projects: Pick<Project, 'id' | 'workspaceId' | 'purgedAt'>[]): QuoteBackupRecord[] {
  const records: QuoteBackupRecord[] = [];
  for (const project of projects) {
    if (project.purgedAt) continue;
    const saved = readProjectQuote({ getItem: key => storage.getItem(key), setItem: () => undefined }, project.workspaceId, project.id);
    const working = readQuoteWorkingDraft({ getItem: key => storage.getItem(key), setItem: () => undefined }, project.workspaceId, project.id);
    if (saved.error || working.error) throw Error(`“${project.id}”的报价记录未能读取，未创建缺失报价的备份。请先保留恢复稿并处理报价存储问题。`);
    if (!saved.draft && !working.draft) continue;
    const record: QuoteBackupRecord = { workspaceId: project.workspaceId, projectId: project.id, ...(saved.draft ? { saved: saved.draft } : {}) };
    if (working.draft) { const { baseSavedRaw, ...value } = working.draft; record.working = { ...value, baseSaved: savedFromRaw(baseSavedRaw, project.workspaceId, project.id), baseSavedMatchesCurrent: baseSavedRaw === saved.raw }; }
    records.push(record);
  }
  return records;
}

export interface QuoteRestoreWrite { key: string; value: string; projectId: string; }
export function quoteRestorationWrites(records: QuoteBackupRecord[] | undefined, projects: Pick<Project, 'id' | 'workspaceId' | 'purgedAt'>[]): QuoteRestoreWrite[] {
  if (records === undefined) return [];
  if (!Array.isArray(records) || records.length > projects.length) throw Error('备份报价清单数量无效。');
  const writes: QuoteRestoreWrite[] = [], seen = new Set<string>();
  for (const record of records) {
    const project = projects.find(project => project.id === record.projectId && project.workspaceId === record.workspaceId), identity = `${record.workspaceId}\0${record.projectId}`;
    if (!project || project.purgedAt || seen.has(identity) || !record.saved && !record.working) throw Error('备份报价归属或重复记录无效。'); seen.add(identity);
    const savedRaw = record.saved ? JSON.stringify(record.saved) : null;
    savedFromRaw(savedRaw, record.workspaceId, record.projectId);
    if (savedRaw) writes.push({ key: projectQuoteKey(record.workspaceId, record.projectId), value: savedRaw, projectId: record.projectId });
    if (record.working) {
      const { baseSaved, baseSavedMatchesCurrent, ...value } = record.working;
      if (typeof baseSavedMatchesCurrent !== 'boolean' || Object.hasOwn(value, 'baseSavedRaw')) throw Error('备份临时报价的版本基线无效。');
      let baseSavedRaw = baseSaved === null ? null : JSON.stringify(baseSaved); savedFromRaw(baseSavedRaw, record.workspaceId, record.projectId);
      if (baseSavedMatchesCurrent) { if (baseSavedRaw !== savedRaw) throw Error('备份报价的正式版本与基线不一致。'); baseSavedRaw = savedRaw; }
      else if (baseSavedRaw === savedRaw) { if (baseSavedRaw === null) throw Error('备份报价的空版本基线状态无效。'); baseSavedRaw = `${baseSavedRaw}\n`; }
      const raw = JSON.stringify({ ...value, baseSavedRaw });
      const checked = readQuoteWorkingDraft({ getItem: () => raw, setItem: () => undefined }, record.workspaceId, record.projectId);
      if (checked.error || !checked.draft) throw Error('备份临时报价内容无效。');
      writes.push({ key: quoteWorkingKey(record.workspaceId, record.projectId), value: raw, projectId: record.projectId });
    }
  }
  return writes;
}
