import { describe, expect, it } from 'vitest';
import { mergeBackupImport, persistBackupImport, relocatedWorkspaceState } from './data-management';
import { initialConfiguration } from './configuration';
import { CONFIGURATION_KEY } from './configuration-storage';
import { WORKSPACE_STORAGE_KEY } from './workspace-persistence';
import { INITIAL_PREFERENCES } from '../data';
import type { WorkspaceState } from './workspace-state';
import type { BackupImportResult } from '../data-management-types';
import { projectQuoteKey, readProjectQuote } from './project-quotes';
import { quoteWorkingKey, readQuoteWorkingDraft } from './quote-working-drafts';
import { emptyCustomerQuote } from './customer-quote';

function fixture() {
  const current: WorkspaceState = { activeWorkspaceId: 'existing-workspace', workspaces: [{ id: 'existing-workspace', name: '现有工作区', description: '', createdAt: '2026-11-01' }], projects: [], ledger: [], customPrompts: [], preferencesByWorkspace: { 'existing-workspace': INITIAL_PREFERENCES } };
  const imported: BackupImportResult = { backupId: 'backup-one', receiptPath: 'C:/fixture/receipt.json', idMap: { original: 'restored-workspace' }, locations: { workspaces: [{ workspaceId: 'restored-workspace', name: '恢复工作区', directory: 'D:/fixture/restored' }], projects: [] }, meta: { workspaces: [{ id: 'restored-workspace', name: '恢复工作区', description: '', createdAt: '2026-11-01' }], projects: [], ledger: [], customPrompts: [], preferencesByWorkspace: { 'restored-workspace': INITIAL_PREFERENCES }, configuration: { categories: [], workflows: [], models: [], studioActions: [], useTemplates: [], connections: [{ id: 'restored-connection', name: '恢复连接', providerId: 'custom', protocol: 'openai-chat', baseUrl: 'https://fixture.invalid/v1', enabled: true, status: 'configured' }] } } };
  const values = new Map([[WORKSPACE_STORAGE_KEY, JSON.stringify(current)], [CONFIGURATION_KEY, JSON.stringify(initialConfiguration())]]);
  let denyWorkspace = false;
  const storage = { getItem: (name: string) => values.get(name) ?? null, setItem: (name: string, value: string) => { if (denyWorkspace && name === WORKSPACE_STORAGE_KEY && value.includes('restored-workspace')) throw new Error('fixture quota'); values.set(name, value); }, removeItem: (name: string) => { values.delete(name); } } as Storage;
  return { current, imported, values, storage, deny: (value: boolean) => { denyWorkspace = value; } };
}
function quoteFixture() {
  const f = fixture(), project = { id: 'restored-project', workspaceId: 'restored-workspace', name: '恢复项目', kind: 'word' as const, status: 'draft' as const, description: '', updatedAt: '2026-11-03', costCents: 17, version: 1, accent: 'purple' as const };
  f.imported.meta.projects.push(project); f.imported.locations.projects.push({ projectId: project.id, workspaceId: project.workspaceId, name: project.name, directory: 'D:/fixture/restored/project' });
  const saved = { type: 'xuzuo-project-quote' as const, version: 1 as const, workspaceId: project.workspaceId, projectId: project.id, inputs: { minutes: '30', rate: '60', remaining: '0', other: '0', reserve: '0', fee: '10', profit: '20', price: '19.9', variable: '0' }, mode: 'single' as const, scope: 'live' as const, savedAt: '2026-11-03' };
  f.imported.meta.quoteDrafts = [{ workspaceId: project.workspaceId, projectId: project.id, saved, working: { type: 'xuzuo-quote-working', version: 1, workspaceId: project.workspaceId, projectId: project.id, inputs: { ...saved.inputs, minutes: '45' }, mode: 'single', scope: 'live', customer: emptyCustomerQuote(), baseSaved: saved, baseSavedMatchesCurrent: true, updatedAt: '2026-11-03' } }];
  return { ...f, project, savedKey: projectQuoteKey(project.workspaceId, project.id), workingKey: quoteWorkingKey(project.workspaceId, project.id) };
}
describe('完整备份界面索引恢复事务', () => {
  it('第二个存储写入失败会回滚已写配置，并保留可重试journal和原索引', () => {
    const f = fixture(), beforeWorkspace = f.storage.getItem(WORKSPACE_STORAGE_KEY), beforeConfiguration = f.storage.getItem(CONFIGURATION_KEY); f.deny(true);
    expect(() => persistBackupImport(f.storage, f.current, f.imported)).toThrow('重新保存恢复登记');
    expect(f.storage.getItem(WORKSPACE_STORAGE_KEY)).toBe(beforeWorkspace); expect(f.storage.getItem(CONFIGURATION_KEY)).toBe(beforeConfiguration); expect(f.storage.getItem('xuzuo-import-backup-one')).toContain('beforeWorkspace');
    f.deny(false); const next = persistBackupImport(f.storage, f.current, f.imported);
    expect(next.workspaces).toHaveLength(2); expect(f.storage.getItem(CONFIGURATION_KEY)).toContain('restored-connection'); expect(f.storage.getItem('xuzuo-import-backup-one')).toBeNull();
  });
  it('成功结果可重复保存，保留后来修改且不会再次增加索引或费用', () => {
    const f = fixture(), once = persistBackupImport(f.storage, f.current, f.imported);
    once.workspaces.find(item => item.id === 'restored-workspace')!.name = '导入后用户更名';
    const twice = persistBackupImport(f.storage, once, f.imported);
    expect(twice.workspaces).toHaveLength(2); expect(twice.workspaces[1].name).toBe('导入后用户更名');
    const config = JSON.parse(f.storage.getItem(CONFIGURATION_KEY)!); expect(config.connections.filter((item: { id: string }) => item.id === 'restored-connection')).toHaveLength(1);
  });
  it('已有配置损坏时不会用默认配置覆盖它', () => {
    const f = fixture(); f.storage.setItem(CONFIGURATION_KEY, '{fixture-broken');
    expect(() => persistBackupImport(f.storage, f.current, f.imported)).toThrow('恢复状态'); expect(f.storage.getItem(CONFIGURATION_KEY)).toBe('{fixture-broken'); expect(f.storage.getItem('xuzuo-import-backup-one')).toBeNull();
  });
  it('路径重连只更新已有编号目录，合并导入仍保留当前工作区选择', () => {
    const f = fixture(), merged = mergeBackupImport(f.current, initialConfiguration(), f.imported), next = relocatedWorkspaceState(merged.state, f.imported.locations);
    expect(next.activeWorkspaceId).toBe('existing-workspace'); expect(next.workspaces[1].id).toBe('restored-workspace'); expect(next.workspaces[1].directory).toBe('D:/fixture/restored'); expect(next.ledger).toEqual(f.current.ledger);
  });
});

