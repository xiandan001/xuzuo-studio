import { useId, useRef, useState } from 'react';
import { FolderOpen, LoaderCircle, RotateCcw, Trash2, X } from 'lucide-react';
import type { Project, Workspace } from '../types';
import { workspaceRemoveError } from '../lib/workspace-state';
import { ModalPortal } from './ModalPortal';

interface Props {
  target?: Workspace;
  workspaces: Workspace[];
  projects: Project[];
  onRemove: (id: string) => Promise<boolean>;
  onRestore: (id: string) => Promise<boolean>;
  onClose: () => void;
}
export function WorkspaceManagementDialog({ target, workspaces, projects, onRemove, onRestore, onClose }: Props) {
  const titleId = useId(), running = useRef(false);
  const [pending, setPending] = useState(''), [error, setError] = useState(''), [status, setStatus] = useState('');
  const removed = workspaces.filter(item => item.removedAt);
  const restriction = target ? workspaceRemoveError(workspaces, target.id) : '';
  const close = () => { if (!running.current) onClose(); };
  async function perform(id: string, restoring: boolean) {
    if (running.current) return;
    running.current = true; setPending(id); setError(''); setStatus('');
    try {
      if (await (restoring ? onRestore(id) : onRemove(id))) {
        if (restoring) setStatus('工作区已恢复到列表，可以从左侧切换。'); else onClose();
      } else setStatus('操作已取消，工作区及已有资料仍保留。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '工作区列表未能更新，请重试。'); }
    finally { running.current = false; setPending(''); }
  }
  return <ModalPortal onClose={close} busy={!!pending}><div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><section className="modal wsc-management-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
    <div className="modal-heading"><span className="modal-heading-icon">{target ? <Trash2 size={22} /> : <RotateCcw size={22} />}</span><button type="button" className="btn-icon" aria-label="关闭工作区管理" disabled={!!pending} onClick={close}><X size={18} /></button></div>
    <h2 id={titleId}>{target ? '从列表移除工作区？' : '已移除的工作区'}</h2>
    {target ? <><p>“{target.name}”将从工作区列表隐藏，之后可以在“已移除的工作区”中恢复。移除当前工作区时会切换到其它可用工作区。</p><div className="wsc-retained-info"><b>本地文件、项目和历史费用都会保留</b><span>{projects.filter(item => item.workspaceId === target.id).length} 个项目（含回收站），以及提示词、模板和工作流仍属于原工作区。</span>{target.directory && <code title={target.directory}><FolderOpen size={15} />{target.directory}</code>}</div>{restriction && <p className="inline-notice" role="status">{restriction}</p>}</> : <><p>移除的工作区仍保留原有文件位置、项目和费用记录。恢复后可以继续使用。</p><div className="wsc-removed-list">{removed.length ? removed.map(item => <article key={item.id}><div><strong>{item.name}</strong><small>{projects.filter(project => project.workspaceId === item.id).length} 个项目 · 原有资料保留</small>{item.directory && <code title={item.directory}>{item.directory}</code>}</div><button type="button" className="btn btn-secondary" aria-label={`恢复工作区：${item.name}`} disabled={!!pending} onClick={() => { void perform(item.id, true); }}>{pending === item.id ? <LoaderCircle size={15} className="spin" /> : <RotateCcw size={15} />}恢复</button></article>) : <div className="wsc-removed-empty">没有已移除的工作区。</div>}</div></>}
    {error && <p className="form-error" role="alert">{error}</p>}{status && <p role="status">{status}</p>}
    <footer className="modal-actions"><button type="button" className="btn btn-secondary" data-dialog-initial-focus disabled={!!pending} onClick={close}>{target ? '取消' : '关闭'}</button>{target && <button type="button" className="btn wsc-remove-confirm" disabled={!!pending || !!restriction} onClick={() => { void perform(target.id, false); }}>{pending ? <LoaderCircle size={15} className="spin" /> : <Trash2 size={15} />}{pending ? '正在更新列表…' : '移除工作区'}</button>}</footer>
  </section></div></ModalPortal>;
}
