import { hasManagedDialog } from '../lib/dialog-stack';
import { ModalPortal } from './ModalPortal';
import { Select } from './Select';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowRight, Check, GitBranch, Pencil, Play, Plus, Power, ShieldCheck, X } from 'lucide-react';
import type { StudioAction, WorkflowDraft } from '../configuration-types';
import type { PageProps, ProjectKind } from '../types';
import { blankWorkflow, WorkflowEditor } from './WorkflowEditor';
import './studio-actions.css';

export interface StudioActionsProps { props: PageProps; studio: 'documents' | 'images'; projectId: string; outputKind: ProjectKind; input?: string; attachmentIds?: string[]; onBeforeRun?: () => boolean; }
type ActionDraft = Pick<StudioAction, 'name' | 'description' | 'workflowId' | 'enabled'>;

export function StudioActions({ props, studio, projectId, outputKind, input, attachmentIds, onBeforeRun }: StudioActionsProps) {
  const actions = props.configuration.studioActions.filter(action => action.studio === studio && action.outputKind === outputKind);
  const workflows = props.configuration.workflows.filter(workflow => workflow.workspaceId === props.workspaceId && workflow.outputKind === outputKind);
  const [editor, setEditor] = useState<{ id?: string; draft: ActionDraft } | null>(null);
  const [creatingWorkflow, setCreatingWorkflow] = useState<WorkflowDraft | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { setEditor(null); setCreatingWorkflow(null); setError(''); }, [props.workspaceId, studio, outputKind]);
  useEffect(() => {
    if (!editor || creatingWorkflow) return;
    const close = (event: KeyboardEvent) => {
      if (hasManagedDialog()) return; if (event.key === 'Escape') { event.preventDefault(); setEditor(null); } };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [editor, creatingWorkflow]);
  function open(action?: StudioAction) { setError(''); setEditor(action ? { id: action.id, draft: { name: action.name, description: action.description, workflowId: action.workflowId, enabled: action.enabled } } : { draft: { name: '', description: '', workflowId: workflows.length === 1 ? workflows[0].id : '', enabled: true } }); }
  function update(changes: Partial<ActionDraft>) { setEditor(current => current && { ...current, draft: { ...current.draft, ...changes } }); setError(''); }
  function save(event: FormEvent) {
    event.preventDefault(); if (!editor) return;
    if (!editor.draft.name.trim()) { setError('请给这个功能按钮起一个名称。'); return; }
    if (!workflows.some(workflow => workflow.id === editor.draft.workflowId)) { setError('请选择当前工作区、相同作品类型的已保存工作流。'); return; }
    if (props.configuration.saveStudioAction({ ...editor.draft, name: editor.draft.name.trim(), description: editor.draft.description.trim(), studio, outputKind }, editor.id)) setEditor(null);
  }
  function createWorkflow() {
    if (!editor || onBeforeRun && !onBeforeRun()) return;
    setCreatingWorkflow({ ...blankWorkflow(props, outputKind), name: editor.draft.name ? `${editor.draft.name}流程`.slice(0, 60) : '', description: editor.draft.description });
  }
  return <section className="sa-panel" aria-label="工作台自定义功能"><header><span><GitBranch size={14} />我的功能</span><button aria-label="新增工作台功能" onClick={() => open()}><Plus size={13} />新增</button></header>{actions.length ? <div className="sa-actions">{actions.map(action => { const workflow = workflows.find(item => item.id === action.workflowId); return <article className={!action.enabled ? 'disabled' : ''} key={action.id}><button className="sa-run" disabled={!action.enabled || !workflow || !projectId} title={action.description || workflow?.name} onClick={() => { if (onBeforeRun && !onBeforeRun()) return; props.onUseStudioAction(action.id, projectId, input, attachmentIds); }}><Play size={12} /><span>{action.name}<small>{!workflow ? '关联流程不可用' : action.enabled ? workflow.name : '已停用'}</small></span><ArrowRight size={12} /></button><div><button aria-label={`编辑功能 ${action.name}`} title="编辑功能按钮" onClick={() => open(action)}><Pencil size={12} /></button><button className={action.enabled ? 'enabled' : ''} aria-label={`${action.enabled ? '停用' : '启用'}功能 ${action.name}`} title={action.enabled ? '停用此功能' : '启用此功能'} onClick={() => props.configuration.setStudioActionEnabled(action.id, !action.enabled)}><Power size={12} /></button></div></article>; })}</div> : <p className="sa-empty">把常用工作流放到这里，下一次直接点击运行。</p>}<p className="sa-footnote"><ShieldCheck size={11} />自动检查调用设置，实际费用随任务记录</p>{editor && !creatingWorkflow && <ModalPortal onClose={() => setEditor(null)}><div className="sa-overlay" onMouseDown={event => event.target === event.currentTarget && setEditor(null)}><section className="sa-dialog" role="dialog" aria-modal="true" aria-label={editor.id ? '编辑工作台功能' : '新增工作台功能'}><header><span><GitBranch size={21} /></span><div><h2>{editor.id ? '编辑工作台功能' : '添加自己的功能按钮'}</h2><p>为常用工作流起一个顺手的名字。</p></div><button className="btn-icon" aria-label="关闭工作台功能设置" onClick={() => setEditor(null)}><X size={18} /></button></header><form id="sa-editor-form" onSubmit={save}><label className="form-label"><span>功能名称 <b>*</b></span><input autoFocus className="field" aria-label="工作台功能名称" value={editor.draft.name} maxLength={40} onChange={event => update({ name: event.target.value })} placeholder="例如：商品图一键检查" /></label><label className="form-label"><span>功能说明</span><textarea className="field" aria-label="工作台功能说明" rows={2} maxLength={200} value={editor.draft.description} onChange={event => update({ description: event.target.value })} placeholder="这次想把哪些常用步骤放在一起？" /></label><label className="form-label"><span>绑定已保存的工作流 <b>*</b></span><Select className="field" aria-label="工作台功能工作流" value={editor.draft.workflowId} onValueChange={value => update({ workflowId: value })} options={[{ value: '', label: '请选择本区同作品类型的流程' }, ...workflows.map(workflow => ({ value: workflow.id, label: workflow.name }))]} /></label><div className="sa-inline-workflow-create">{!workflows.length && <p>还没有同作品类型的流程，可以在这里创建，当前需求和功能名称会保留。</p>}<button type="button" className="btn btn-secondary" onClick={createWorkflow}><Plus size={14} />新建并关联工作流</button></div><label className="sa-enabled-field"><input type="checkbox" checked={editor.draft.enabled} onChange={event => update({ enabled: event.target.checked })} />保存后启用此功能</label><p className="sa-save-note">功能按钮用于打开已保存的工作流。点击后按本区偏好执行，实际花费会保存。</p>{error && <p className="form-error" role="alert">{error}</p>}</form><footer><button className="btn btn-secondary" onClick={() => setEditor(null)}>取消</button><button className="btn btn-primary" form="sa-editor-form" type="submit" disabled={!workflows.length}><Check size={14} />保存功能</button></footer></section></div></ModalPortal>}{creatingWorkflow && <WorkflowEditor props={props} initial={creatingWorkflow} lockedOutputKind={outputKind} saveLabel="保存并关联" onClose={() => setCreatingWorkflow(null)} onSaved={workflowId => { setCreatingWorkflow(null); setEditor(current => current && { ...current, draft: { ...current.draft, workflowId } }); }} />}</section>;
}
