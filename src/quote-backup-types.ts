import type { ProjectQuote } from './lib/project-quotes';
import type { QuoteWorkingDraft } from './lib/quote-working-drafts';
export interface QuoteBackupRecord {
  workspaceId: string;
  projectId: string;
  saved?: ProjectQuote;
  working?: Omit<QuoteWorkingDraft, 'baseSavedRaw'> & { baseSaved: ProjectQuote | null; baseSavedMatchesCurrent: boolean };
}