describe('恢复后的工作区名称', () => {
  it('同名备份加恢复标记并同步偏好，已有名称冲突自动编号，原数据与费用不变', () => {
    const f = fixture(); f.imported.meta.workspaces[0].name = f.current.workspaces[0].name;
    f.current.workspaces.push({ ...f.current.workspaces[0], id: 'earlier-restored', name: `${f.current.workspaces[0].name}（恢复）` });
    const before = JSON.stringify(f.imported), merged = mergeBackupImport(f.current, initialConfiguration(), f.imported);
    const restored = merged.state.workspaces.find(item => item.id === 'restored-workspace')!;
    expect(restored.name).toBe('现有工作区（恢复2）'); expect(merged.state.preferencesByWorkspace[restored.id].studioName).toBe(restored.name);
    expect(merged.state.ledger).toEqual(f.current.ledger); expect(JSON.stringify(f.imported)).toBe(before);
    const again = mergeBackupImport(merged.state, merged.configuration, f.imported);
    expect(again.state.workspaces).toEqual(merged.state.workspaces); expect(again.state.ledger).toEqual(merged.state.ledger);
  });
});

describe('报价和界面索引一同恢复', () => {
  it('报价中途写失败会回滚已写报价和索引，留恢复journal，重试不重复费用', () => {
    const f = quoteFixture(), beforeWorkspace = f.storage.getItem(WORKSPACE_STORAGE_KEY), beforeConfiguration = f.storage.getItem(CONFIGURATION_KEY);
    const denied = { ...f.storage, setItem: (key: string, value: string) => { if (key === f.workingKey) throw Error('quota'); f.storage.setItem(key, value); } } as Storage;
    expect(() => persistBackupImport(denied, f.current, f.imported)).toThrow('重新保存恢复登记');
    expect(f.storage.getItem(f.savedKey)).toBeNull(); expect(f.storage.getItem(f.workingKey)).toBeNull(); expect(f.storage.getItem(WORKSPACE_STORAGE_KEY)).toBe(beforeWorkspace); expect(f.storage.getItem(CONFIGURATION_KEY)).toBe(beforeConfiguration); expect(f.storage.getItem('xuzuo-import-backup-one')).toContain('quoteWrites');
    const next = persistBackupImport(f.storage, f.current, f.imported), saved = readProjectQuote(f.storage, f.project.workspaceId, f.project.id), working = readQuoteWorkingDraft(f.storage, f.project.workspaceId, f.project.id);
    expect(next.projects).toHaveLength(1); expect(working.draft?.inputs.minutes).toBe('45'); expect(working.draft?.baseSavedRaw).toBe(saved.raw); expect(next.ledger).toEqual(f.current.ledger);
  });
  it('重新登记已成功的导入不会覆盖用户后来改过的报价', () => {
    const f = quoteFixture(), once = persistBackupImport(f.storage, f.current, f.imported), changed = JSON.stringify({ ...readProjectQuote(f.storage, f.project.workspaceId, f.project.id).draft!, inputs: { ...f.imported.meta.quoteDrafts![0].saved!.inputs, rate: '99' } });
    f.storage.setItem(f.savedKey, changed); const twice = persistBackupImport(f.storage, once, f.imported);
    expect(f.storage.getItem(f.savedKey)).toBe(changed); expect(twice.projects).toHaveLength(1); expect(twice.ledger).toEqual(once.ledger);
  });
  it('导入过程中另一窗口新增报价时不覆盖，回滚自己的索引但保留对方内容', () => {
    const f = quoteFixture(), beforeWorkspace = f.storage.getItem(WORKSPACE_STORAGE_KEY); let injected = false;
    const concurrent = { ...f.storage, setItem: (key: string, value: string) => { f.storage.setItem(key, value); if (!injected && key === CONFIGURATION_KEY) { injected = true; f.storage.setItem(f.savedKey, 'OTHER-WINDOW-QUOTE'); } } } as Storage;
    expect(() => persistBackupImport(concurrent, f.current, f.imported)).toThrow('另一处'); expect(f.storage.getItem(f.savedKey)).toBe('OTHER-WINDOW-QUOTE'); expect(f.storage.getItem(WORKSPACE_STORAGE_KEY)).toBe(beforeWorkspace);
  });
});
