import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, FolderX, LoaderCircle, ShieldCheck, Trash2, X } from 'lucide-react';
import type { Project } from '../types';
import type { ProjectPurgePreview, ProjectPurgeResult } from '../project-purge-types';
import { projectPurgeChunks, purgeResultCounts } from '../lib/project-purge';
import { workflowPublicError } from '../lib/studio-run';
import { ModalPortal } from './ModalPortal';
import './project-purge.css';

interface Props {
  workspaceId: string; projects: Project[]; emptyTrash?: boolean;
  onExecute: (request: { id: string; selectionId: string; workspaceId: string; projectIds: string[]; deleteFiles: boolean }) => Promise<ProjectPurgeResult>;
  onClose: () => void;
}
export function ProjectPurgeDialog({ workspaceId, projects, emptyTrash = false, onExecute, onClose }: Props) {
  const [deleteFiles, setDeleteFiles] = useState(false), [confirmation, setConfirmation] = useState(''), [preview, setPreview] = useState<ProjectPurgePreview[]>([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [results, setResults] = useState<ProjectPurgeResult[]>([]);
  const [progress, setProgress] = useState(''), [showAll, setShowAll] = useState(false);
  const [started, setStarted] = useState(false), [settled, setSettled] = useState(false);
  const mounted = useRef(true), executing = useRef(false), epoch = useRef(0), flight = useRef<{ preview: ProjectPurgePreview; id: string }[]>([]);
  const ids = useRef([...new Set(projects.map(project => project.id))]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, []);
  useEffect(() => {
    const generation = ++epoch.current, bridge = window.desktop?.projectPurge;
    setPreview([]); setResults([]); setError(''); setLoading(true); setConfirmation(''); setStarted(false); setSettled(false); flight.current = [];
    if (!bridge) { setError('请在新版桌面应用中永久删除项目。'); setLoading(false); return; }
    void (async () => {
      const previews: ProjectPurgePreview[] = [];
      for (const chunk of projectPurgeChunks(ids.current)) {
        if (!mounted.current || generation !== epoch.current) return;
        const value = await bridge.preview({ workspaceId, projectIds: chunk, deleteFiles });
        if (value.workspaceId !== workspaceId || value.deleteFiles !== deleteFiles || value.projectIds.length !== chunk.length || value.projectIds.some(id => !chunk.includes(id))) throw Error('删除预览的范围不一致，请关闭后重新选择。');
        previews.push(value);
      }
      if (mounted.current && generation === epoch.current) { flight.current = previews.map(value => ({ preview: value, id: crypto.randomUUID() })); setPreview(previews); }
    })().catch(cause => { if (mounted.current && generation === epoch.current) setError(workflowPublicError(cause, '未能核对项目，尚未删除任何内容。')); }).finally(() => { if (mounted.current && generation === epoch.current) setLoading(false); });
  }, [workspaceId, deleteFiles]);
  const items = preview.flatMap(value => value.items), counts = purgeResultCounts(results.flatMap(value => value.items));
  const phrase = emptyTrash ? '清空' : '删除', needsPhrase = deleteFiles || emptyTrash || projects.length > 1;
  const ready = !loading && !busy && items.length > 0 && items.some(item => !item.error) && (!needsPhrase || confirmation.trim() === phrase);
  async function execute() {
    if (!ready || executing.current) return;
    executing.current = true; setBusy(true); setStarted(true); setError('');
    const currentFlight = flight.current;
    let allComplete = true;
    try {
      for (let index = 0; index < currentFlight.length; index++) {
        const request = currentFlight[index];
        if (mounted.current) setProgress(`正在处理第 ${index + 1} / ${currentFlight.length} 批`);
        const result = await onExecute({ id: request.id, selectionId: request.preview.selectionId, workspaceId, projectIds: request.preview.projectIds, deleteFiles });
        if (mounted.current) setResults(current => [...current.filter(item => item.id !== result.id), result]);
        allComplete = allComplete && result.complete;
        if (result.inProgress || !result.complete && !result.finishedAt) { if (mounted.current) setError('操作尚未确认完成。请保留此窗口，或重新读取删除状态；不会按新请求重复删除。'); break; }
        if (index + 1 === currentFlight.length && mounted.current) setSettled(allComplete);
      }
    } catch (cause) { if (mounted.current) setError(workflowPublicError(cause, '暂未确认删除结果，已有费用保留。请重新读取状态。')); }
    finally { executing.current = false; if (mounted.current) { setBusy(false); setProgress(''); } }
  }
  const completed = results.length > 0;
  return <ModalPortal onClose={onClose} busy={busy}><div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}><section className="modal project-purge-dialog" role="dialog" aria-modal="true" aria-label={emptyTrash ? '清空项目回收站' : '永久删除项目'}>
    <header><span className="project-purge-icon"><Trash2 size={23} /></span><button className="btn-icon" type="button" disabled={busy} aria-label="关闭永久删除确认" onClick={onClose}><X size={19} /></button></header>
    <h2>{emptyTrash ? '清空当前工作区的回收站？' : `永久删除${projects.length > 1 ? `这 ${projects.length} 个项目` : '这个项目'}？`}</h2>
    <p className="project-purge-intro">{emptyTrash ? `处理本工作区回收站中的全部 ${projects.length} 个项目，包含当前筛选或分页未显示的项目。` : '项目将从软件列表和回收站移除，不能再从应用回收站恢复。'}</p>
    <div className="project-purge-audit"><ShieldCheck size={17} /><span>已发生的费用、模型调用与审计记录仍保留在原工作区，不会清零。</span></div>
    {!started && <label className={`project-purge-file-option ${deleteFiles ? 'is-danger' : ''}`}><input type="checkbox" aria-label="同时永久删除本地项目文件夹" checked={deleteFiles} disabled={busy} onChange={event => setDeleteFiles(event.target.checked)} /><span><strong>同时永久删除本地项目文件夹及其中全部内容</strong><small>{deleteFiles ? '只处理下方列出的当前登记目录；外部引用、历史搬迁副本和先前导出的备份不自动删除。' : '默认不勾选：只清除软件中的项目记录，本地文件保持原样。'}</small></span></label>}
    {loading ? <p className="project-purge-loading" role="status"><LoaderCircle size={16} className="spin" />正在核对项目与本地保存位置…</p> : <div className="project-purge-targets" aria-label="将永久删除的项目">{(showAll ? items : items.slice(0, 20)).map(item => <article key={item.projectId}><FolderX size={16} /><div><strong>{item.name}</strong><small title={item.directory}>{item.directory || '没有已登记的本地项目目录'}</small>{item.folderMissing && <small>原目录已不存在，不会重新创建。</small>}{item.error && <p role="alert">{item.error}</p>}</div></article>)}{items.length > 20 && !showAll && <button className="text-button" type="button" onClick={() => setShowAll(true)}>查看全部 {items.length} 个项目</button>}</div>}
    {!started && needsPhrase && <label className="project-purge-phrase">输入“{phrase}”确认<input className="field" aria-label="永久删除确认文字" value={confirmation} autoComplete="off" disabled={busy || loading} onChange={event => setConfirmation(event.target.value)} /></label>}
    {progress && <p role="status">{progress}</p>}{error && <p className="project-purge-error" role="alert">{error}</p>}
    {completed && <div className="project-purge-results" role="status"><strong>已移除 {counts.removed} 个项目记录{deleteFiles ? `，已删除 ${counts.filesDeleted} 个本地目录` : '，本地文件未改动'}。</strong>{counts.pending > 0 && <p>{counts.pending} 个项目的删除收尾尚未完成，可在回收站的“清理未完成”中继续，不能恢复项目。</p>}{counts.failed > 0 && <p>{counts.failed} 个项目未移除，仍保留在回收站。</p>}{results.flatMap(value => value.items).filter(item => item.error).map(item => <p key={item.projectId} className="project-purge-error">{item.name}：{item.error}</p>)}</div>}
    <footer><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{settled ? '完成' : started ? '关闭' : '取消'}</button>{!settled && <button type="button" className="btn project-purge-confirm" disabled={!ready} onClick={() => { void execute(); }}>{busy ? <LoaderCircle size={15} className="spin" /> : <AlertTriangle size={15} />}{busy ? '正在永久删除…' : started ? '继续核对原删除请求' : emptyTrash ? '确认清空回收站' : '确认永久删除'}</button>}</footer>
  </section></div></ModalPortal>;
}
