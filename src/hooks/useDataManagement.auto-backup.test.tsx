// @vitest-environment jsdom
import { act, type MutableRefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDataManagement } from './useDataManagement';
import { notifyBackupSourceSaved } from '../lib/backup-change-events';
import { WORKSPACE_STORAGE_KEY, writeWorkspaceState } from '../lib/workspace-persistence';
import { CONFIGURATION_KEY } from '../lib/configuration-storage';
import type { WorkspaceState } from '../lib/workspace-state';
import type { StudioConfiguration } from '../configuration-types';
import type { BackupScheduleStatus } from '../data-management-types';

let host: HTMLDivElement, root: Root, change: (event: { workspaceId?: string }) => void;
const state = (): WorkspaceState => ({ workspaces: ['one', 'two'].map(id => ({ id, name: '已保存-' + id, description: '', createdAt: '2026-11-17T00:00:00Z' })), activeWorkspaceId: 'one', projects: [], ledger: [], customPrompts: [], preferencesByWorkspace: {} });
const status = (workspaceId: string): BackupScheduleStatus => ({ workspaceId, available: true, configured: true, enabled: true, enabledWorkspaceIds: ['one', 'two'], running: false, pending: false, waitingForMeta: false });
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); delete (window as unknown as { desktop?: unknown }).desktop; vi.useRealTimers(); vi.unstubAllGlobals(); });
function fixture() {
  const values = new Map<string, string>([[WORKSPACE_STORAGE_KEY, JSON.stringify(state())], [CONFIGURATION_KEY, JSON.stringify({ version: 1, connections: [], models: [], workflows: [], categories: [], studioActions: [], useTemplates: [] })]]);
  const storage = { getItem: vi.fn((key: string) => values.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { values.set(key, value); }) };
  const remove = vi.fn(), bridge = { backupStatus: vi.fn(async ({ workspaceId }: { workspaceId: string }) => status(workspaceId)), syncBackupMeta: vi.fn(async ({ workspaceId }: { workspaceId: string }) => status(workspaceId)), onBackupChanged: vi.fn((listener: typeof change) => { change = listener; return remove; }) };
  vi.stubGlobal('localStorage', storage); Object.defineProperty(window, 'desktop', { value: { dataManagement: bridge }, configurable: true });
  const current: MutableRefObject<WorkspaceState> = { current: state() };
  function Host() { useDataManagement({ workspaceId: 'one', state: current, configuration: {} as StudioConfiguration, applyState: vi.fn(), notify: vi.fn() }); return null; }
  return { storage, values, bridge, current, Host, remove };
}
async function settle() { await act(async () => { await vi.advanceTimersByTimeAsync(1100); }); }

it('全局保存事件合并后同步启用范围，读取真正持久化值而非内存草稿', async () => {
  const f = fixture(); await act(async () => root.render(<f.Host />)); expect(f.storage.getItem).not.toHaveBeenCalled(); await settle();
  expect(f.bridge.syncBackupMeta.mock.calls.map(call => call[0].workspaceId)).toEqual(['one', 'two']); f.bridge.syncBackupMeta.mockClear();
  f.current.current.workspaces[1].name = '尚未保存的内存值';
  await act(async () => { for (let i = 0; i < 12; i++) change({ workspaceId: 'two' }); }); await settle();
  const request = f.bridge.syncBackupMeta.mock.calls[0][0] as unknown as { meta: WorkspaceState }; expect(f.bridge.syncBackupMeta).toHaveBeenCalledTimes(1); expect(request.meta.workspaces.find(item => item.id === 'two')?.name).toBe('已保存-two');
  f.bridge.syncBackupMeta.mockClear(); const saved = state(); saved.workspaces[1].name = '最新已保存'; writeWorkspaceState(f.storage, saved); await settle();
  expect(f.bridge.syncBackupMeta).toHaveBeenCalledTimes(2); const later = f.bridge.syncBackupMeta.mock.calls.find(call => call[0].workspaceId === 'two')![0] as unknown as { meta: WorkspaceState }; expect(later.meta.workspaces[1].name).toBe('最新已保存');
});
it('读取失败只发送等待恢复的issue，不把上一次meta或默认状态当新快照', async () => {
  const f = fixture(); await act(async () => root.render(<f.Host />)); await settle(); f.bridge.syncBackupMeta.mockClear();
  f.storage.getItem.mockImplementation(() => { throw Error('denied'); }); notifyBackupSourceSaved('two'); await settle();
  expect(f.bridge.syncBackupMeta).toHaveBeenCalledTimes(1); const request = f.bridge.syncBackupMeta.mock.calls[0][0] as unknown as { meta?: unknown; issue?: string }; expect(request.meta).toBeUndefined(); expect(request.issue).toContain('暂时无法读取');
});
it('卸载后去除订阅与延迟任务，不留后台读取循环', async () => {
  const f = fixture(); await act(async () => root.render(<f.Host />)); await settle(); const count = f.bridge.syncBackupMeta.mock.calls.length;
  await act(async () => root.unmount()); notifyBackupSourceSaved(); await settle(); expect(f.bridge.syncBackupMeta).toHaveBeenCalledTimes(count); expect(f.remove).toHaveBeenCalledTimes(1);
  root = createRoot(host);
});
