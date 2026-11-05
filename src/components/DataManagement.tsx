import { useEffect, useState } from 'react';
import { Archive, Download, FolderOpen, MoveRight, RotateCcw, ShieldCheck, Upload } from 'lucide-react';
import type { BackupImportResult, BackupInspection, BackupMeta, BackupSelection, DataManagementBridge, DirectoryLocations } from '../data-management-types';
import type { Project } from '../types';
import { RememberedDetails } from './RememberedDetails';
import './data-management.css';

interface Props {
  workspaceId: string;
  projects: Project[];
  getMeta: (selection?: BackupSelection) => BackupMeta;
  onImported: (result: BackupImportResult) => Promise<void> | void;
  onRelocated: (locations: DirectoryLocations) => Promise<void> | void;
  notify: (message: string, type?: 'success' | 'info' | 'error') => void;
  exportError?: string;
}
export function DataManagement({ workspaceId, projects: allProjects, getMeta, onImported, onRelocated, notify, exportError }: Props) {
  const bridge = (window.desktop as (typeof window.desktop & { dataManagement?: DataManagementBridge }))?.dataManagement;
  const [scope, setScope] = useState<'workspace' | 'projects'>('workspace');
  const [selected, setSelected] = useState<string[]>([]);
  const [inspection, setInspection] = useState<BackupInspection>();
  const [pending, setPending] = useState<BackupImportResult[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const projects = allProjects.filter(item => item.workspaceId === workspaceId && !item.purgedAt);
  useEffect(() => { setScope('workspace'); setSelected([]); setInspection(undefined); }, [workspaceId]);
  useEffect(() => { let active = true; if (bridge) void bridge.pendingImports().then(result => { if (active) setPending(result); }, reason => { if (active) setError(reason instanceof Error ? reason.message : '恢复登记无法读取。'); }); return () => { active = false; }; }, [bridge]);
  async function action(name: string, operation: () => Promise<void>) {
    setBusy(name); setError('');
    try { await operation(); } catch (reason) { setError(reason instanceof Error ? reason.message : '操作未完成，现有文件及恢复记录已保留。'); }
    finally { setBusy(''); }
  }
  async function finish(result: BackupImportResult) {
    setPending(current => [...current.filter(item => item.backupId !== result.backupId), result]);
    await onImported(result);
    await bridge!.acknowledgeImport(result.backupId);
    setPending(current => current.filter(item => item.backupId !== result.backupId)); setInspection(undefined);
    notify('备份已恢复到新工作区，历史费用已保留；继续使用模型前请重新选择凭证。');
  }
  return <section className="panel op-settings-panel data-management">
    <header><h2><Archive size={18} /> 备份与恢复</h2><p>保存项目、素材、编辑记录和费用，换机或恢复时继续使用。API Key 单独加密保存。</p></header>
    {!bridge ? <p className="data-management-note">请在桌面版管理完整备份与本地目录。</p> : <>
      <div className="data-management-block"><h3><Download size={16} /> 创建备份</h3><p>{scope === 'workspace' ? `当前工作区的 ${projects.length} 个项目、素材和历史记录。` : `已选择 ${selected.length} 个项目，包含本区素材库。`}备份文件不包含 API Key。</p>
        <RememberedDetails rememberKey={`workspace:${workspaceId}:backup-scope`}><summary>选择备份范围与查看容量说明</summary><p>默认备份整个工作区。文件合计上限 512MB，运行历史和索引上限 16MB；较大工作区可以分批选择项目备份。</p>
        <label className="data-management-choice"><input type="radio" name="backup-scope" checked={scope === 'workspace'} onChange={() => setScope('workspace')} />当前工作区全部项目与素材</label>
        <label className="data-management-choice"><input type="radio" name="backup-scope" checked={scope === 'projects'} onChange={() => setScope('projects')} />选择当前工作区的项目（含素材库）</label>
        {scope === 'projects' && <div className="data-management-projects">{projects.length ? projects.map(project => <label key={project.id}><input type="checkbox" checked={selected.includes(project.id)} onChange={event => setSelected(current => event.target.checked ? [...current, project.id] : current.filter(id => id !== project.id))} />{project.name}{project.trashedAt ? '（回收站）' : ''}</label>) : <span>当前工作区没有项目。</span>}</div>}
        </RememberedDetails>
        {exportError && <p className="op-form-error">请先恢复索引读取后再创建完整备份：{exportError}</p>}
        <button type="button" className="btn btn-secondary" disabled={!!busy || !!exportError || scope === 'projects' && !selected.length} onClick={() => void action('export', async () => { const selection = { workspaceIds: [workspaceId], ...(scope === 'projects' ? { projectIds: selected } : {}) }; const meta = getMeta(selection); const result = await bridge.exportBackup({ meta, ...selection }); if (result.saved) notify(`备份已保存，包含 ${result.files || 0} 个文件。`); })}><Download size={15} />{busy === 'export' ? '正在核验并打包…' : scope === 'workspace' ? '备份当前工作区' : `备份所选 ${selected.length} 个项目`}</button>
      </div>
      <div className="data-management-block"><h3><Upload size={16} /> 从备份恢复</h3><p>先检查备份，再选择新位置恢复。已有工作区和费用记录会保留。</p>
        <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => void action('inspect', async () => { const result = await bridge.inspectBackup(); if (result) setInspection(result); })}><FolderOpen size={15} />{busy === 'inspect' ? '正在检查备份…' : '选择并检查备份'}</button>
        {inspection && <div className="data-management-inspection"><b><ShieldCheck size={15} />文件清单与哈希已通过检查</b><p>{inspection.workspaces.map(item => item.name).join('、')} · {inspection.projects.length} 个项目 · {inspection.files} 个文件 · {(inspection.bytes / 1024 / 1024).toFixed(1)} MB</p><small>备份时间：{new Date(inspection.createdAt).toLocaleString()}。目标位置下会创建独立恢复目录。</small><button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => void action('import', async () => { const result = await bridge.importBackup({ filePath: inspection.filePath }); if (result) await finish(result); })}><Upload size={15} />{busy === 'import' ? '正在恢复并登记…' : '选择恢复位置并导入'}</button></div>}
        {pending.map(result => <div className="data-management-inspection" key={result.backupId}><b>有一份恢复结果等待保存到界面索引</b><p>本地文件及费用已保留。重试使用同一份编号映射，不会再次累计费用。</p><button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => void action('pending', () => finish(result))}><RotateCcw size={15} />重新保存恢复登记</button></div>)}
      </div>
      <RememberedDetails className="data-management-location" rememberKey={`workspace:${workspaceId}:backup-location`}><summary><MoveRight size={16} /> 工作区位置 · 重新连接或迁移</summary><div className="data-management-block"><p>文件夹已手动搬走时重新连接；需要迁移时复制到新位置并逐项核验，原位置仍保留。</p><div className="data-management-buttons"><button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => void action('reconnect', async () => { const result = await bridge.relocateWorkspace({ workspaceId, mode: 'reconnect' }); if (result) { await onRelocated(result); notify('工作区已连接新位置，项目与历史费用保持原编号。'); } })}><FolderOpen size={15} />重新连接已有文件夹</button><button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => void action('copy', async () => { const result = await bridge.relocateWorkspace({ workspaceId, mode: 'copy' }); if (result) { await onRelocated(result); notify('工作区已完成复制核验并切换位置，原目录已保留。'); } })}><MoveRight size={15} />复制并搬迁到空文件夹</button></div></div></RememberedDetails>
      {busy && <p className="data-management-note" role="status">正在处理本地文件，请等待完成。</p>}
      {error && <p className="op-form-error" role="alert">{error}</p>}
    </>}
  </section>;
}
