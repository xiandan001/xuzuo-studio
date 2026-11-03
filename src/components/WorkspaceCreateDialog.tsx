import { useId, useRef, useState } from 'react';
import { ArrowRight, Layers3, LoaderCircle, ShieldCheck, X } from 'lucide-react';
import type { Workspace } from '../types';
import { ModalPortal } from './ModalPortal';
import './workspaces.css';

interface Props {
  workspaces: Workspace[];
  onCreate: (name: string, description: string) => Promise<boolean>;
  onClose: () => void;
  recovery?: boolean;
}

export function WorkspaceCreateDialog({ workspaces, onCreate, onClose, recovery = false }: Props) {
  const titleId = useId();
  const [name, setName] = useState(''), [description, setDescription] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const nativeFolder = Boolean(window.desktop?.workspaceFiles);
  const close = () => { if (!submitting.current) onClose(); };
  async function create() {
    if (submitting.current) return;
    if (!name.trim()) { setError('请给工作区起一个名称。'); return; }
    if (workspaces.some(workspace => workspace.name === name.trim())) { setError('这个工作区名称已存在，换一个更容易区分的名字。'); return; }
    submitting.current = true; setBusy(true); setError('');
    try { if (await onCreate(name.trim(), description.trim())) onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '工作区目录未能创建，请重新选择。'); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <ModalPortal onClose={close} busy={busy}><div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><section className="modal wsc-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
    <div className="modal-heading"><span className="modal-heading-icon"><Layers3 size={22} /></span><button type="button" className="btn-icon" aria-label="关闭新建工作区" disabled={busy} onClick={close}><X size={18} /></button></div>
    <h2 id={titleId}>{recovery ? '在新位置新建工作区' : '给每个项目，独立的空间'}</h2>
    <p className="muted">{recovery ? '可以选择 D 盘或其它本地磁盘，创建独立工作区后继续本次项目。旧项目和费用会保留在原工作区。' : '按客户、用途或项目分开管理，让创作不再混杂。'}</p>
    <form className="workspace-create-form" onSubmit={event => { event.preventDefault(); void create(); }}>
      <label className="form-label">工作区名称<input autoFocus aria-label="工作区名称" className="field" maxLength={30} value={name} placeholder="例如：山野咖啡品牌项目" disabled={busy} onChange={event => { setName(event.target.value); setError(''); }} /></label>
      <label className="form-label">用途说明 <small>可选</small><textarea aria-label="工作区用途说明" className="field" rows={3} maxLength={200} value={description} placeholder="这个空间准备用来完成什么？" disabled={busy} onChange={event => setDescription(event.target.value)} /></label>
      <div className="inline-notice"><ShieldCheck size={16} /><span>{nativeFolder ? recovery ? '下一步选择或新建工作区文件夹，再选择独立项目子文件夹。当前填写的项目信息会保留。' : '下一步选择或新建本地文件夹，每个项目自动使用独立子目录。' : '浏览器只创建预览分区，本地文件夹请在桌面版绑定。'}</span></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer className="modal-actions"><button type="button" className="btn btn-secondary" disabled={busy} onClick={close}>{recovery ? '返回恢复选项' : '取消'}</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? <><LoaderCircle size={15} className="spin" />正在准备目录</> : <>{nativeFolder ? recovery ? '选择新位置并继续' : '选择文件夹并创建' : '创建工作区'}<ArrowRight size={15} /></>}</button></footer>
    </form>
  </section></div></ModalPortal>;
}
