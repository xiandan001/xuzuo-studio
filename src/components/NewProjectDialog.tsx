import { hasManagedDialog } from '../lib/dialog-stack';
import { useEffect, useRef } from 'react';
import { ArrowRight, Check, FileSpreadsheet, FileText, FolderOpen, Image, LoaderCircle, Plus, ShieldCheck, X } from 'lucide-react';
import type { ProjectKind, PromptTemplate } from '../types';
import type { ProjectFolderSelection } from '../workspace-types';
import { ModalPortal } from './ModalPortal';
import { isSelectInteraction } from './Select';
import './new-project-dialog.css';

export interface NewProjectDraft {
  selection: ProjectFolderSelection;
  kind: ProjectKind;
  name: string;
  description: string;
  budget: string;
  promptIntent?: { template: PromptTemplate; content: string };
}
interface Props {
  draft: NewProjectDraft | null;
  workspaceName: string;
  unavailable?: boolean;
  busy: boolean;
  picking: boolean;
  error: string;
  onChange: (changes: Partial<NewProjectDraft>) => void;
  onChooseFolder: () => void;
  onCreate: () => void;
  onClose: () => void;
}
const kinds = [
  { kind: 'ppt', Icon: FileText, label: 'PPT 演示', color: 'orange' },
  { kind: 'word', Icon: FileText, label: 'Word 文档', color: 'blue' },
  { kind: 'excel', Icon: FileSpreadsheet, label: 'Excel 表格', color: 'green' },
  { kind: 'image', Icon: Image, label: '图像创作', color: 'purple' },
] as const;

export function NewProjectDialog({ draft, workspaceName, unavailable, busy, picking, error, onChange, onChooseFolder, onCreate, onClose }: Props) {
  const panel = useRef<HTMLElement>(null), name = useRef<HTMLInputElement>(null);
  const current = useRef({ busy, picking, onClose }); current.current = { busy, picking, onClose };
  const disabled = busy || picking;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => (name.current || panel.current?.querySelector<HTMLElement>('button:not(:disabled)'))?.focus());
    const keydown = (event: KeyboardEvent) => {
      if (hasManagedDialog()) return;
      if (isSelectInteraction(event)) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!current.current.busy && !current.current.picking) current.current.onClose(); return; }
      if (event.key !== 'Tab') return;
      const controls = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]') || [])].filter(item => item.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); panel.current?.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !panel.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', keydown, true);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('keydown', keydown, true); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <ModalPortal onClose={onClose} busy={disabled}><div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !disabled) onClose(); }}><section ref={panel} tabIndex={-1} className="modal new-project-modal" role="dialog" aria-modal="true" aria-labelledby="new-project-heading">
    <div className="modal-heading"><span className="modal-heading-icon">{unavailable ? <FolderOpen size={22} /> : <Plus size={22} />}</span><button className="btn-icon" aria-label="关闭新建项目" disabled={disabled} onClick={onClose}><X size={19} /></button></div>
    <div className="new-project-steps" aria-label="创建步骤"><span className={unavailable ? undefined : 'complete'}>{unavailable ? '1 · ' : <Check size={13} />}选择文件夹</span><ArrowRight size={13} /><span>{unavailable ? '填写项目信息' : '2 · 填写项目信息'}</span></div>
    <h2 id="new-project-heading">{unavailable ? '本地项目创建需要桌面版' : '开始一份新作品'}</h2>
    {unavailable ? <><p className="muted">请启动新版 Windows 桌面应用，先选择或新建本地项目文件夹，再填写项目信息。当前预览没有创建文件夹或项目。</p><div className="modal-actions"><button className="btn btn-secondary" onClick={onClose}>返回工作台</button></div></> : draft && <form noValidate onSubmit={event => { event.preventDefault(); if (!disabled) onCreate(); }}>
      <p className="new-project-workspace">所属工作区：{workspaceName}</p>
      <div className="new-project-folder"><label htmlFor="new-project-directory"><FolderOpen size={16} />项目文件夹</label><input id="new-project-directory" aria-label="项目文件夹" readOnly value={draft.selection.directory} title={draft.selection.directory} /><button type="button" className="btn btn-ghost" aria-label="更换项目文件夹" disabled={disabled} onClick={onChooseFolder}>{picking ? <><LoaderCircle size={14} className="spin" />正在选择…</> : '更换文件夹'}</button><p>产物和编辑记录默认保存在此文件夹内。</p></div>
      <div className="new-project-form-body"><div className="new-kind-grid">{kinds.map(({ kind, Icon, label, color }) => <button type="button" className={draft.kind === kind ? 'selected' : ''} key={kind} disabled={disabled} onClick={() => onChange({ kind, promptIntent: draft.promptIntent && (draft.promptIntent.template.category === kind || draft.promptIntent.template.category === 'general') ? draft.promptIntent : undefined })}><span className={`icon-${color}`}><Icon size={20} /></span>{label}{draft.kind === kind && <Check size={13} />}</button>)}</div>
      <label className="form-label"><span>项目名称（必填）</span><input ref={name} aria-label="项目名称" required aria-required="true" className="field" value={draft.name} disabled={disabled} maxLength={50} placeholder="例如：山野咖啡品牌提案" onChange={event => onChange({ name: event.target.value })} /></label>
      <label className="form-label">这次想完成什么？<textarea className="field" rows={3} disabled={disabled} placeholder="简要描述用途、受众和你想要的效果…" value={draft.description} onChange={event => onChange({ description: event.target.value })} /></label>
      <label className="form-label">金额上限（元，选填）<input className="field" type="number" min="0" step="0.01" disabled={disabled} placeholder="选填，留空不设上限" value={draft.budget} onChange={event => onChange({ budget: event.target.value })} /></label>
      <div className="inline-notice"><ShieldCheck size={15} />创建项目不调用模型；点击生成后会自动检查设置并开始，实际费用会保存到项目。</div>
      {error && <p className="form-error" role="alert">{error}</p>}</div>
      <div className="modal-actions"><button type="button" className="btn btn-secondary" disabled={disabled} onClick={onClose}>稍后再说</button><button type="submit" className="btn btn-primary" disabled={disabled}>{busy ? <><LoaderCircle size={15} className="spin" />正在创建项目目录</> : <>创建并进入工作台 <ArrowRight size={15} /></>}</button></div>
    </form>}
  </section></div></ModalPortal>;
}
