import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, FolderOpen, LoaderCircle, Pause, Play, ShieldCheck, Square } from 'lucide-react';
import type { BackupImportResult, BackupInspection, BackupMeta, BackupScheduleStatus, DataManagementBridge } from '../data-management-types';
import { RememberedDetails } from './RememberedDetails';
import { workflowPublicError } from '../lib/studio-run';

interface Props {
  workspaceId: string;
  bridge: DataManagementBridge;
  getMeta: () => BackupMeta;
  disabledReason?: string;
  onImported: (result: BackupImportResult) => Promise<void>;
  onDeferred: (result: BackupImportResult) => void;
}
const size = (bytes?: number) => bytes === undefined ? '—' : bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : bytes < 1024 * 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
export function AutomaticBackupPanel({ workspaceId, bridge, getMeta, disabledReason, onImported, onDeferred }: Props) {
  const [status, setStatus] = useState<BackupScheduleStatus>(), [busy, setBusy] = useState(''), [error, setError] = useState(''), [inspection, setInspection] = useState<BackupInspection>();
  const owner = useRef(workspaceId), alive = useRef(true); owner.current = workspaceId;
  const current = (id: string) => alive.current && owner.current === id;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let active = true; setStatus(undefined); setError(''); setInspection(undefined); setBusy('');
    const read = () => { void bridge.backupStatus?.({ workspaceId }).then(value => { if (active) setStatus(value); }, () => { if (active) setError('自动备份状态暂时无法读取，请稍后重试。'); }); };
    read(); const remove = bridge.onBackupChanged?.(event => { if (!event.workspaceId || event.workspaceId === workspaceId) read(); });
    return () => { active = false; remove?.(); };
  }, [bridge, workspaceId]);
  if (!bridge.backupStatus || !bridge.configureAutoBackup || !bridge.runIncrementalBackup || !bridge.inspectIncrementalBackup || !bridge.restoreIncrementalBackup) return null;
  async function action(name: string, operation: (id: string) => Promise<void>) {
    const id = workspaceId; setBusy(name); setError('');
    try { await operation(id); } catch (cause) { if (current(id)) setError(workflowPublicError(cause, '操作未完成，原文件和已有快照保留。')); }
    finally { if (current(id)) setBusy(''); }
  }
  async function configure(id: string, enabled: boolean, chooseTarget = false) {
    if (enabled && bridge.syncBackupMeta) await bridge.syncBackupMeta({ workspaceId: id, meta: getMeta() });
    const value = await bridge.configureAutoBackup!({ workspaceId: id, enabled, ...(chooseTarget ? { chooseTarget: true } : {}) });
    if (value && current(id)) setStatus(value);
  }
  const manualBusy = Boolean(status?.manualOperation), running = status?.running || manualBusy || busy === 'inspect' || busy === 'restore';
  const stateLabel = status?.error || disabledReason ? '需要处理' : status?.manualOperation === 'restore' ? '正在恢复' : status?.manualOperation === 'inspect' ? '正在核验' : status?.running ? '正在备份' : status?.waitingForMeta ? '等待保存' : status?.pending ? '等待空闲' : status?.enabled ? '已启用' : '未启用';
  return <section className="data-auto-backup" aria-label="空闲自动备份">
    <header><div><h3><ShieldCheck size={18} />空闲自动备份</h3><p>选择一次位置，工作区保存后会在空闲时备份，只写变化的内容。</p></div><span className={`data-backup-state${status?.enabled ? ' is-enabled' : ''}`} role="status">{stateLabel}</span></header>
    <div className="data-backup-last"><CheckCircle2 size={17} /><div><strong>{status?.lastSuccess ? `最近成功：${new Date(status.lastSuccess).toLocaleString('zh-CN')}` : '尚未创建自动备份'}</strong><small>{status?.lastSuccess ? `${status.files || 0} 个文件 · 总计 ${size(status.bytes)} · 新写入 ${size(status.newBytes)}` : '已有作品和历史费用保留，备份不包含 API Key。'}</small></div></div>
    {status?.repository && <RememberedDetails rememberKey={`workspace:${workspaceId}:automatic-backup-location`}><summary><FolderOpen size={14} />备份位置与容量说明</summary><p className="data-backup-path">{status.repository}</p><p>流式分卷保存，支持总量超过512MB的工程；单文件100MB、工作区总量16GB、管理索引16MB。换机时复制整个备份文件夹，不能只保留快照文件。已成功的快照保留，取消不会回退已发生费用。</p></RememberedDetails>}
    <div className="data-management-buttons">
      <button type="button" className={status?.enabled || inspection ? 'btn btn-secondary' : 'btn btn-primary'} disabled={!!busy || !status?.available || (!!disabledReason || manualBusy) && !status?.enabled} onClick={() => void action('configure', id => configure(id, !status?.enabled))}>{busy === 'configure' ? <LoaderCircle size={15} className="spin" /> : status?.enabled ? <Pause size={15} /> : <Play size={15} />}{status?.enabled ? '暂停自动备份' : status?.configured ? '启用自动备份' : '选择位置并启用'}</button>
      {status?.enabled && <button type="button" className="btn btn-secondary" disabled={!!busy || !!status.running || manualBusy || !!disabledReason} onClick={() => void action('run', async id => { const value = await bridge.runIncrementalBackup!({ workspaceId: id, meta: getMeta() }); if (current(id)) setStatus(value); })}>立即备份</button>}
      {status?.configured && <button type="button" className="btn btn-ghost" disabled={!!busy || manualBusy || !!disabledReason} onClick={() => void action('configure', id => configure(id, Boolean(status?.enabled), true))}>更换位置</button>}
      <button type="button" className="btn btn-ghost" disabled={!!busy || manualBusy} onClick={() => void action('inspect', async id => { const result = await bridge.inspectIncrementalBackup!({ workspaceId: id }); if (result && current(id)) setInspection(result); })}>从快照恢复</button>
      {running && bridge.cancelIncrementalBackup && <button type="button" className="btn btn-ghost" onClick={() => { const id = workspaceId; void bridge.cancelIncrementalBackup!({ workspaceId: id }).then(value => { if (current(id)) setStatus(value); }, cause => { if (current(id)) setError(workflowPublicError(cause, '取消结果尚未确认。')); }); }}><Square size={14} />取消本次</button>}
    </div>
    {status?.waitingForMeta && <p className="data-management-note">等待工作区索引成功保存，准备好后再开始备份。</p>}
    {(error || status?.error || disabledReason) && <p className="op-form-error" role="alert">{error || status?.error || disabledReason}</p>}
    {inspection && <div className="data-management-inspection"><b><ShieldCheck size={15} />快照清单、分卷和文件哈希已核验</b><p>{inspection.workspaces.map(item => item.name).join('、')} · {inspection.projects.length} 个项目 · {inspection.files} 个文件 · {size(inspection.bytes)}</p><small>{new Date(inspection.createdAt).toLocaleString('zh-CN')} · 将恢复成独立的新工作区，原项目与费用不变。</small><div className="data-management-buttons"><button type="button" className="btn btn-primary" disabled={!!busy || manualBusy || !!disabledReason} onClick={() => void action('restore', async id => { const result = await bridge.restoreIncrementalBackup!({ workspaceId: id, filePath: inspection.filePath }); if (result) { if (!current(id)) { onDeferred(result); return; } await onImported(result); if (current(id)) setInspection(undefined); } })}>{busy === 'restore' ? <LoaderCircle size={15} className="spin" /> : <FolderOpen size={15} />}选择恢复位置并导入</button><button type="button" className="btn btn-ghost" disabled={!!busy || manualBusy} onClick={() => setInspection(undefined)}>取消选择</button></div></div>}
  </section>;
}
