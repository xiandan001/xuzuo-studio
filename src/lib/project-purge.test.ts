import { describe, expect, it } from 'vitest';
import { clearPurgedProjectDrafts, clearPurgedProjectsDrafts, nativeProjectPurgeAudits, projectPurgeChunks, purgeResultCounts } from './project-purge';
import { scopeWorkspace } from './workspace-state';
import { projectQuoteKey } from './project-quotes';
import { quoteWorkingKey } from './quote-working-drafts';
import type { ProjectPurgeItem } from '../project-purge-types';
import type { LedgerEntry } from '../types';

const audit = (changes: Partial<ProjectPurgeItem> = {}): ProjectPurgeItem => ({ projectId: 'target', workspaceId: 'one', name: '目标', kind: 'word', trashedAt: '2026-11-04T00:00:00Z', purgedAt: '2026-11-04T01:00:00Z', updatedAt: '2026-11-04T00:00:00Z', costCents: 137, requestId: 'request', recordPurged: true, filesDeleted: false, folderMissing: false, filesPending: false, retryable: false, ...changes });
describe('永久移除前端审计和草稿清理', () => {
  it('仅清除目标项目明确的草稿/报价键，不匹配相邻ID，不删除费用、对话、密钥或派发回执', () => {
    const removed = ['xuzuo.document.target', 'xuzuo.document-studio-form.target', 'xuzuo-image-draft-v1-target', 'xuzuo.spreadsheet-form.target', 'xuzuo.editor-recovery.target', 'xuzuo.editor-conflict-recovery.target', 'xuzuo.spreadsheet-recovery.target', 'xuzuo.spreadsheet-conflict.target', 'xuzuo.editor-recovery.target.invalid.123', 'xuzuo.spreadsheet-conflict.target.1793774400000', projectQuoteKey('one', 'target'), quoteWorkingKey('one', 'target')];
    const retained = ['xuzuo.document.target-longer', 'xuzuo.editor-recovery.target2', 'xuzuo.spreadsheet-conflict.target2.1793774400000', 'xuzuo.spreadsheet-conflict.target.unrelated', 'xuzuo-ui-prototype-v2', 'xuzuo-home-chat-v1:one', 'xuzuo-dispatch-receipt:target', 'xuzuo-configuration-v1', 'encrypted-key-target', projectQuoteKey('other', 'target')];
    const values = new Map([...removed, ...retained].map(key => [key, `keep:${key}`]));
    const storage = { get length() { return values.size; }, key: (index: number) => [...values.keys()][index] || null, removeItem: (key: string) => { values.delete(key); } };
    expect(clearPurgedProjectDrafts(storage, { id: 'target', workspaceId: 'one' })).toBe(true);
    expect([...values.keys()]).toEqual(retained); expect([...values.values()]).toEqual(retained.map(key => `keep:${key}`));
    expect(clearPurgedProjectDrafts(storage, { id: 'target', workspaceId: 'one' })).toBe(true);
  });
  it('一个草稿清理失败仍继续清理其他目标草稿，保留失败原文并报告失败', () => {
    const values = new Map([['xuzuo.document.target', 'body'], ['xuzuo.editor-recovery.target', 'recovery']]);
    expect(clearPurgedProjectDrafts({ get length() { return values.size; }, key: index => [...values.keys()][index], removeItem: key => { if (key.includes('document')) throw Error('denied'); values.delete(key); } }, { id: 'target', workspaceId: 'one' })).toBe(false);
    expect([...values]).toEqual([['xuzuo.document.target', 'body']]);
    expect(clearPurgedProjectDrafts({ get length(): number { throw Error('storage denied'); }, key: () => null, removeItem: () => undefined }, { id: 'target', workspaceId: 'one' })).toBe(false);
  });
  it('Native审计无本地项目时仍插入费用归属，不把目录与清理错误恢复为作品内容', () => {
    const records = nativeProjectPurgeAudits([audit({ directory: 'D:/owned/private', cleanupDirectory: 'D:/owned/quarantine', error: 'locked', filesPending: true }), audit({ projectId: 'failed', recordPurged: false, purgedAt: undefined })]);
    const ledger = [{ id: 'fee', projectId: 'target', costCents: 137 }] as LedgerEntry[];
    expect(records).toHaveLength(1); expect(records[0]).toMatchObject({ id: 'target', workspaceId: 'one', description: '', costCents: 137 });
    expect(records[0]).not.toHaveProperty('directory'); expect(records[0]).not.toHaveProperty('error');
    expect(scopeWorkspace(records, ledger, 'one')).toEqual({ projects: [], trashedProjects: [], ledger });
    expect(scopeWorkspace(records, ledger, 'other').ledger).toEqual([]);
  });
  it('批量清理只枚举一遍存储键，不按项目重复扫描整个存储', () => {
    const values = new Map([['xuzuo.document.target', 'first'], ['xuzuo.document.second', 'second'], ['xuzuo.document.neighbor', 'keep']]);
    let reads = 0;
    expect(clearPurgedProjectsDrafts({ get length() { return values.size; }, key: index => { reads++; return [...values.keys()][index]; }, removeItem: key => { values.delete(key); } }, [{ id: 'target', workspaceId: 'one' }, { id: 'second', workspaceId: 'one' }])).toBe(true);
    expect(reads).toBe(3); expect([...values]).toEqual([['xuzuo.document.neighbor', 'keep']]);
  });
  it('批次分割保持完整范围与原顺序，部分失败统计不冒充已删除文件', () => {
    const ids = Array.from({ length: 237 }, (_, index) => `project-${index}`), chunks = projectPurgeChunks(ids);
    expect(chunks.map(chunk => chunk.length)).toEqual([100, 100, 37]); expect(chunks.flat()).toEqual(ids); expect(projectPurgeChunks([])).toEqual([]);
    expect(purgeResultCounts([audit(), audit({ filesDeleted: true }), audit({ filesPending: true }), audit({ recordPurged: false, purgedAt: undefined })])).toEqual({ removed: 3, filesDeleted: 1, pending: 1, failed: 1 });
  });
});
