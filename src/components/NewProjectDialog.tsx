import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronDown, FileSpreadsheet, FileText, FolderOpen, Image, LoaderCircle, Plus, Presentation, X } from 'lucide-react';
import type { ProjectKind, PromptTemplate } from '../types';
import type { ProjectFolderSelection } from '../workspace-types';
import { parseOptionalBudget } from '../data';
import { useRememberedBoolean } from '../hooks/useRememberedBoolean';
import { ModalPortal } from './ModalPortal';
import './new-project-dialog.css';

export type NewProjectSelection = ProjectFolderSelection | { mode: 'workspace'; workspaceId: string; projectId: string; directory: string; name: string; selectionId?: undefined };
export interface NewProjectDraft {
  selection: NewProjectSelection;
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
  returnToSelection?: boolean;
  typeLocked?: boolean;
  busy: boolean;
  picking: boolean;
  error: string;
  onChange: (changes: Partial<NewProjectDraft>) => void;
  onChooseFolder: () => void;
  onResetFolder?: () => void;
  onCreate: () => void;
  onClose: () => void;
}
const kinds = [
  { kind: 'ppt', Icon: Presentation, label: 'PPT 演示', color: 'orange' },
  { kind: 'word', Icon: FileText, label: 'Word 文档', color: 'blue' },
  { kind: 'excel', Icon: FileSpreadsheet, label: 'Excel 表格', color: 'green' },
  { kind: 'image', Icon: Image, label: '图像创作', color: 'purple' },
] as const;

