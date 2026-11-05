import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { collectQuoteBackups, quoteRestorationWrites } from './quote-backup';
import { projectQuoteKey, readProjectQuote, saveProjectQuote } from './project-quotes';
import { quoteWorkingKey, readQuoteWorkingDraft, saveQuoteWorkingDraft } from './quote-working-drafts';
import { emptyCustomerQuote } from './customer-quote';
import type { QuoteBackupRecord } from '../quote-backup-types';
const require = createRequire(import.meta.url), { remap } = require('../../electron/backup-format.cjs'), { validateQuoteBackups } = require('../../electron/quote-backup.cjs');
const project = { id: 'p', workspaceId: 'w' }, inputs = { minutes: '30', rate: '60', remaining: '0', other: '0', reserve: '5', fee: '10', profit: '20', price: '19.9', variable: '0' };
const saved = { type: 'xuzuo-project-quote' as const, version: 1 as const, workspaceId: 'w', projectId: 'p', inputs, mode: 'single' as const, scope: 'live' as const, savedAt: '2026-11-03', pendingCostEntryIds: ['fee-one'] };
function fixture() { const values = new Map<string, string>(), calls: string[] = []; return { values, calls, storage: { getItem: (key: string) => { calls.push(key); return values.get(key) ?? null; }, setItem: (key: string, value: string) => { values.set(key, value); } } }; }
describe('报价备份白名单与重绑', () => {
  it('仅读本项目两个报价键，不读凭证，结构化版本基线参与ID重绑', () => {
    const f = fixture(), original = saveProjectQuote(f.storage, saved, null); f.values.set('xuzuo-private-credentials', 'NEVER-EXPORT');
    saveQuoteWorkingDraft(f.storage, { type: 'xuzuo-quote-working', version: 1, workspaceId: 'w', projectId: 'p', inputs: { ...inputs, minutes: '45' }, mode: 'single', scope: 'live', customer: { ...emptyCustomerQuote(), scope: '12页PPT' }, baseSavedRaw: original, updatedAt: '2026-11-03' }, null);
    f.calls.length = 0; const records = collectQuoteBackups(f.storage, [project]);
    expect(new Set(f.calls)).toEqual(new Set([projectQuoteKey('w', 'p'), quoteWorkingKey('w', 'p')])); expect(JSON.stringify(records)).not.toContain('baseSavedRaw'); expect(JSON.stringify(records)).not.toContain('NEVER-EXPORT');
    const restored: QuoteBackupRecord[] = remap(records, { w: 'new-w', p: 'new-p', 'fee-one': 'new-fee' }); validateQuoteBackups(restored, [{ id: 'new-p', workspaceId: 'new-w' }]);
    const writes = quoteRestorationWrites(restored, [{ id: 'new-p', workspaceId: 'new-w' }]), target = fixture(); for (const write of writes) target.storage.setItem(write.key, write.value);
    const restoredSaved = readProjectQuote(target.storage, 'new-w', 'new-p'), restoredWorking = readQuoteWorkingDraft(target.storage, 'new-w', 'new-p');
    expect(restoredSaved.draft?.pendingCostEntryIds).toEqual(['new-fee']); expect(restoredWorking.draft?.inputs.minutes).toBe('45'); expect(restoredWorking.draft?.baseSavedRaw).toBe(restoredSaved.raw); expect(f.values.get(projectQuoteKey('w', 'p'))).toBe(original);
  });
  it('源正式版本已变化或仅原串格式变化，恢复后仍保持CAS冲突而非静默重置基线', () => {
    for (const formatOnly of [false, true]) {
      const f = fixture(), first = saveProjectQuote(f.storage, saved, null);
      saveQuoteWorkingDraft(f.storage, { type: 'xuzuo-quote-working', version: 1, workspaceId: 'w', projectId: 'p', inputs, mode: 'single', scope: 'live', customer: emptyCustomerQuote(), baseSavedRaw: first, updatedAt: '2026-11-03' }, null);
      f.values.set(projectQuoteKey('w', 'p'), formatOnly ? `${first}\n` : JSON.stringify({ ...saved, inputs: { ...inputs, rate: '99' } }));
      const records = collectQuoteBackups(f.storage, [project]); expect(records[0].working?.baseSavedMatchesCurrent).toBe(false);
      const target = fixture(); for (const write of quoteRestorationWrites(records, [project])) target.storage.setItem(write.key, write.value);
      expect(readQuoteWorkingDraft(target.storage, 'w', 'p').draft?.baseSavedRaw).not.toBe(readProjectQuote(target.storage, 'w', 'p').raw);
    }
  });
  it('旧备份无报价字段兼容，损坏或外区/重复记录在写入前拒绝', () => {
    expect(quoteRestorationWrites(undefined, [project])).toEqual([]); const record = { workspaceId: 'w', projectId: 'p', saved };
    expect(() => quoteRestorationWrites([record, record], [project, { id: 'q', workspaceId: 'w' }])).toThrow(); expect(() => validateQuoteBackups([{ ...record, workspaceId: 'foreign' }], [project])).toThrow();
    const f = fixture(); f.values.set(quoteWorkingKey('w', 'p'), '{broken'); expect(() => collectQuoteBackups(f.storage, [project])).toThrow('报价记录未能读取'); expect(f.values.get(quoteWorkingKey('w', 'p'))).toBe('{broken');
  });
});
