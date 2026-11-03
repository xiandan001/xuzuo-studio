import { afterEach, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ReactElement } from 'react';
import type { BackupMeta } from '../data-management-types';
import type { StudioConfiguration } from '../configuration-types';
import type { WorkspaceState } from '../lib/workspace-state';
import { readBackupMeta, useDataManagement } from './useDataManagement';

const configuration = () => ({ categories: [], workflows: [], studioActions: [], useTemplates: [], connections: [], models: [] });
const workspace = (): WorkspaceState => ({ workspaces: [{ id: 'workspace', name: '原工作区', description: '', createdAt: '2026-11-02T00:00:00Z' }], activeWorkspaceId: 'workspace', projects: [], ledger: [], preferencesByWorkspace: {}, customPrompts: [] });
afterEach(() => vi.unstubAllGlobals());

it('does not read configuration while App renders the unused data-management panel, then takes fresh click-time data', () => {
  let raw = JSON.stringify(configuration()), panel: ReactElement<{ getMeta: () => BackupMeta }> | undefined;
  const storage = { getItem: vi.fn(() => raw) }, state = { current: workspace() };
  vi.stubGlobal('localStorage', storage);
  function Host() {
    panel = useDataManagement({ workspaceId: 'workspace', state, configuration: {} as StudioConfiguration, applyState: vi.fn(), notify: vi.fn() });
    return null;
  }
  renderToString(<Host />); renderToString(<Host />);
  expect(storage.getItem).not.toHaveBeenCalled();
  state.current = { ...state.current, workspaces: [{ ...state.current.workspaces[0], name: '最新工作区名称' }] };
  raw = JSON.stringify({ ...configuration(), categories: [{ id: 'latest', workspaceId: 'workspace', name: '最新分类', archived: false }] });
  const meta = panel!.props.getMeta();
  expect(storage.getItem).toHaveBeenCalledOnce(); expect(meta.workspaces[0].name).toBe('最新工作区名称'); expect(meta.configuration.categories[0].id).toBe('latest');
});
it('rejects unreadable or corrupt configuration instead of backing up defaults over real data', () => {
  expect(() => readBackupMeta(workspace(), { getItem: () => '{broken' })).toThrow('未创建不完整备份');
  expect(() => readBackupMeta(workspace(), { getItem: () => { throw new Error('denied'); } })).toThrow('未创建不完整备份');
});
it('keeps the workspace-index error guard without reading configuration', () => {
  const storage = { getItem: vi.fn() };
  expect(() => readBackupMeta(workspace(), storage, { kind: 'write', message: 'quota', canExportOriginal: true })).toThrow('工作室索引尚未恢复');
  expect(storage.getItem).not.toHaveBeenCalled();
});