export function NewProjectDialog({ draft, workspaceName, unavailable, returnToSelection, typeLocked = false, busy, picking, error, onChange, onChooseFolder, onResetFolder, onCreate, onClose }: Props) {
  const name = useRef<HTMLInputElement>(null), composing = useRef(false);
  const [localError, setLocalError] = useState('');
  const scope = draft?.selection.workspaceId || workspaceName;
  const [locationOpen, setLocationOpen] = useRememberedBoolean('new-project:' + scope + ':location', false);
  const [optionsOpen, setOptionsOpen] = useRememberedBoolean('new-project:' + scope + ':options', false);
  const disabled = busy || picking, defaultLocation = !!draft && 'mode' in draft.selection && draft.selection.mode === 'workspace';
  const selected = kinds.find(item => item.kind === draft?.kind), TypeIcon = selected?.Icon || Plus;
  const path = draft?.selection.directory || '', locationLabel = path ? (defaultLocation ? '工作区默认位置 · ' : '自选位置 · ') + path : '创建时选择保存位置';
  const optionSummary = [draft?.description.trim() ? '已填写说明' : '', draft?.budget.trim() ? '金额上限 ' + draft.budget + ' 元' : ''].filter(Boolean).join(' · ');
  useEffect(() => { const frame = requestAnimationFrame(() => name.current?.focus({ preventScroll: true })); return () => cancelAnimationFrame(frame); }, []);
  function submit() {
    if (disabled || composing.current || !draft) return;
    if (!draft.name.trim()) { setLocalError('请为这份作品填写名称。'); name.current?.focus({ preventScroll: true }); return; }
    try { parseOptionalBudget(draft.budget); }
    catch (cause) { setLocalError(cause instanceof Error ? cause.message : '请填写有效金额，或留空不设上限。'); setOptionsOpen(true); return; }
    setLocalError(''); onCreate();
  }
  const close = () => { if (!disabled) onClose(); };
  return <ModalPortal onClose={close} busy={disabled}><div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><section className="modal new-project-modal" role="dialog" aria-modal="true" aria-labelledby="new-project-heading">
    <header className="new-project-heading"><div><span className="new-project-kicker">{workspaceName}</span><h2 id="new-project-heading">{unavailable ? '请在桌面版新建作品' : '新建作品'}</h2></div><button type="button" className="btn-icon" aria-label="关闭新建项目" disabled={disabled} onClick={close}><X size={19} /></button></header>
    {unavailable ? <><p className="muted">本地作品需要桌面应用选择保存位置。当前没有创建作品或文件夹。</p><footer className="modal-actions"><button type="button" className="btn btn-secondary" onClick={close}>{returnToSelection ? '返回自动化配置' : '返回工作台'}</button></footer></> : draft && <form noValidate onSubmit={event => { event.preventDefault(); submit(); }} onKeyDown={event => { if (event.key === 'Enter' && (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }}>
      <div className="new-project-form-body">
        {typeLocked ? <div className="new-project-fixed-type" aria-label="已选作品类型"><span className={'icon-' + selected?.color}><TypeIcon size={20} /></span><strong>{selected?.label}</strong></div> : <div className="new-kind-grid" role="group" aria-label="作品类型">{kinds.map(({ kind, Icon, label, color }) => <button type="button" className={draft.kind === kind ? 'selected' : ''} aria-pressed={draft.kind === kind} key={kind} disabled={disabled} onClick={() => onChange({ kind, promptIntent: draft.promptIntent && (draft.promptIntent.template.category === kind || draft.promptIntent.template.category === 'general') ? draft.promptIntent : undefined })}><span className={'icon-' + color}><Icon size={20} /></span><strong>{label}</strong>{draft.kind === kind && <Check size={13} />}</button>)}</div>}
        <label className="form-label new-project-name"><span>作品名称</span><input ref={name} data-dialog-initial-focus aria-label="项目名称" required aria-required="true" className="field" value={draft.name} disabled={disabled} maxLength={50} placeholder="例如：山野咖啡品牌提案" onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onChange={event => { setLocalError(''); onChange({ name: event.target.value }); }} /></label>
        <details className="new-project-location" open={locationOpen} onToggle={event => { if (event.target === event.currentTarget && event.currentTarget.open !== locationOpen) setLocationOpen(event.currentTarget.open); }}><summary onClick={event => { event.preventDefault(); setLocationOpen(value => !value); }}><FolderOpen size={17} /><span><strong>保存位置</strong><small title={path}>{locationLabel}</small></span><ChevronDown size={15} /></summary><div className="new-project-location-body"><p className="new-project-directory" aria-label="当前保存位置" title={path}>{path || '确认创建时选择本地保存位置'}</p><div><button type="button" className="btn btn-secondary" aria-label="更换项目文件夹" disabled={disabled} onClick={onChooseFolder}>{picking ? <><LoaderCircle size={14} className="spin" />正在选择…</> : '更换位置'}</button>{!defaultLocation && onResetFolder && <button type="button" className="text-button" disabled={disabled} onClick={onResetFolder}>使用工作区默认位置</button>}</div><small>{defaultLocation ? '创建独立作品文件夹，已有文件保留。' : '使用你选择的位置，不会自动改回默认目录。'}</small></div></details>
        <details className="new-project-options" open={optionsOpen} onToggle={event => { if (event.target === event.currentTarget && event.currentTarget.open !== optionsOpen) setOptionsOpen(event.currentTarget.open); }}><summary onClick={event => { event.preventDefault(); setOptionsOpen(value => !value); }}><span><strong>更多选项</strong><small>{optionSummary || '创作说明、金额上限'}</small></span><ChevronDown size={15} /></summary><div><label className="form-label">创作说明 <small>选填</small><textarea aria-label="创作说明" className="field" rows={3} disabled={disabled} placeholder="说明用途、受众或想要的效果" value={draft.description} onChange={event => onChange({ description: event.target.value })} /></label><label className="form-label">金额上限 <small>元，选填</small><input aria-label="金额上限" className="field" type="number" min="0" step="0.01" disabled={disabled} placeholder="留空不设上限" value={draft.budget} onChange={event => { setLocalError(''); onChange({ budget: event.target.value }); }} /></label></div></details>
      </div>
      {(error || localError) && <p className="form-error new-project-error" role="alert">{error || localError}</p>}
      <footer className="modal-actions"><span>仅创建本地作品，不调用 AI</span><div><button type="button" className="btn btn-secondary" disabled={disabled} onClick={close}>取消</button><button type="submit" className="btn btn-primary" disabled={disabled}>{busy ? <><LoaderCircle size={15} className="spin" />正在创建…</> : <>{returnToSelection ? '创建并继续配置' : defaultLocation && !path ? '选择位置并创建' : '创建作品'}<ArrowRight size={15} /></>}</button></div></footer>
    </form>}
  </section></div></ModalPortal>;
}
