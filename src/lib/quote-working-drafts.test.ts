import { describe, expect, it } from 'vitest';
import { quoteWorkingKey, readQuoteWorkingDraft, saveQuoteWorkingDraft } from './quote-working-drafts';
import type { QuoteWorkingDraft } from './quote-working-drafts';
import { projectQuoteKey, readProjectQuote, saveProjectQuote } from './project-quotes';
import { emptyCustomerQuote } from './customer-quote';
const inputs = { minutes: '30', rate: '60', remaining: '0', other: '0', reserve: '5', fee: '3.25', profit: '20', price: '19.90', variable: '0' };
const draft = (workspaceId = 'w', projectId = 'p'): QuoteWorkingDraft => ({ type: 'xuzuo-quote-working', version: 1, workspaceId, projectId, inputs, mode: 'single', scope: 'live', customer: { ...emptyCustomerQuote(), scope: '交付12页PPT' }, baseSavedRaw: null, updatedAt: '2026-11-03' });
function fixture() { const values = new Map<string, string>(); return { values, storage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } } }; }
describe('临时报价输入与正式报价分开保护', () => {
  it('临时输入可恢复且按项目/工作区隔离，不写正式记录和费用', () => {
    const { values, storage } = fixture(); values.set('ledger', '{"paid":17}');
    saveQuoteWorkingDraft(storage, draft(), null); saveQuoteWorkingDraft(storage, { ...draft('w', 'q'), inputs: { ...inputs, minutes: '80' }, scope: 'simulation' }, null);
    expect(readQuoteWorkingDraft(storage, 'w', 'p').draft?.inputs.minutes).toBe('30'); expect(readQuoteWorkingDraft(storage, 'w', 'q').draft?.scope).toBe('simulation');
    expect(readQuoteWorkingDraft(storage, 'other', 'p').draft).toBeUndefined(); expect(readProjectQuote(storage, 'w', 'p').raw).toBeNull(); expect(values.get('ledger')).toBe('{"paid":17}');
  });
  it('并发临时输入、损坏和身份不匹配均不覆盖', () => {
    const { values, storage } = fixture(), key = quoteWorkingKey('w', 'p');
    const first = saveQuoteWorkingDraft(storage, draft(), null), second = saveQuoteWorkingDraft(storage, { ...draft(), inputs: { ...inputs, minutes: '45' } }, first);
    expect(() => saveQuoteWorkingDraft(storage, draft(), first)).toThrow('另一窗口'); expect(values.get(key)).toBe(second);
    for (const raw of ['{bad', JSON.stringify(draft('other'))]) { values.set(key, raw); expect(readQuoteWorkingDraft(storage, 'w', 'p').error).toBeTruthy(); expect(() => saveQuoteWorkingDraft(storage, draft(), raw)).toThrow(); expect(values.get(key)).toBe(raw); }
  });
  it('正式报价变更后仍不能用旧临时输入绕过正式CAS', () => {
    const { values, storage } = fixture(), quote = { type: 'xuzuo-project-quote' as const, version: 1 as const, workspaceId: 'w', projectId: 'p', inputs, mode: 'single' as const, scope: 'live' as const, savedAt: '2026-11-03' };
    const first = saveProjectQuote(storage, quote, null); saveQuoteWorkingDraft(storage, { ...draft(), baseSavedRaw: first }, null);
    const newer = saveProjectQuote(storage, { ...quote, inputs: { ...inputs, rate: '99' } }, first);
    expect(() => saveProjectQuote(storage, quote, readQuoteWorkingDraft(storage, 'w', 'p').draft!.baseSavedRaw)).toThrow('另一处'); expect(values.get(projectQuoteKey('w', 'p'))).toBe(newer);
  });
  it('拒绝过长新输入且写入失败保留原串', () => {
    const { values, storage } = fixture(), key = quoteWorkingKey('w', 'p');
    expect(() => saveQuoteWorkingDraft(storage, { ...draft(), inputs: { ...inputs, minutes: '1'.repeat(65) } }, null)).toThrow('范围'); expect(values.has(key)).toBe(false);
    const original = saveQuoteWorkingDraft(storage, draft(), null);
    expect(() => saveQuoteWorkingDraft({ ...storage, setItem: () => { throw Error('disk full'); } }, draft(), original)).toThrow('disk full'); expect(values.get(key)).toBe(original);
  });
});
