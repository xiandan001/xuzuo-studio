export interface QuoteFields { minutes: string; rate: string; remaining: string; other: string; reserve: string; fee: string; profit: string; price: string; variable: string; }
export type QuoteMode = 'single' | 'repeat';
export interface ProjectQuote {
  type: 'xuzuo-project-quote'; version: 1; workspaceId: string; projectId: string;
  inputs: QuoteFields; mode: QuoteMode; scope: 'live' | 'simulation'; savedAt: string;
  [key: string]: unknown;
}
export type QuoteStore = Pick<Storage, 'getItem' | 'setItem'>;
export type QuoteStoreSource = QuoteStore | (() => QuoteStore);
const fieldNames: (keyof QuoteFields)[] = ['minutes', 'rate', 'remaining', 'other', 'reserve', 'fee', 'profit', 'price', 'variable'];
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const inputsValid = (value: unknown): value is QuoteFields => object(value) && fieldNames.every(name => typeof value[name] === 'string' && value[name].length <= 64);
const store = (source: QuoteStoreSource) => typeof source === 'function' ? source() : source;
export const projectQuoteKey = (workspaceId: string, projectId: string) => `xuzuo-project-quote-v1:${encodeURIComponent(workspaceId)}:${encodeURIComponent(projectId)}`;
export interface QuoteRead { raw: string | null; draft?: ProjectQuote; error?: string; }
export function readProjectQuote(source: QuoteStoreSource, workspaceId: string, projectId: string): QuoteRead {
  let raw: string | null = null;
  try {
    raw = store(source).getItem(projectQuoteKey(workspaceId, projectId));
    if (raw === null) return { raw };
    const value = JSON.parse(raw);
    if (!object(value) || value.type !== 'xuzuo-project-quote' || value.version !== 1 || value.workspaceId !== workspaceId || value.projectId !== projectId || !inputsValid(value.inputs) || !['single', 'repeat'].includes(String(value.mode)) || !['live', 'simulation'].includes(String(value.scope)) || typeof value.savedAt !== 'string') throw new Error('invalid');
    return { raw, draft: value as ProjectQuote };
  } catch { return { raw, error: '当前项目报价草稿无法读取，原始记录已保留；请先导出当前参数，勿覆盖原记录。' }; }
}
export function saveProjectQuote(source: QuoteStoreSource, quote: ProjectQuote, expectedRaw: string | null): string {
  const storage = store(source), current = readProjectQuote(storage, quote.workspaceId, quote.projectId);
  if (current.error) throw new Error(current.error);
  if (current.raw !== expectedRaw) throw new Error('这个项目的报价已在另一处变化，请先读取已保存草稿；当前输入仍保留。');
  const raw = JSON.stringify(quote);
  storage.setItem(projectQuoteKey(quote.workspaceId, quote.projectId), raw);
  return raw;
}
export interface LegacyQuote { key: string; raw: string; inputs?: QuoteFields; mode?: QuoteMode; scope?: 'live' | 'simulation'; projectName?: string; error?: string; }
export function unassignedQuotes(source: QuoteStoreSource, workspaceId: string): LegacyQuote[] {
  const result: LegacyQuote[] = [];
  try {
    const storage = store(source), keys = [`xuzuo-prototype-last-quote:${workspaceId}`, ...(workspaceId === 'workspace-personal' ? ['xuzuo-prototype-last-quote'] : [])];
    for (const key of keys) {
      const raw = storage.getItem(key); if (raw === null) continue;
      try {
        const value = JSON.parse(raw);
        if (!object(value) || value.type !== 'xuzuo-ui-prototype-quote' || !inputsValid(value.inputs) || value.workspaceId && value.workspaceId !== workspaceId) throw new Error('invalid');
        result.push({ key, raw, inputs: value.inputs, mode: value.mode === 'repeat' ? 'repeat' : 'single', scope: value.scope === 'live' || value.simulated === false ? 'live' : 'simulation', projectName: typeof value.project === 'string' ? value.project : undefined });
      } catch { result.push({ key, raw, error: '这份旧报价无法读取，原始记录已保留。' }); }
    }
  } catch { /* Project-specific storage reports its own access error. */ }
  return result;
}
