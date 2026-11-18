// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AutomaticBackupPanel } from './AutomaticBackupPanel';
import type { BackupImportResult, BackupInspection, BackupMeta, BackupScheduleStatus, DataManagementBridge } from '../data-management-types';

let host: HTMLDivElement, root: Root, onChanged: (event: { workspaceId?: string }) => void;
const status = (workspaceId = 'one', changes: Partial<BackupScheduleStatus> = {}): BackupScheduleStatus => ({ workspaceId, available: true, configured: false, enabled: false, running: false, pending: false, waitingForMeta: false, ...changes });
const inspection: BackupInspection = { format: 'incremental', filePath: 'C:/backup/snapshots/snapshot.xuzuo-snapshot.json', backupId: 'snapshot', createdAt: '2026-11-17T00:00:00Z', scope: 'workspaces', workspaces: [{ id: 'source', name: '已有成功备份' }], projects: [], files: 3, bytes: 600 * 1024 * 1024, secretsIncluded: false };
function fixture() {
  let current = status();
  const bridge = { backupStatus: vi.fn(async (input: { workspaceId: string }) => ({ ...current, workspaceId: input.workspaceId })), configureAutoBackup: vi.fn(async (input: { workspaceId: string; enabled: boolean }) => { current = status(input.workspaceId, { configured: true, enabled: input.enabled, repository: 'C:/backup/owned' }); return current; }), syncBackupMeta: vi.fn(async () => current), runIncrementalBackup: vi.fn(async () => status('one', { configured: true, enabled: true, pending: true })), cancelIncrementalBackup: vi.fn(async () => current), inspectIncrementalBackup: vi.fn(async () => inspection), restoreIncrementalBackup: vi.fn(async () => ({ backupId: 'snapshot' }) as BackupImportResult), onBackupChanged: vi.fn((listener: typeof onChanged) => { onChanged = listener; return vi.fn(); }) };
  return { bridge, set(value: BackupScheduleStatus) { current = value; }, getMeta: vi.fn(() => ({ savedMarker: 'persisted-only' }) as unknown as BackupMeta), imported: vi.fn(async () => undefined), deferred: vi.fn() };
}
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); localStorage.clear(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function show(f: ReturnType<typeof fixture>, workspaceId = 'one', disabledReason?: string) { await act(async () => root.render(<AutomaticBackupPanel workspaceId={workspaceId} bridge={f.bridge as unknown as DataManagementBridge} getMeta={f.getMeta} disabledReason={disabledReason} onImported={f.imported} onDeferred={f.deferred} />)); }
async function click(text: string) { const button = [...host.querySelectorAll('button')].find(button => button.textContent?.includes(text)); expect(button).toBeTruthy(); await act(async () => button!.click()); }

it('一次选择启用后显示直接暂停，保存信息只来自明确已存meta，状态刷新不打开新窗口', async () => {
  const f = fixture(); await show(f); await click('选择位置并启用');
  expect(f.bridge.syncBackupMeta).toHaveBeenCalledWith({ workspaceId: 'one', meta: f.getMeta.mock.results[0].value }); expect(f.bridge.configureAutoBackup).toHaveBeenCalledWith({ workspaceId: 'one', enabled: true });
  expect(host.textContent).toContain('暂停自动备份'); expect(f.bridge.inspectIncrementalBackup).not.toHaveBeenCalled();
  f.set(status('one', { configured: true, enabled: true, lastSuccess: '2026-11-17T01:02:03Z', files: 8, bytes: 700 * 1024 * 1024, newBytes: 0 }));
  await act(async () => onChanged({ workspaceId: 'one' })); expect(host.textContent).toContain('最近成功'); expect(host.textContent).toContain('8 个文件');
});
it('存在持久化问题时仍允许暂停，避免错误状态把停止控制禁用', async () => {
  const f = fixture(); f.set(status('one', { configured: true, enabled: true, running: true })); await show(f, 'one', '索引未保存');
  const button = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('暂停自动备份'))!; expect(button.disabled).toBe(false);
  await click('暂停自动备份'); expect(f.bridge.syncBackupMeta).not.toHaveBeenCalled(); expect(f.bridge.configureAutoBackup).toHaveBeenCalledWith({ workspaceId: 'one', enabled: false });
});
it('先显示真实恢复预览，取消不导入，明确恢复才交回现有登记流程', async () => {
  const f = fixture(); await show(f); await click('从快照恢复'); expect(host.textContent).toContain('已有成功备份'); expect(host.textContent).toContain('600.0 MB'); expect(f.bridge.restoreIncrementalBackup).not.toHaveBeenCalled();
  await click('取消选择'); expect(f.imported).not.toHaveBeenCalled();
  await click('从快照恢复'); await click('选择恢复位置并导入'); expect(f.bridge.restoreIncrementalBackup).toHaveBeenCalledWith({ workspaceId: 'one', filePath: inspection.filePath }); expect(f.imported).toHaveBeenCalledTimes(1); expect(f.deferred).not.toHaveBeenCalled();
});
it('恢复完成前切换工作区只保留待登记结果，不自动切走新页面或覆盖当前输入', async () => {
  const f = fixture(); let resolve: (value: BackupImportResult) => void = () => undefined;
  f.bridge.restoreIncrementalBackup.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await show(f); await click('从快照恢复'); await click('选择恢复位置并导入'); await show(f, 'two');
  const result = { backupId: 'snapshot' } as BackupImportResult; await act(async () => resolve(result));
  expect(f.imported).not.toHaveBeenCalled(); expect(f.deferred).toHaveBeenCalledWith(result); expect(host.textContent).not.toContain('已有成功备份');
});
it('晚到的旧工作区预览不出现在新工作区，remote错误前缀被清理', async () => {
  const f = fixture(); let resolve: (value: BackupInspection) => void = () => undefined;
  f.bridge.inspectIncrementalBackup.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await show(f); await click('从快照恢复'); await show(f, 'two'); await act(async () => resolve(inspection)); expect(host.textContent).not.toContain('已有成功备份');
  f.bridge.inspectIncrementalBackup.mockRejectedValueOnce(Error("Error invoking remote method 'runtime:backup-inspect': Error: 缺少一份备份分卷，请保留原文件"));
  await click('从快照恢复'); expect(host.textContent).toContain('缺少一份备份分卷'); expect(host.textContent).not.toContain('Error invoking remote method');
});
it('重新进入页面仍显示正在恢复且保留取消，禁止重复发起同scope操作', async () => {
  const f = fixture(); f.set(status('one', { configured: true, enabled: true, manualOperation: 'restore' })); await show(f);
  expect(host.textContent).toContain('正在恢复'); const inspectButton = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('从快照恢复'))!;
  expect(inspectButton.disabled).toBe(true); expect(host.textContent).toContain('取消本次');
  f.set(status('one', { configured: true, enabled: true })); await click('取消本次'); expect(f.bridge.cancelIncrementalBackup).toHaveBeenCalledWith({ workspaceId: 'one' });
});
