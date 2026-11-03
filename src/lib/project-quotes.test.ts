import { describe, expect, it } from 'vitest';
import { projectQuoteKey, readProjectQuote, saveProjectQuote, unassignedQuotes } from './project-quotes';
import type { ProjectQuote, QuoteFields, QuoteStore } from './project-quotes';
const fields: QuoteFields = { minutes: '12', rate: '60', remaining: '0', other: '0', reserve: '3', fee: '10', profit: '50', price: '19.90', variable: '0' };
const quote = (projectId: string): ProjectQuote => ({ type: 'xuzuo-project-quote', version: 1, workspaceId: 'workspace', projectId, project: projectId, inputs: { ...fields }, mode: 'single', scope: 'live', savedAt: '2026-11-01T00:00:00Z' });
function fixture() { const values = new Map<string, string>(); const storage: QuoteStore = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } }; return { values, storage }; }
describe('项目独立报价存储', () => {
  it('客户甲乙与其他工作区独立保存，保存和读取不更改原项目目标', () => {
    const { storage } = fixture();
    const a = quote('a'), b = { ...quote('b'), inputs: { ...fields, minutes: '88' } }, other = { ...quote('a'), workspaceId: 'other' };
    saveProjectQuote(storage, a, null); saveProjectQuote(storage, b, null); saveProjectQuote(storage, other, null);
    expect(readProjectQuote(storage, 'workspace', 'a').draft).toEqual(a);
    expect(readProjectQuote(storage, 'workspace', 'b').draft).toEqual(b);
    expect(readProjectQuote(storage, 'other', 'a').draft).toEqual(other);
    expect(projectQuoteKey('a:b', 'c')).not.toBe(projectQuoteKey('a', 'b:c'));
  });
  it('旧工作区和旧全局报价仅作为未分配来源，读取不迁移、不覆盖，导入后旧原串不变', () => {
    const { storage, values } = fixture(); const old = JSON.stringify({ type: 'xuzuo-ui-prototype-quote', workspaceId: 'workspace', projectId: 'a', project: '旧客户名', inputs: fields, mode: 'single', scope: 'live' });
    values.set('xuzuo-prototype-last-quote:workspace', old);
    expect(readProjectQuote(storage, 'workspace', 'a').draft).toBeUndefined();
    expect(unassignedQuotes(storage, 'workspace')).toMatchObject([{ projectName: '旧客户名', inputs: fields }]);
    saveProjectQuote(storage, { ...quote('b'), inputs: unassignedQuotes(storage, 'workspace')[0].inputs! }, null);
    expect(values.get('xuzuo-prototype-last-quote:workspace')).toBe(old);
    expect(readProjectQuote(storage, 'workspace', 'a').draft).toBeUndefined();
    expect(readProjectQuote(storage, 'workspace', 'b').draft?.projectId).toBe('b');
  });
  it('损坏或跨项目草稿不能覆盖，写失败和并发变化保留原始内容', () => {
    const { storage, values } = fixture(), key = projectQuoteKey('workspace', 'a');
    for (const raw of ['{bad', JSON.stringify(quote('b'))]) {
      values.set(key, raw); const read = readProjectQuote(storage, 'workspace', 'a'); expect(read.error).toBeTruthy();
      expect(() => saveProjectQuote(storage, quote('a'), raw)).toThrow(); expect(values.get(key)).toBe(raw);
    }
    values.delete(key); const first = saveProjectQuote(storage, quote('a'), null);
    const second = saveProjectQuote(storage, { ...quote('a'), inputs: { ...fields, reserve: '99' } }, first);
    expect(() => saveProjectQuote(storage, quote('a'), first)).toThrow('另一处变化');
    expect(values.get(key)).toBe(second);
    const denied = { ...storage, setItem: () => { throw new Error('quota'); } };
    expect(() => saveProjectQuote(denied, quote('a'), second)).toThrow('quota'); expect(values.get(key)).toBe(second);
    expect(readProjectQuote(() => { throw new Error('denied'); }, 'workspace', 'a').error).toBeTruthy();
  });
});
