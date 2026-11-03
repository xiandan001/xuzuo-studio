import { describe, expect, it } from 'vitest';
import { mergeBackupImport, persistBackupImport, relocatedWorkspaceState } from './data-management';
import { initialConfiguration } from './configuration';
import { CONFIGURATION_KEY } from './configuration-storage';
import { WORKSPACE_STORAGE_KEY } from './workspace-persistence';
import { INITIAL_PREFERENCES } from '../data';
import type { WorkspaceState } from './workspace-state';
import type { BackupImportResult } from '../data-management-types';

function fixture() {
  const current: WorkspaceState = { activeWorkspaceId: 'existing-workspace', workspaces: [{ id: 'existing-workspace', name: '现有工作区', description: '', createdAt: '2026-11-01' }], projects: [], ledger: [], customPrompts: [], preferencesByWorkspace: { 'existing-workspace': INITIAL_PREFERENCES } };
  const imported: BackupImportResult = { backupId: 'backup-one', receiptPath: 'C:/fixture/receipt.json', idMap: { original: 'restored-workspace' }, locations: { workspaces: [{ workspaceId: 'restored-workspace', name: '恢复工作区', directory: 'D:/fixture/restored' }], projects: [] }, meta: { workspaces: [{ id: 'restored-workspace', name: '恢复工作区', description: '', createdAt: '2026-11-01' }], projects: [], ledger: [], customPrompts: [], preferencesByWorkspace: { 'restored-workspace': INITIAL_PREFERENCES }, configuration: { categories: [], workflows: [], models: [], studioActions: [], useTemplates: [], connections: [{ id: 'restored-connection', name: '恢复连接', providerId: 'custom', protocol: 'openai-chat', baseUrl: 'https://fixture.invalid/v1', enabled: true, status: 'configured' }] } } };
  const values = new Map([[WORKSPACE_STORAGE_KEY, JSON.stringify(current)], [CONFIGURATION_KEY, JSON.stringify(initialConfiguration())]]);
  let denyWorkspace = false;
  const storage = { getItem: (name: string) => values.get(name) ?? null, setItem: (name: string, value: string) => { if (denyWorkspace && name === WORKSPACE_STORAGE_KEY && value.includes('restored-workspace')) throw new Error('fixture quota'); values.set(name, value); }, removeItem: (name: string) => { values.delete(name); } } as Storage;
  return { current, imported, values, storage, deny: (value: boolean) => { denyWorkspace = value; } };
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
