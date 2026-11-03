import { hasManagedDialog } from '../lib/dialog-stack';
import { useEffect, useRef } from 'react';
import { FolderOpen, FolderPlus, FolderSync, LoaderCircle, X } from 'lucide-react';
import { ModalPortal } from './ModalPortal';
import './project-creation-recovery.css';

interface Props {
  workspaceName: string;
  directory: string;
  message: string;
  connected: boolean;
  busy: boolean;
  onReconnect: () => void;
  onNewWorkspace: () => void;
  onClose: () => void;
}
export function ProjectCreationRecovery({ workspaceName, directory, message, connected, busy, onReconnect, onNewWorkspace, onClose }: Props) {
  const displayMessage = message.replace(/请点击[“"]检查并恢复工作区[”"]恢复连接后重新读取。?/g, '').trim();
  const panel = useRef<HTMLElement>(null), primary = useRef<HTMLButtonElement>(null);
  const current = useRef({ busy, onClose }); current.current = { busy, onClose };
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => primary.current?.focus());
    const keydown = (event: KeyboardEvent) => {
      if (hasManagedDialog()) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!current.current.busy) current.current.onClose(); return; }
      if (event.key !== 'Tab') return;
      const controls = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),[tabindex="0"]') || [])].filter(item => item.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); panel.current?.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !panel.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', keydown, true);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('keydown', keydown, true); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <ModalPortal onClose={onClose} busy={busy}><div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}><section ref={panel} className="modal project-creation-recovery" role="dialog" aria-modal="true" aria-labelledby="project-connection-heading" tabIndex={-1}>
    <div className="modal-heading"><span className="modal-heading-icon"><FolderSync size={22} /></span><button className="btn-icon" aria-label="关闭工作区连接恢复" disabled={busy} onClick={onClose}><X size={19} /></button></div>
    <h2 id="project-connection-heading">{connected ? '工作区已连接，可以继续' : '工作区需要重新连接'}</h2>
    <p>工作区“{workspaceName}”{connected ? '已恢复连接。可以继续当前项目，也可以在新位置建立独立工作区。' : '暂时无法用于新建项目。请选择恢复原位置，或在其它磁盘新建独立工作区继续。'}</p>
    <div className="project-connection-directory"><span><FolderOpen size={16} />原工作区文件夹</span><code>{directory || '请在文件夹窗口中选择原工作区位置'}</code></div>
    <p className="project-connection-message" role="status">{displayMessage}</p>
    <div className="project-recovery-options">
      <section className="project-recovery-option"><h3>{connected ? '继续当前工作区' : '继续使用原工作区'}</h3><p>{connected ? '在已连接的工作区内选择或新建独立项目文件夹。' : '只恢复上方原位置的连接。原工作区恢复窗口不能在 D 盘改建其它目录。'}</p><button ref={primary} className="btn btn-primary" disabled={busy} onClick={onReconnect}>{busy ? <><LoaderCircle size={16} className="spin" />正在处理…</> : <><FolderSync size={16} />{connected ? '选择项目文件夹并继续' : '恢复原工作区'}</>}</button></section>
      <section className="project-recovery-option"><h3>换到新位置开始</h3><p>可以在 D 盘或其它本地磁盘选择、新建工作区文件夹，再继续本次项目。</p><button className="btn btn-secondary" disabled={busy} onClick={onNewWorkspace}><FolderPlus size={16} />在新位置新建工作区</button></section>
    </div>
    <p className="project-connection-note">旧项目、账本和回收站记录保留在原工作区，当前填写的项目信息也会保留。已删除的旧项目文件夹不会因此重建。</p>
    <div className="modal-actions"><button className="btn btn-secondary" disabled={busy} onClick={onClose}>返回</button></div>
  </section></div></ModalPortal>;
}
