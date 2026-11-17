// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { BACKUP_SOURCE_SAVED_EVENT } from './backup-change-events';
import { writeWorkspaceState, WORKSPACE_STORAGE_KEY } from './workspace-persistence';
import { writeStoredConfiguration, CONFIGURATION_KEY } from './configuration-storage';
import { saveProjectQuote } from './project-quotes';
import { saveQuoteWorkingDraft } from './quote-working-drafts';
import { emptyCustomerQuote } from './customer-quote';
import { readPersistedBackupMeta } from '../hooks/useDataManagement';
import type { WorkspaceState } from './workspace-state';
import type { ConfigurationState } from './configuration';

const state = (): WorkspaceState => ({ workspaces: [{ id: 'one', name: '已保存工作区', description: '', createdAt: '2026-11-17T00:00:00Z' }], activeWorkspaceId: 'one', projects: [], ledger: [], customPrompts: [], preferencesByWorkspace: {} });
const configuration = (): ConfigurationState => ({ connections: [], models: [], workflows: [], categories: [], studioActions: [], useTemplates: [] });
const fields = { minutes: '1', rate: '60', remaining: '0', other: '0', reserve: '0', fee: '0', profit: '1', price: '1', variable: '0' };
const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).forEach(action => action()); vi.unstubAllGlobals(); });
function events() { const seen: unknown[] = [], listener = (event: Event) => seen.push((event as CustomEvent).detail); window.addEventListener(BACKUP_SOURCE_SAVED_EVENT, listener); cleanup.push(() => window.removeEventListener(BACKUP_SOURCE_SAVED_EVENT, listener)); return seen; }
function memory() { const values = new Map<string, string>(); return { values, getItem: vi.fn((key: string) => values.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { values.set(key, value); }) }; }

it('成功保存后只通知scope，不把正文、凭证或报价内容放进事件', () => {
  const storage = memory(), seen = events(); expect(writeWorkspaceState(storage, state())).toBeUndefined(); expect(writeStoredConfiguration(storage, configuration()).issue).toBeUndefined();
  saveProjectQuote(storage, { type: 'xuzuo-project-quote', version: 1, workspaceId: 'one', projectId: 'p', inputs: fields, mode: 'single', scope: 'live', savedAt: '2026-11-17', customer: 'PRIVATE_CONTENT' }, null);
  saveQuoteWorkingDraft(storage, { type: 'xuzuo-quote-working', version: 1, workspaceId: 'one', projectId: 'p', inputs: fields, mode: 'single', scope: 'live', customer: emptyCustomerQuote(), baseSavedRaw: null, updatedAt: '2026-11-17' }, null);
  expect(seen).toEqual([{}, {}, { workspaceId: 'one' }, { workspaceId: 'one' }]); expect(JSON.stringify(seen)).not.toContain('PRIVATE_CONTENT');
});
it('失败的写入不发成功通知，原已存索引不替换成未保存内存内容', () => {
  const storage = memory(), saved = state(); storage.values.set(WORKSPACE_STORAGE_KEY, JSON.stringify(saved)); storage.values.set(CONFIGURATION_KEY, JSON.stringify(configuration()));
  const seen = events(); storage.setItem.mockImplementation(() => { throw Error('quota'); });
  const changed = { ...saved, workspaces: [{ ...saved.workspaces[0], name: '未保存的输入' }] };
  expect(writeWorkspaceState(storage, changed)?.kind).toBe('write'); expect(writeStoredConfiguration(storage, configuration()).issue?.kind).toBe('write');
  expect(seen).toEqual([]); expect(readPersistedBackupMeta(storage, 'one').workspaces[0].name).toBe('已保存工作区');
});
it('空索引、损坏索引和未保存错误阻止自动快照，不用默认工作区冒充原数据', () => {
  const storage = memory(); expect(() => readPersistedBackupMeta(storage, 'one')).toThrow('尚未保存');
  storage.values.set(WORKSPACE_STORAGE_KEY, '{bad'); expect(() => readPersistedBackupMeta(storage, 'one')).toThrow('暂时无法读取');
  storage.getItem.mockClear(); expect(() => readPersistedBackupMeta(storage, 'one', { kind: 'write', message: 'quota', canExportOriginal: true })).toThrow('尚未成功保存'); expect(storage.getItem).not.toHaveBeenCalled();
});
