import type { QuoteFields, QuoteMode, QuoteStoreSource } from './project-quotes';
import { validQuoteFields } from './project-quotes';
import { validCustomerQuoteInfo } from './customer-quote';
import type { CustomerQuoteInfo } from './customer-quote';
export interface QuoteWorkingDraft { type: 'xuzuo-quote-working'; version: 1; workspaceId: string; projectId: string; inputs: QuoteFields; mode: QuoteMode; scope: 'live' | 'simulation'; customer: CustomerQuoteInfo; baseSavedRaw: string | null; updatedAt: string; }
export const quoteWorkingKey = (workspaceId: string, projectId: string) => `xuzuo-project-quote-working-v1:${encodeURIComponent(workspaceId)}:${encodeURIComponent(projectId)}`;
export function readQuoteWorkingDraft(source: QuoteStoreSource, workspaceId: string, projectId: string): { raw: string | null; draft?: QuoteWorkingDraft; error?: string } {
  let raw: string | null = null;
  try {
    const storage = typeof source === 'function' ? source() : source; raw = storage.getItem(quoteWorkingKey(workspaceId, projectId));
    if (raw === null) return { raw };
    const value = JSON.parse(raw);
    if (!value || value.type !== 'xuzuo-quote-working' || value.version !== 1 || value.workspaceId !== workspaceId || value.projectId !== projectId || !validQuoteFields(value.inputs) || !validCustomerQuoteInfo(value.customer) || !['single', 'repeat'].includes(value.mode) || !['live', 'simulation'].includes(value.scope) || value.baseSavedRaw !== null && typeof value.baseSavedRaw !== 'string' || typeof value.updatedAt !== 'string') throw Error('invalid');
    return { raw, draft: value };
  } catch { return { raw, error: '临时报价草稿未能读取，原记录已保留。请先导出当前输入，再重新读取。' }; }
}
export function saveQuoteWorkingDraft(source: QuoteStoreSource, value: QuoteWorkingDraft, expectedRaw: string | null): string {
  if (!value.workspaceId || !value.projectId || !validQuoteFields(value.inputs) || !validCustomerQuoteInfo(value.customer) || !['single', 'repeat'].includes(value.mode) || !['live', 'simulation'].includes(value.scope)) throw Error('报价输入超出可保存范围，请缩短内容；当前输入仍保留。');
  const storage = typeof source === 'function' ? source() : source, previous = readQuoteWorkingDraft(storage, value.workspaceId, value.projectId);
  if (previous.error) throw Error(previous.error);
  if (previous.raw !== expectedRaw) throw Error('临时报价草稿已在另一窗口改变，当前输入仍保留。请先导出恢复稿，再读取最新草稿。');
  const raw = JSON.stringify(value); storage.setItem(quoteWorkingKey(value.workspaceId, value.projectId), raw); return raw;
}
