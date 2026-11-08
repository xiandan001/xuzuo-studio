import { RememberedDetails } from './RememberedDetails';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Braces, CheckCircle2, FileText, LoaderCircle, Play, RotateCcw, ShieldCheck, Upload, AlertCircle, Paperclip, Globe2, X } from 'lucide-react';
import type { WorkflowDefinition } from '../configuration-types';
import type { LivePreflight, LivePreflightIssue, LiveStartResult } from '../live-types';
import { Select } from './Select';
import { StudioConnectionFields } from './StudioConnectionFields';
import { StudioStartStatus } from './StudioStartStatus';
import type { PageProps } from '../types';
import { KIND_LABEL, money } from '../data';
import { extractVariables, resolvePrompt } from '../lib/prompt-variables';
import { workflowStepCost } from '../lib/workflows';
import { currentPreflightAccepted, workflowIssues, workflowIssueCanLocate } from '../lib/workflow-preflight';
import { withCreationFoundation } from '../lib/creation-quality';
import { useAutomaticStudioRun } from '../hooks/useAutomaticStudioRun';
import { workflowSelections, workflowPublicError } from '../lib/studio-run';
import '../pages/workflows.css';
import { isModelStep, kindLabel, WorkflowDialog, type RunContext, type InputAttachment } from './workflow-shared';
export type { RunContext } from './workflow-shared';

