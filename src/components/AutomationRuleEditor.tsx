import { useEffect, useRef, useState } from 'react';
import { X, Save, ShieldCheck } from 'lucide-react';
import type { PageProps } from '../types';
import type { AutomationRule, AutomationRuleDraft, AutomationTrigger } from '../automation-types';
import { extractVariables } from '../lib/prompt-variables';
import { registerEditorSession } from '../lib/editor-session-guard';
import { ModalPortal } from './ModalPortal';
import { Select } from './Select';
import { AutomationProjectField } from './AutomationProjectField';

export function AutomationRuleEditor({ props, initial, onClose, onSaved }: { props: PageProps; initial?: Partial<AutomationRule>; onClose: () => void; onSaved: () => void }) {
  const initialProject = props.projects.find(project => project.id === initial?.projectId) || props.projects[0];
  const [draft, setDraft] = useState<AutomationRuleDraft>({ workspaceId: props.workspaceId, projectId: initialProject?.id || '', workflowId: initial?.workflowId || '', name: initial?.name || '', enabled: initial?.enabled || false, trigger: initial?.trigger || 'manual', intervalMinutes: initial?.intervalMinutes || 60, sourceWorkflowId: initial?.sourceWorkflowId, input: initial?.input || initialProject?.description || '', variables: initial?.variables || {} });
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), pending = useRef(false), mounted = useRef(true);
  const current = useRef({ draft, error, save: async () => false });
  const project = props.projects.find(project => project.id === draft.projectId), workflows = props.configuration.workflows.filter(workflow => workflow.outputKind === project?.kind);
  const workflow = workflows.find(workflow => workflow.id === draft.workflowId), variables = [...new Set((workflow?.steps || []).flatMap(step => extractVariables(step.prompt)))];
  const update = (changes: Partial<AutomationRuleDraft>) => { setDraft(value => ({ ...value, ...changes })); setError(''); };
  const selectProject = (project: PageProps['projects'][number]) => {
    const compatible = props.configuration.workflows.some(item => item.id === draft.workflowId && item.outputKind === project.kind);
    update({ projectId: project.id, ...(compatible ? {} : { workflowId: '', sourceWorkflowId: undefined, variables: {} }) });
  };
  async function save() {
    if (pending.current || !window.desktop?.automation) return false;
    if (!draft.name.trim() || !project || !workflow || !draft.input.trim() || variables.some(name => !draft.variables[name]?.trim())) { setError('请填写规则名称、本次目标，选择匹配项目的流程，并补齐变量。'); return false; }
    pending.current = true; setBusy(true); setError('');
    try {
      await window.desktop.automation.syncContext({ workspaceId: props.workspaceId, workspaces: props.workspaces, projects: props.projects, workflows: props.configuration.workflows, models: props.configuration.models, connections: props.configuration.connections });
      await window.desktop.automation.saveRule({ ...draft, ...(initial?.id ? { id: initial.id } : {}) }); if (mounted.current) { props.notify('自动化规则已保存。'); onSaved(); } return true;
    }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '规则未保存，当前输入仍保留。'); return false; }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  current.current = { draft, error, save };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => registerEditorSession({ id: `automation-rule-${props.workspaceId}`, projectId: initialProject?.id || '', label: '自动化规则', getState: () => ({ dirty: true, pending: pending.current, persistenceError: current.current.error || undefined }), save: () => current.current.save(), exportRecovery: async () => { await navigator.clipboard.writeText(JSON.stringify(current.current.draft, null, 2)); props.notify('规则草稿已复制，未包含 Key。'); return true; } }), [props.workspaceId, initialProject?.id]);
  return <ModalPortal onClose={onClose} busy={busy}><div className="auto-modal-backdrop"><section className="auto-modal" role="dialog" aria-modal="true" aria-labelledby="auto-rule-title"><header><div><h2 id="auto-rule-title">{initial?.id ? '编辑自动化规则' : '新建自动化规则'}</h2><p>把触发条件、项目和完整流程放在一起。</p></div><button className="btn-icon" disabled={busy} aria-label="关闭规则编辑" onClick={onClose}><X size={20} /></button></header><form noValidate onSubmit={event => { event.preventDefault(); void save(); }}><fieldset disabled={busy}>
    <label>规则名称<input autoFocus className="field" aria-label="自动化规则名称" maxLength={80} value={draft.name} onChange={event => update({ name: event.target.value })} /></label>
    <div className="auto-form-row"><AutomationProjectField props={props} value={draft.projectId} label="所属项目" ariaLabel="自动化项目" disabled={busy} onSelect={selectProject} /><label>执行流程<Select aria-label="自动化执行流程" value={draft.workflowId} placeholder="选择匹配的工作流" options={workflows.map(workflow => ({ value: workflow.id, label: workflow.name }))} onValueChange={value => update({ workflowId: value })} /></label></div>
    {!workflows.length && <p className="auto-note">此项目还没有类型匹配的流程。可先在自动化中心建立标准流程，或在“我的工作流”保存。</p>}
    <label>触发方式<Select aria-label="自动化触发方式" value={draft.trigger} onValueChange={value => update({ trigger: value as AutomationTrigger })} options={[{ value: 'manual', label: '手动运行 · 按需启动' }, { value: 'schedule', label: '定时运行 · 应用运行期间' }, { value: 'reference-imported', label: '导入项目参考资料后' }, { value: 'run-completed', label: '指定项目流程完成后' }]} /></label>
    {draft.trigger === 'schedule' && <label>每隔多少分钟运行<input className="field" aria-label="自动化间隔分钟" type="number" min={1} max={10080} step={1} value={draft.intervalMinutes} onChange={event => update({ intervalMinutes: Number(event.target.value) })} /><small>仅桌面应用运行时执行；恢复运行后不逐次补发错过的计划。</small></label>}
    {draft.trigger === 'run-completed' && <label>监听哪个流程完成<Select aria-label="自动化来源流程" value={draft.sourceWorkflowId || ''} onValueChange={value => update({ sourceWorkflowId: value })} options={workflows.filter(workflow => workflow.id !== draft.workflowId).map(workflow => ({ value: workflow.id, label: workflow.name }))} /></label>}
    <label>本次目标与验收要求<textarea aria-label="自动化目标" rows={5} maxLength={100000} value={draft.input} onChange={event => update({ input: event.target.value })} placeholder="说明要交付什么、依据哪些资料、什么条件算完成。" /></label>
    {variables.map(name => <label key={name}>{name}<input className="field" aria-label={`规则变量 ${name}`} maxLength={10000} value={draft.variables[name] || ''} onChange={event => update({ variables: { ...draft.variables, [name]: event.target.value } })} /></label>)}
    {draft.trigger === 'manual' ? <p className="auto-note">手动流程保存后可直接点击“运行一次”，无需启用自动触发。运行时仍按工作流步骤记录实际费用。</p> : <label className="auto-enable"><input type="checkbox" checked={draft.enabled} onChange={event => update({ enabled: event.target.checked })} />保存后启用该触发条件</label>}
    <p className="auto-note"><ShieldCheck size={15} />调用使用流程已选择的模型和本地加密 Key；每次执行、检查和修订分别计费并保留记录。金额上限沿用项目设置，未填写则不设上限。规则默认不启用。</p>
    {error && <p className="auto-error" role="alert">{error}</p>}</fieldset><footer><button type="button" disabled={busy} className="btn btn-secondary" onClick={onClose}>取消</button><button className="btn btn-primary" disabled={busy || !window.desktop?.automation}><Save size={16} />{busy ? '正在保存…' : '保存规则'}</button></footer></form></section></div></ModalPortal>;
}
