import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronDown, LoaderCircle, Paperclip, Play, Save } from 'lucide-react';
import type { PageProps } from '../types';
import type { NaturalAutomationSession } from '../hooks/useNaturalAutomationSession';
import type { AutomationContinuation, AutomationJob } from '../automation-types';
import type { WorkflowRun } from '../configuration-types';
import type { AutomationActionResult } from '../lib/automation-dispatch';
import { naturalKindLabel, naturalPreparationMissing, naturalQuestionAnswer } from '../lib/natural-automation-composer-state';
import { AutomationProjectField } from './AutomationProjectField';
import { naturalModelSelection } from './NaturalAutomationModels';
import { NaturalAutomationPlanCard } from './NaturalAutomationPlanCard';
import { RememberedDetails } from './RememberedDetails';
import { homeCreationArtifacts, homeCreationDocumentSource, homeCreationRun } from '../lib/home-creation';
import { HomeProductionResult } from './HomeProductionResult';
import { automationProjectAvailability } from '../lib/automation-project-availability';
import './home-plan-card.css';

interface PlanExecution {
  run?: WorkflowRun;
  pending?: boolean;
  execute: () => Promise<AutomationActionResult>;
  read: () => Promise<void>;
}

const jobStatusText: Record<AutomationJob['status'], string> = {
  queued: '任务已接收，正在排队。',
  dispatching: '正在启动制作任务。',
  running: '任务已启动，正在读取当前进度。',
  decision: '制作需要处理，请查看任务详情。',
  complete: '任务已完成，正在读取制作结果。',
  cancelled: '本次制作已取消。',
};