export function RunWorkflowDialog({ props, workflow, initial, onClose, onStarted, onEdit, studio = false, autoStart = false, onConfigure }: { props: PageProps; workflow: WorkflowDefinition; initial?: RunContext; onClose: () => void; onStarted: () => void; onEdit: (context: RunContext) => void; studio?: boolean; autoStart?: boolean; onConfigure?: (workflow: WorkflowDefinition) => void }) {
  const executionWorkflow = withCreationFoundation(workflowSelections(workflow, props.configuration));
  const projects = props.projects.filter(project => project.kind === executionWorkflow.outputKind);
  const [mode, setMode] = useState<'live' | 'simulation'>(initial?.mode || 'live');
  const [projectId, setProjectId] = useState(projects.find(project => project.id === initial?.projectId)?.id || projects.find(project => project.id === props.activeProject.id)?.id || projects[0]?.id || '');
  const [input, setInput] = useState(initial?.input ?? projects.find(project => project.id === projectId)?.description ?? '');
  const [values, setValues] = useState<Record<string, string>>(initial?.variables || {});
  const [attachments, setAttachments] = useState<InputAttachment[]>(() => initial?.attachments ? structuredClone(initial.attachments) : (initial?.attachmentIds || []).map((id, index) => ({ id, name: `工作台参考文件 ${index + 1}` })));
  const [preflight, setPreflight] = useState<LivePreflight | null>(null);
  const [preflightSignature, setPreflightSignature] = useState('');
  const [paidAcknowledged, setPaidAcknowledged] = useState(false);
  const [busy, setBusy] = useState<'preflight' | 'import' | 'start' | null>(null);
  const [error, setError] = useState('');
  const [startResult, setStartResult] = useState<LiveStartResult>();
  const [readingStart, setReadingStart] = useState(false), [readTick, setReadTick] = useState(0), [showSettings, setShowSettings] = useState(false);
  const readPending = useRef(false), readCount = useRef(0), notified = useRef(false);
  const startPending = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const confirmBeforeRun = props.preferences.confirmGeneration;
  const enabledSteps = executionWorkflow.steps.filter(step => step.enabled);
  const modelSteps = enabledSteps.filter(step => isModelStep(step.kind));
  const limitedSteps = modelSteps.filter(step => step.budgetCents != null);
  const configuredLimit = limitedSteps.reduce((sum, step) => sum + step.budgetCents!, 0);
  const promptContent = enabledSteps.map(step => step.prompt).join('\n');
  const variables = extractVariables(promptContent);
  const missingVariables = resolvePrompt(promptContent, values).missing;
  const complete = missingVariables.length === 0 && !!input.trim() && !!projectId;
  const requiredMessage = !projectId ? '请选择关联项目。' : !input.trim() ? '请填写本次创作需求。' : missingVariables.length ? `请填写本次变量：${missingVariables.join('、')}。` : '';
  const selectedProject = projects.find(project => project.id === projectId);
  const requestSignature = JSON.stringify({ mode, confirmBeforeRun, project: selectedProject && { id: selectedProject.id, workspaceId: selectedProject.workspaceId, kind: selectedProject.kind, name: selectedProject.name, description: selectedProject.description, budgetCents: selectedProject.budgetCents, referenceFiles: selectedProject.referenceFiles }, projectId, input, values, files: attachments.map(file => file.id), workflow: executionWorkflow, models: props.configuration.models, connections: props.configuration.connections, credentials: props.configuration.credentials.map(({ id, connectionId, enabled }) => ({ id, connectionId, enabled })), replaceWaitingReviewRunId: initial?.replaceWaitingReviewRunId });
  const signatureRef = useRef(requestSignature); signatureRef.current = requestSignature;
  const inspectedSignature = useRef('');
  useEffect(() => { if (startPending.current || startResult?.status === 'unknown') return; inspectedSignature.current = ''; setPreflight(null); setPreflightSignature(''); setPaidAcknowledged(false); setError(''); setStartResult(undefined); }, [requestSignature, mode]);
  const canStartLive = props.workflowRunner.runtimeStatus.available && currentPreflightAccepted(preflight, preflightSignature, requestSignature, !confirmBeforeRun || paidAcknowledged || modelSteps.length === 0);
  const runContext = (issue?: LivePreflightIssue): RunContext => ({ projectId, input, attachmentIds: attachments.map(file => file.id), attachments: attachments.map(({ id, name, mimeType, bytes }) => ({ id, name, mimeType, bytes })), variables: values, mode, focusStepId: issue?.stepId, focusField: issue?.field, replaceWaitingReviewRunId: initial?.replaceWaitingReviewRunId });
  function locateIssue(issue: LivePreflightIssue) {
    if (studio && issue.stepId && ['modelConfigId', 'credentialId', 'connection'].includes(issue.field || '')) {
      const fields = Array.from(document.querySelectorAll<HTMLElement>('.studio-connection-step')).find(element => element.dataset.stepId === issue.stepId);
      fields?.closest('details')?.setAttribute('open', '');
      const controls = fields?.querySelectorAll<HTMLElement>('[role="combobox"]');
      const control = issue.field === 'credentialId' ? controls?.[1] : controls?.[0];
      if (control && !control.hasAttribute('disabled')) { control.scrollIntoView({ block: 'center' }); control.focus(); control.click(); return; }
    }
    if (issue.stepId) { onEdit(runContext(issue)); return; }
    const dialog = document.querySelector('.wf-run-dialog');
    const label = issue.field === 'input' ? '工作流本次需求' : issue.field === 'project' ? '运行关联项目' : undefined;
    const control = label ? dialog?.querySelector<HTMLElement>(`[aria-label="${label}"]`) : issue.field === 'attachments' ? dialog?.querySelector<HTMLElement>('.wf-attachments button') : dialog?.querySelector<HTMLElement>('[aria-label^="工作流变量 "]');
    control?.closest('details')?.setAttribute('open', ''); control?.scrollIntoView({ block: 'center' }); control?.focus();
  }
  async function importFiles() {
    if (busy) return; setBusy('import'); setError('');
    try { const files = await props.workflowRunner.importFiles(projectId); setAttachments(current => [...current, ...files.filter(file => !current.some(item => item.id === file.id))]); }
    catch (cause) { setError(workflowPublicError(cause, '未能选择参考文件，请在桌面应用中重试。')); }
    finally { setBusy(null); }
  }
  async function inspect() {
    if (!complete || busy || !props.workflowRunner.runtimeStatus.available) return;
    const signature = signatureRef.current; setBusy('preflight'); setError('');
    try { const result = await props.workflowRunner.preflight(executionWorkflow, projectId, input.trim(), values, attachments.map(file => file.id)); if (mounted.current && signatureRef.current === signature) { setPreflight(result); setPreflightSignature(signature); } }
    catch (cause) { if (mounted.current && signatureRef.current === signature) setError(workflowPublicError(cause, '运行预检未完成，请检查桌面运行引擎状态后重试。')); }
    finally { if (mounted.current) setBusy(null); }
  }
  async function start(): Promise<boolean> {
    if (!complete || busy || startPending.current) return false;
    if (mode === 'simulation') { const started = props.workflowRunner.start(executionWorkflow, projectId, input.trim(), values); if (started) { onClose(); onStarted(); } return started; }
    if (startResult?.status === 'unknown') { void readStart(); return false; }
    if (!props.workflowRunner.runtimeStatus.available) { setError('后台暂未连接，请稍后重试；原图片和输入都保留。'); return false; }
    if (confirmBeforeRun && !paidAcknowledged && modelSteps.length > 0) return false;
    const signature = signatureRef.current;
    startPending.current = true; setBusy('start'); setError(''); setStartResult(undefined); readCount.current = 0;
    try {
      let checked = preflight;
      if (!canStartLive) {
        setBusy('preflight'); checked = await props.workflowRunner.preflight(executionWorkflow, projectId, input.trim(), values, attachments.map(file => file.id));
        if (!mounted.current || signatureRef.current !== signature) return false;
        setPreflight(checked); setPreflightSignature(signature);
        if (!checked.ok) { setShowSettings(true); return false; }
        setBusy('start');
      }
      return acceptStart(await props.workflowRunner.startLive(executionWorkflow, projectId, input.trim(), values, attachments.map(file => file.id), !confirmBeforeRun || paidAcknowledged && Boolean(checked?.unknownCost), initial?.replaceWaitingReviewRunId));
    } catch (cause) { if (mounted.current) setError(workflowPublicError(cause, '未能开始运行，请检查运行记录后重试，避免重复提交。')); return false; }
    finally { startPending.current = false; if (mounted.current) setBusy(null); }
  }
  function acceptStart(result: LiveStartResult): boolean {
    if (!mounted.current) return result.status === 'started';
    setStartResult(result);
    if (result.status === 'started') { if (!notified.current) { notified.current = true; onClose(); onStarted(); } return true; }
    setError(result.error); return false;
  }
  async function readStart(automaticRead = false) {
    if (readPending.current || startPending.current) return;
    if (automaticRead) readCount.current++;
    readPending.current = true; setReadingStart(true);
    try { acceptStart(await props.workflowRunner.readStartResult(projectId)); }
    catch (cause) { if (mounted.current) setError(workflowPublicError(cause, '暂时无法读取任务状态，原图与费用记录保留。')); }
    finally { readPending.current = false; if (mounted.current) { setReadingStart(false); setReadTick(value => value + 1); } }
  }
  useEffect(() => {
    if (startResult?.status !== 'unknown' || readingStart || readCount.current >= 3) return;
    const timer = window.setTimeout(() => { void readStart(true); }, readCount.current ? 1500 : 250);
    return () => window.clearTimeout(timer);
  }, [startResult?.status, readingStart, readTick]);
  useEffect(() => {
    if (mode !== 'live' || !complete || busy || !props.workflowRunner.runtimeStatus.available || inspectedSignature.current === requestSignature) return;
    const timer = window.setTimeout(() => { if (signatureRef.current !== requestSignature) return; inspectedSignature.current = requestSignature; void inspect(); }, autoStart && !confirmBeforeRun ? 0 : 300);
    return () => window.clearTimeout(timer);
  // The signature includes every parameter used by this free local preflight.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, complete, busy, requestSignature, props.workflowRunner.runtimeStatus.available]);
  const automatic = useAutomaticStudioRun({ enabled: studio && autoStart && !confirmBeforeRun && mode === 'live', ready: canStartLive && !busy, blocked: !complete || !props.workflowRunner.runtimeStatus.available || Boolean(preflight && !preflight.ok), error, onStart: start });
  if (studio && autoStart && !confirmBeforeRun && mode === 'live' && !showSettings && complete && preflight?.ok !== false) {
    const phase = readingStart ? 'recovering' : startResult?.status === 'unknown' ? 'unknown' : busy === 'start' ? 'starting' : error ? 'rejected' : busy === 'preflight' || !preflight ? 'checking' : automatic ? 'starting' : 'ready';
    return <StudioStartStatus phase={phase} projectName={selectedProject?.name || executionWorkflow.name} operation={modelSteps[0]?.kind === 'image-editing' ? '精修' : '制作'} message={error && !readingStart ? error : undefined} onClose={onClose} onRetry={() => { void start(); }} onRead={() => { void readStart(); }} onConfigure={() => { setShowSettings(true); inspectedSignature.current = ''; setPreflight(null); setPreflightSignature(''); setError(''); }} onTasks={() => { onClose(); props.navigate('activity', projectId); }} />;
  }
  const footer = <>
    {mode === 'live' && confirmBeforeRun && preflight && <CallConfirmation result={preflight} paidAcknowledged={paidAcknowledged} onPaid={setPaidAcknowledged} disabled={!!busy} />}
    <span className="wf-footer-hint"><ShieldCheck size={14} />{mode === 'live' ? confirmBeforeRun ? '已开启逐次确认：勾选本次调用后点击开始' : '点击开始直接调用模型，实际花费自动记录' : '模拟体验不会调用模型或扣费'}</span>
    <button className="btn btn-secondary" disabled={!!busy} onClick={() => onEdit(runContext())}>{studio ? '高级步骤' : '调整步骤与模型'}</button>
    <button className="btn btn-secondary" disabled={busy === 'start' || busy === 'import'} onClick={onClose}>{studio ? '返回工作台' : '取消'}</button>
    {mode === 'live' && (preflight && !preflight.ok || !preflight && error) && <button className="btn btn-secondary" disabled={!complete || !!busy || !props.workflowRunner.runtimeStatus.available} onClick={() => { void inspect(); }}>{busy === 'preflight' ? <LoaderCircle size={14} className="spin" /> : <RotateCcw size={14} />}重新检查</button>}
    <button className="btn btn-primary" disabled={!complete || !!busy || (mode === 'live' && !canStartLive)} onClick={() => { void start(); }}>{busy === 'start' ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />}{mode === 'live' ? modelSteps.length ? confirmBeforeRun ? '确认并开始' : '开始制作' : '开始本地处理' : '开始模拟'}</button>
  </>;
  const modes = <div className="segmented wf-mode-select"><button disabled={!!busy || !props.workflowRunner.runtimeStatus.available} className={mode === 'live' ? 'active' : ''} onClick={() => setMode('live')}>真实运行</button><button disabled={!!busy} className={mode === 'simulation' ? 'active' : ''} onClick={() => setMode('simulation')}>模拟体验</button></div>;
  return <WorkflowDialog title={studio ? showSettings ? '调整调用设置' : confirmBeforeRun ? '确认本次创作' : '补全调用设置' : '运行工作流'} subtitle={studio ? projects.find(project => project.id === projectId)?.name || executionWorkflow.name : executionWorkflow.name} busy={busy === 'start' || busy === 'import'} onClose={onClose} className={studio ? 'wf-run-dialog studio-run-dialog' : 'wf-run-dialog'} footer={footer}>
    <div className="wf-run-dialog-body"><section className="wf-run-inputs">{requiredMessage && <div className="wf-run-required" role="status"><span>{requiredMessage}</span><button type="button" onClick={() => locateIssue({ message: requiredMessage, field: !projectId ? 'project' : !input.trim() ? 'input' : 'variables' })}>前往填写</button></div>}
      {!studio && modes}
      <div className={`wf-simulation-notice ${mode === 'live' ? 'wf-live-notice' : ''}`}><Globe2 size={18} /><p><b>{mode === 'live' ? confirmBeforeRun ? '已开启生成前逐次确认' : '补全设置后开始制作' : '正在体验模拟流程'}</b><span>{mode === 'live' ? '自动检查不收费；点击开始会发送描述与参考文件，实际花费自动保存。' : '仅展示执行与费用记录方式，不读取 Key。'}</span></p></div>
      {mode === 'live' && !props.workflowRunner.runtimeStatus.available && <div className="wf-runtime-unavailable"><AlertCircle size={18} /><div><b>真实生成请使用桌面应用</b><p>{props.workflowRunner.runtimeStatus.reason || '浏览器可预览界面，桌面应用中可使用已保存的模型与 Key。'}</p><button onClick={() => setMode('simulation')}>体验模拟流程<ArrowRight size={14} /></button></div></div>}
      {projects.length ? studio ? <>
        <div className="studio-run-project"><span>当前项目</span><strong>{projects.find(project => project.id === projectId)?.name}</strong><span>{attachments.length ? `${attachments.length} 份参考文件已带入` : '本次没有参考文件'}</span></div>
        <RememberedDetails rememberKey={`workflow:${workflow.id}:run-description`} className="studio-run-description"><summary>查看本次描述</summary><pre>{executionWorkflow.steps.find(step => step.enabled && isModelStep(step.kind))?.prompt || input}</pre>{!executionWorkflow.id.startsWith('quick-') && <textarea className="field" aria-label="工作流本次需求" rows={4} value={input} disabled={!!busy} onChange={event => setInput(event.target.value)} />}</RememberedDetails>
        {onConfigure && <StudioConnectionFields props={props} workflow={executionWorkflow} disabled={!!busy} simulation={mode === 'simulation'} onChange={onConfigure} />}
      </> : <fieldset className="wf-input-fieldset" disabled={busy === 'start' || busy === 'import'}>
        <label className="wf-field"><span>关联项目 <b>*</b></span><Select className="field" aria-label="运行关联项目" value={projectId} onValueChange={value => { setProjectId(value); setInput(projects.find(project => project.id === value)?.description || ''); }} options={projects.map(project => ({ value: project.id, label: project.name }))} /><small>仅列出当前工作区的{KIND_LABEL[executionWorkflow.outputKind]}项目。</small></label>
        <label className="wf-field"><span>本次需求 <b>*</b></span><textarea className="field" aria-label="工作流本次需求" rows={4} maxLength={10000} value={input} onChange={event => setInput(event.target.value)} placeholder="说明这次要完成什么…" /></label>
      </fieldset> : <div className="wf-no-project"><FileText size={28} /><h3>先创建一份作品</h3><button className="btn btn-secondary" onClick={() => { onClose(); props.onCreateProject(executionWorkflow.outputKind); }}>新建{KIND_LABEL[executionWorkflow.outputKind]}项目</button></div>}
      {mode === 'live' && <RememberedDetails rememberKey={`workflow:${workflow.id}:attachments`} className="studio-run-advanced" defaultOpen={attachments.length > 0}><summary>参考文件（{attachments.length}）</summary><section className="wf-attachments"><div><h3><Paperclip size={15} />参考文件</h3><button className="btn btn-secondary" disabled={!!busy || !props.workflowRunner.runtimeStatus.available} onClick={() => { void importFiles(); }}>{busy === 'import' ? <LoaderCircle size={14} className="spin" /> : <Upload size={14} />}选择文件</button></div><p>确认运行后才发送给所选服务商。</p>{attachments.map(file => <div className="wf-attachment" key={file.id}><Paperclip size={14} /><span>{file.name}</span><button disabled={!!busy} aria-label={`移除参考文件 ${file.name}`} onClick={() => setAttachments(current => current.filter(item => item.id !== file.id))}><X size={14} /></button></div>)}</section></RememberedDetails>}
      {variables.length > 0 && <fieldset className="wf-run-variables wf-input-fieldset" disabled={busy === 'start' || busy === 'import'}><h3><Braces size={16} />补充模板内容</h3>{variables.map(name => <label className="wf-field" key={name}><span>{name} <b>*</b></span><textarea className="field" aria-label={`工作流变量 ${name}`} rows={2} maxLength={3000} value={Object.hasOwn(values, name) ? values[name] : ''} onChange={event => setValues(current => ({ ...current, [name]: event.target.value }))} /></label>)}</fieldset>}
      {studio && <RememberedDetails rememberKey={`workflow:${workflow.id}:execution-explanation`} className="studio-run-advanced"><summary>执行方式与流程说明</summary>{modes}<ol>{enabledSteps.map(step => <li key={step.id}>{step.name}{isModelStep(step.kind) ? '' : ' · 不调用模型'}</li>)}</ol></RememberedDetails>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </section><aside className="wf-run-plan">
      {!studio && <><h3>本次执行顺序</h3><div>{enabledSteps.map((step, index) => <div className="wf-run-plan-step" key={step.id}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{step.name}</strong><small>{kindLabel(step.kind)}</small>{step.prompt && <RememberedDetails rememberKey={`workflow-step:${step.id}:prompt`}><summary>查看提示词</summary><pre>{resolvePrompt(step.prompt, values).content}</pre></RememberedDetails>}</div></div>)}</div></>}
      {mode === 'simulation' ? <div className="wf-run-estimate"><span>预计模拟费用</span><strong>¥{money(enabledSteps.reduce((sum, step) => sum + workflowStepCost(step), 0))}</strong><small>虚构演示金额，不是实际扣费。</small></div> : preflight ? studio ? <StudioPreflightResult result={preflight} paidAcknowledged={paidAcknowledged} onPaid={setPaidAcknowledged} onLocate={locateIssue} disabled={!!busy} /> : <PreflightResult result={preflight} paidAcknowledged={paidAcknowledged} onPaid={setPaidAcknowledged} onLocate={locateIssue} disabled={!!busy} /> : <div className="wf-preflight-pending">{busy === 'preflight' ? <LoaderCircle size={26} className="spin" /> : <ShieldCheck size={26} />}<h3>{busy === 'preflight' ? '正在核对调用设置' : studio ? '补全模型和 Key' : '运行前检查'}</h3><p>{studio ? '设置完整后自动检查，不产生生成费用。' : '设置完整后会自动检查，不调用模型。'}</p></div>}
      {!studio && <div className="wf-run-budget"><span>模型步骤金额上限</span><strong>{!modelSteps.length ? '无需模型调用' : !limitedSteps.length ? '未设上限' : limitedSteps.length < modelSteps.length ? `已设部分 ¥${money(configuredLimit)}` : `¥${money(configuredLimit)}`}</strong><small>留空不设上限，费用仍逐次累计。</small></div>}
    </aside></div>
  </WorkflowDialog>;
}

type PreflightViewProps = { result: LivePreflight; paidAcknowledged: boolean; onPaid: (value: boolean) => void; onLocate: (issue: LivePreflightIssue) => void; disabled: boolean };

function PreflightIssues({ result, onLocate, disabled }: Pick<PreflightViewProps, 'result' | 'onLocate' | 'disabled'>) {
  const issues = workflowIssues(result);
  return issues.length > 0 ? <ul className="wf-validation-issues">{issues.map((issue, index) => <li key={`${index}-${issue.message}`}><span>{issue.message}</span>{workflowIssueCanLocate(issue) && <button type="button" className="btn btn-secondary" disabled={disabled} onClick={() => onLocate(issue)}>定位修改<ArrowRight size={13} /></button>}</li>)}</ul> : null;
}
function CallConfirmation({ result, paidAcknowledged, onPaid, disabled }: Omit<PreflightViewProps, 'onLocate'>) {
  if (!result.steps.some(step => !['manual-review', 'export', 'animation-compose'].includes(step.kind))) return <p>本次仅处理本地文件，不调用模型。</p>;
  return result.ok ? <div className="wf-paid-confirmation"><label><input aria-label="确认本次模型调用" type="checkbox" disabled={disabled} checked={paidAcknowledged} onChange={event => onPaid(event.target.checked)} /><span>我确认向上述服务地址发送本次内容与参考文件，并接受本次模型调用费用。{result.unknownCost && '部分费用需要在返回实际用量后确定，也包含在本次确认内。'}</span></label></div> : null;
}
function StudioPreflightResult(props: PreflightViewProps) {
  const { result, onLocate, disabled } = props;
  return <section className="studio-preflight-summary" aria-label="调用设置检查"><h3>{result.ok ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}{result.ok ? '设置已就绪' : '请先补全设置'}</h3><PreflightIssues result={result} onLocate={onLocate} disabled={disabled} />{result.steps.filter(step => step.domain).map(step => <p className="studio-request-target" key={step.id}>{step.domain}<br />Key：{step.credentialName || '未选择'}</p>)}<div className="studio-total"><span>{result.unknownCost ? '本次已知费用预估' : '本次费用预估'}</span><strong>{typeof result.estimatedCents === 'number' ? `¥${money(result.estimatedCents)}` : result.steps.some(step => step.costNote?.includes('自动')) ? '生成后自动计算' : '暂不能预估'}</strong><small>{result.unknownCost ? '部分费用需由返回用量确定，当前预估不是完整总价。' : '最终花费按返回用量累计，可在项目账本查看。'}</small></div>{result.warnings.length > 0 && <RememberedDetails rememberKey="workflows:studio-preflight-warnings" className="studio-run-warnings"><summary>调用说明</summary>{result.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</RememberedDetails>}</section>;
}
function PreflightResult(props: PreflightViewProps) {
  const { result, onLocate, disabled } = props;
  return <section className={`wf-preflight-result ${result.ok ? 'ok' : 'blocked'}`} aria-label="工作流运行预检"><h3>{result.ok ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}{result.ok ? '设置已就绪，可以开始制作' : '请先解决以下问题'}</h3><PreflightIssues result={result} onLocate={onLocate} disabled={disabled} />{result.warnings.length > 0 && <RememberedDetails rememberKey="workflows:preflight-warnings" className="wf-advanced-settings"><summary>调用说明</summary><div className="wf-preflight-warnings">{result.warnings.map((warning, index) => <p key={`${index}-${warning}`}>{warning}</p>)}</div></RememberedDetails>}<div className="wf-preflight-targets">{result.steps.filter(step => step.domain || step.modelName).map(step => <div key={step.id}><strong>{step.name}</strong><code>{step.domain || '未提供域名'}</code><small>{step.modelName} · Key：{step.credentialName || '未选择'}</small><span>{step.costNote || (typeof step.estimatedCents === 'number' ? `预估 ¥${money(step.estimatedCents)}` : '等待实际计费用量')}</span></div>)}</div><div className="wf-run-estimate"><span>本次费用预估</span><strong>{typeof result.estimatedCents === 'number' ? `¥${money(result.estimatedCents)}` : result.steps.some(step => step.costNote?.includes('自动')) ? '生成后自动计算' : '暂不能预估'}</strong><small>{result.unknownCost ? '实际用量返回后自动记录可计算费用。' : '按当前配置单价与用量假设计算，最终按返回用量记录。'}</small></div></section>;
}