export function HomePlanCard({ props, session, onOpenModels, continuation, deferProject, onChooseProject, beforeRun, execution, externalBusy = false }: { props: PageProps; session: NaturalAutomationSession; onOpenModels?: (capability?: string) => void; continuation?: AutomationContinuation; deferProject?: boolean; onChooseProject?: () => void; beforeRun?: () => Promise<boolean>; execution?: PlanExecution; externalBusy?: boolean }) {
  const { draft, readiness, result } = session, plan = draft.plan!;
  const failedFollowup = draft.acceptedRequestId && draft.requestId !== draft.acceptedRequestId && session.planning.record?.id === draft.requestId && session.planning.record?.status === 'failed';
  const planError = result.error || (!failedFollowup ? session.error : undefined);
  const { targetPurged } = useMemo(() => automationProjectAvailability(props.workspaceId, props.projects, props.purgedProjects, draft.projectId, undefined), [props.workspaceId, props.projects, props.purgedProjects, draft.projectId]);
  const [preparing, setPreparing] = useState(!!plan.questions.length || !deferProject && (!session.project || session.project.kind !== plan.outputKind)), [importing, setImporting] = useState(false);
  const panel = useRef<HTMLDivElement>(null), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (session.preparationRequest) setPreparing(true); }, [session.preparationRequest]);
  const created = !!draft.ruleId, blocked = externalBusy || session.locked || session.planning.active || importing;
  const answers = created ? readiness.answers : draft.preparationAnswers || {}, bindings = created ? readiness.bindings : session.bindings;
  const capabilities = created ? readiness.capabilities : [...new Set(result.compiled?.workflow.steps.filter(step => ['text', 'vision', 'image-generation', 'image-editing'].includes(step.kind)).map(step => step.kind as keyof typeof bindings) || plan.steps.map(step => step.kind))];
  const missingModels = capabilities.filter(capability => { const selected = naturalModelSelection(props.configuration, capability, bindings[capability]); return !selected.model || !selected.credentialId; });
  const projectMissing = !session.project || session.project.kind !== plan.outputKind;
  const missingCount = missingModels.length + naturalPreparationMissing(plan, answers).length + Number(projectMissing);
  const job = execution ? undefined : readiness.lastJob;
  const unknown = execution ? !!execution.pending : created && readiness.dispatchUnknown;
  const run = execution ? execution.run : homeCreationRun(props.workflowRunner.runs, { workspaceId: props.workspaceId, projectId: draft.projectId, workflowId: draft.workflowId, ruleId: draft.ruleId, job });
  const submitted = !!(job || run);
  const editingBlocked = blocked || unknown || submitted;
  const starting = !submitted && !unknown && (externalBusy || session.runBusy);
  const jobError = !run && !unknown ? job?.error : undefined;
  let stage = '';
  if (!run && !unknown && !jobError) {
    if (job) stage = jobStatusText[job.status];
    else if (starting) stage = '正在准备执行方案…';
    else if (created && !readiness.dispatchLoading) stage = '流程已保存，尚未执行。';
  }
  const trashed = new Set((props.workflowRunner.trashedArtifacts || []).map(file => file.id));
  const hasWork = !!run && ['complete', 'waiting-review'].includes(run.status) && (homeCreationArtifacts(run, plan.outputKind).some(file => !trashed.has(file.id)) || !!homeCreationDocumentSource(run, plan.outputKind, trashed));
  const steps = result.compiled?.stepsSummary || plan.steps.map(step => step.name);
  useEffect(() => {
    if (!preparing) return;
    const frame = requestAnimationFrame(() => { const element = panel.current?.querySelector<HTMLElement>('[data-missing="true"] textarea,[data-missing="true"] [role="combobox"],[data-missing="true"] button'); element?.focus({ preventScroll: true }); element?.scrollIntoView({ block: 'nearest', behavior: 'auto' }); });
    return () => cancelAnimationFrame(frame);
  }, [preparing]);
  function answer(question: string, value: string) {
    try { if (created) readiness.setAnswers(previous => ({ ...previous, [question]: value })); else session.store.persist({ ...session.store.current.current, preparationAnswers: { ...session.store.current.current.preparationAnswers, [question]: value } }); }
    catch (cause) { session.setError(cause instanceof Error ? cause.message : '资料尚未保存，请重试。'); }
  }
  async function primary() {
    if (targetPurged) return;
    if (unknown) {
      if (execution) await execution.read();
      else await readiness.readDispatch();
      return;
    }
    if (job) { props.navigate(hasWork ? plan.outputKind === 'image' ? 'images' : 'documents' : 'activity', draft.projectId); return; }
    if (projectMissing) { if (onChooseProject) onChooseProject(); else setPreparing(true); return; }
    if (beforeRun && !await beforeRun()) return;
    if (missingModels.length) { onOpenModels?.(missingModels[0]); }
    const outcome = await (execution ? execution.execute() : session.createAndRun({ continuation }));
    if (mounted.current) { if (outcome.status === 'needs-input') setPreparing(true); else if (['started', 'existing', 'unknown'].includes(outcome.status)) setPreparing(false); }
  }
  async function addReferences() {
    if (!session.project || importing) return;
    if (created) { await readiness.addReferences(); return; }
    const scope = `${props.workspaceId}/${session.project.id}`; setImporting(true);
    try {
      const files = await props.workflowRunner.importFiles(session.project.id);
      if (mounted.current && `${props.workspaceId}/${session.store.current.current.projectId}` === scope && files.length) props.onUpdateProject(session.project.id, { referenceFiles: [...(session.project.referenceFiles || []), ...files.map(file => ({ id: file.id, name: file.name, mimeType: file.mimeType, bytes: file.bytes, kind: file.kind }))] });
    } catch (cause) { if (mounted.current) session.setError(cause instanceof Error ? cause.message : '资料未能添加，原文件保留。'); }
    finally { if (mounted.current) setImporting(false); }
  }
  const primaryLabel = unknown ? '读取任务状态' : job ? hasWork ? '打开编辑器' : '查看制作进度' : deferProject || execution ? '执行方案' : created ? '继续制作' : '按这个方案制作';
  if (targetPurged) return <section className="home-plan" aria-label="当前对话方案"><header><span className="home-plan-format">{naturalKindLabel[plan.outputKind]}</span><h3>{plan.name}</h3></header><p className="home-plan-goal">{plan.objective}</p><p className="home-plan-error" role="status">保存项目“{targetPurged.name}”已永久删除，历史费用保留。这份方案和对话仅供查看，不能恢复项目或继续制作。</p><p className="home-plan-fee-note">需要制作新作品时，请在上方新建对话并选择新的保存项目；不会自动重新运行。</p></section>;
  return <><section className={`home-plan${run && !unknown ? ' home-plan-has-run' : ''}`} aria-label="当前对话方案"><div className="home-plan-eyebrow">为你准备的制作方案</div><header><span className="home-plan-format">{naturalKindLabel[plan.outputKind]}</span><h3>{plan.name}</h3>{created && <span className="home-plan-saved"><Check size={13} />已保存</span>}</header><p className="home-plan-goal">{plan.objective}</p>
    <ol className="home-plan-steps">{steps.slice(0, 3).map((step, index) => <li key={index}><span>{index + 1}</span>{step.replace(/^\d+\.\s*/, '')}</li>)}{steps.length > 3 && <li className="home-plan-more">另含检查、导出等 {steps.length - 3} 步</li>}</ol>
    {plan.trigger.type !== 'manual' && <p className="home-plan-schedule"><strong>{plan.trigger.type === 'schedule' ? `每隔 ${plan.trigger.intervalMinutes} 分钟` : plan.trigger.type === 'reference-imported' ? '导入资料后' : '指定流程完成后'}</strong><span>{created && session.savedRule?.enabled ? '自动运行已开启' : '当前只试运行一次，自动运行待开启'}</span>{created && <button type="button" className="text-button" onClick={() => props.navigate('automation')}>设置自动运行</button>}</p>}
    <div className="home-plan-destination"><span>保存到</span><strong>{projectMissing && deferProject ? '开始制作时创建项目' : session.project?.name || '选择一个本地项目'}</strong><button type="button" className="text-button" disabled={editingBlocked} onClick={() => setPreparing(value => !value)}>更换 / 补充资料</button></div>
    {planError && <p className="home-plan-error" role="alert">{planError}</p>}
    {jobError && <p className="home-plan-error" role="alert">{jobError}</p>}
    {stage && <p className="home-plan-stage" role="status">{stage}</p>}
    {unknown && !planError && <p className="home-plan-error" role="alert">{(!execution && readiness.errors.join('\n')) || '上次提交结果尚未确认，读取状态不会重发任务。'}</p>}
    {(!run || unknown) && <div className="home-plan-primary">
      <button type="button" className="btn btn-primary" disabled={blocked || !execution && unknown && readiness.dispatchLoading} onClick={() => { void primary(); }}>{blocked ? <LoaderCircle size={16} className="spin" /> : <Play size={16} />}{primaryLabel}</button>
      {!submitted && !unknown && <button type="button" className="text-button" disabled={blocked} onClick={() => { void (created ? readiness.perform('save') : session.save()).then(() => { if (mounted.current && missingCount) setPreparing(true); }); }}><Save size={14} />{deferProject ? created ? '保存流程设置' : '仅保存为自动化' : '以后再做 · 仅保存流程'}</button>}
      {!!missingCount && !editingBlocked && <button className="home-plan-missing" type="button" onClick={() => { setPreparing(true); if (missingModels.length && !naturalPreparationMissing(plan, answers).length && !projectMissing) onOpenModels?.(missingModels[0]); }}>还需补充 {missingCount} 项<ArrowRight size={13} /></button>}
    </div>}
    <p className="home-plan-fee-note">保存、补资料不调用 AI；开始制作后，费用按实际用量记录。{continuation && !submitted && '这次会接着做新一轮，上一轮作品和费用保留。'}</p>
    {!submitted && !unknown && (preparing || created && readiness.errors.length > 0) && <div ref={panel} className="home-plan-preparation" role="region" aria-label="制作前补充信息"><div className="home-plan-preparation-title"><strong>再补充一点，让结果更贴合</strong><span className="creation-free-badge">填写免费</span><button type="button" className="text-button" onClick={() => setPreparing(false)}>收起</button></div>
      {(projectMissing || !created) && <div data-missing={projectMissing}><AutomationProjectField props={props} label={`保存为${naturalKindLabel[plan.outputKind]}`} ariaLabel="首页方案保存项目" value={draft.projectId} disabled={blocked || session.frozen} projectKind={plan.outputKind} newProjectKind={plan.outputKind} quickCreate initialDescription={draft.acceptedInput || draft.input} onSelect={project => session.changeProject(project.id)} /></div>}
      {plan.questions.map((question, index) => <label key={question} data-missing={!naturalQuestionAnswer(answers, question).trim()}><span>{question}</span><textarea aria-label={`制作资料回答 ${index + 1}`} value={naturalQuestionAnswer(answers, question)} rows={2} maxLength={10000} disabled={blocked || !!session.savedRule?.enabled} onChange={event => answer(question, event.target.value)} placeholder="在这里补充真实资料，不会再次调用规划 AI" /></label>)}
      {!!missingModels.length && <div data-missing="true" className="creation-model-missing"><span>还需补齐 {missingModels.length} 项制作模型与账户</span><button type="button" className="btn btn-secondary" disabled={blocked} onClick={() => onOpenModels ? onOpenModels(missingModels[0]) : props.navigate('models')}>补充制作设置</button></div>}
      {!!result.compiled?.missing.length && <ul className="home-plan-error">{result.compiled.missing.map((message, index) => <li key={index}>{message}</li>)}</ul>}
      {session.project && <button type="button" className="btn btn-secondary" disabled={blocked || !!session.savedRule?.enabled} onClick={() => { void addReferences(); }}><Paperclip size={15} />添加参考资料{session.project.referenceFiles?.length ? ` · ${session.project.referenceFiles.length} 份` : ''}</button>}
      {!!readiness.errors.length && <ul className="home-plan-error">{readiness.errors.map((error, index) => <li key={index}>{error}</li>)}</ul>}
      <small>填好后，再点击上方“{primaryLabel}”。不会因填写资料或选择模型自动开始。</small>
    </div>}
    <RememberedDetails className="home-plan-details" rememberKey={`workspace:${props.workspaceId}:home-plan-details`}><summary>步骤与高级设置<ChevronDown size={14} /></summary><NaturalAutomationPlanCard hideModels imagePreset={draft.imagePreset} props={props} plan={plan} onChange={plan => session.setDraft(value => ({ ...value, plan }))} bindings={session.bindings} onBinding={session.setProductionBinding} compiled={result.compiled} error={result.error} disabled={editingBlocked || session.frozen} calendarResolved={draft.calendarResolved} onResolveCalendar={() => session.setDraft(value => ({ ...value, calendarResolved: true, plan: value.plan && { ...value.plan, trigger: { type: 'manual' } } }))} />{created && !execution && !session.savedRule?.enabled && <button type="button" className="btn btn-secondary" disabled={blocked || unknown} onClick={() => { void session.createAndRun({ repeat: true }); }}>明确再运行一次</button>}</RememberedDetails>
  </section>{run && !unknown && <HomeProductionResult key={run.id} props={props} run={run} kind={plan.outputKind} />}</>;
}
