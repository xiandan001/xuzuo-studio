import { useEffect, useRef, useState } from 'react';
import { ArrowRight, LoaderCircle, Play, RefreshCw, Square } from 'lucide-react';
import type { ModelCapability, WorkflowAttempt, WorkflowRun } from '../configuration-types';
import type { PageProps, Project } from '../types';
import { parseOptionalBudget } from '../data';
import { workflowPublicError } from '../lib/studio-run';
import { workflowOutputRetryLimit } from '../lib/workflow-output-retry';
import { canResumeLocalImageExport, isCoverDeliveryLayoutFailure } from '../lib/local-image-export';
import { NaturalAutomationModels, naturalModelSelection, type NaturalBinding } from './NaturalAutomationModels';
import { RememberedDetails } from './RememberedDetails';

type Action = 'read' | 'continue' | 'cancel' | 'recover-receipt' | 'restore';
const chatModelKinds = new Set(['text', 'vision', 'image-generation', 'image-editing']);
const uncertainCodes = new Set(['TIMEOUT', 'NETWORK_ERROR', 'RESPONSE_TOO_LARGE', 'INVALID_RESPONSE', 'PROVIDER_ERROR']);
const localSteps = new Set(['export', 'manual-review', 'animation-compose']);
const resumable = new Set(['paused', 'failed', 'interrupted']);
const probedReceipts = new Set<string>();

function unknownModelOutcome(run: WorkflowRun, attempt?: WorkflowAttempt) {
  return attempt?.requestOutcomeUnknown ?? Boolean(attempt && !attempt.httpStatus && (
    uncertainCodes.has(attempt.errorCode || '') && attempt.costState !== 'not-incurred'
    || run.status === 'interrupted' && (attempt.status === 'running' || attempt.costState === 'unknown')
  ));
}

function modelIssue(attempt: WorkflowAttempt | undefined, message: string) {
  const status = attempt?.httpStatus;
  if (status === 429) return '查看限流和额度';
  if (status === 402 || /账户额度不足/.test(message)) return '查看账户额度';
  if (status === 401 || attempt?.errorCode === 'INVALID_CREDENTIAL' || /凭证(?:无效|不可用|不存在)|请重新录入自己的 API Key/.test(message)) return '更换账户';
  if (status === 403 || status === 404 || attempt?.errorCode === 'INVALID_MODEL' || /请选择启用的真实模型和连接/.test(message)) return '更换模型或账户';
  if (/HTTP (401|402|403|404|429)\b/.test(message)) return '修复模型设置';
}

function checkedBudget(value: string) {
  const amount = parseOptionalBudget(value);
  if (amount === undefined) throw Error('请填写要授权的预算金额。');
  return amount;
}

export function HomeProductionRecovery({ run, project, props, onRead, onOpenSteps, visible = false }: { run: WorkflowRun; project: Project; props: PageProps; onRead: (run: WorkflowRun) => void; onOpenSteps?: () => void; visible?: boolean }) {
  const [busy, setBusy] = useState<Action>(), [error, setError] = useState(''), [feedback, setFeedback] = useState('');
  const [showModels, setShowModels] = useState(false), [showBudget, setShowBudget] = useState(false);
  const step = run.snapshot?.steps[run.stepIndex];
  const attempt = run.attempts?.filter(item => item.stepId === step?.id).at(-1);
  const failed = run.status === 'failed' && attempt?.status === 'failed' ? attempt : undefined;
  const scope = `${props.workspaceId}/${run.id}/${step?.id || ''}/${attempt?.id || ''}`;
  const pending = useRef(false), current = useRef(scope); current.current = scope;
  const source = useRef(props); source.current = props;
  useEffect(() => {
    current.current = scope;
    return () => { if (current.current === scope) current.current = ''; };
  }, [scope]);

  const [binding, setBinding] = useState<NaturalBinding>(() => ({ modelConfigId: step?.modelConfigId, credentialId: step?.credentialId, reasoningEffort: step?.reasoningEffort }));
  const [projectBudget, setProjectBudget] = useState(project.budgetCents == null ? '' : String(project.budgetCents / 100));
  const [stepBudget, setStepBudget] = useState(step?.budgetCents == null ? '' : String(step.budgetCents / 100));

  const reference = run.referenceIssue, coverLayoutFailure = isCoverDeliveryLayoutFailure(run);
  const canContinue = resumable.has(run.status);
  const canCancel = ['running', 'paused', 'waiting-review'].includes(run.status);
  const localExport = canResumeLocalImageExport(run) || !!step && localSteps.has(step.kind) && !coverLayoutFailure;
  const uncertain = !!step && !localSteps.has(step.kind) && unknownModelOutcome(run, attempt);
  const message = run.error || failed?.error || '';
  const needsModel = modelIssue(failed, message);
  const needsBudget = failed?.errorCode === 'WORKFLOW_BUDGET_LIMIT' || /预算不足|单步预算|项目.*预算|当前步骤估算超过已设置的上限|上限下费用无法确定/.test(message);
  const needsProjectBudget = needsBudget && (/项目.*预算/.test(message) || !/单步预算/.test(message) && (project.budgetCents != null || step?.budgetCents == null));
  const needsStepBudget = needsBudget && (/单步预算/.test(message) || !/项目.*预算/.test(message) && step?.budgetCents != null);
  const mayReplaceBinding = !!attempt?.id && ['failed', 'interrupted'].includes(run.status) && step && chatModelKinds.has(step.kind);
  const candidate = mayReplaceBinding ? naturalModelSelection(props.configuration, step.kind as ModelCapability, binding) : undefined;
  const stepMaxOutputTokens = workflowOutputRetryLimit(run);
  const restoreId = reference?.reason === 'trashed' ? reference.artifactId : undefined;
  const canCheckRepairedFile = !!reference && !restoreId && reference.reason !== 'foreign-project' && reference.reason !== 'unsupported-format' && reference.reason !== 'incomplete' && canContinue && !uncertain;
  const primaryContinue = !reference && !uncertain && !needsModel && !needsBudget && (canContinue || canResumeLocalImageExport(run));

  async function act(action: Action, quiet = false) {
    if (pending.current) return;
    const requested = current.current; pending.current = true; setBusy(action); setError(''); setFeedback('');
    try {
      const bridge = window.desktop?.runtime;
      if (action === 'restore') {
        if (!restoreId) throw Error('暂时找不到可恢复的原文件。');
        const { restoreArtifact, listProjectArtifacts } = source.current.workflowRunner;
        try { await restoreArtifact(restoreId); }
        catch (cause) {
          const files = await listProjectArtifacts?.(project.id, { refresh: true }).catch(() => []);
          if (!files?.some(file => file.id === restoreId && file.projectId === project.id && !file.trashedAt && !file.unavailable)) throw cause;
        }
        if (current.current !== requested) return;
      }
      if (action !== 'read' && (action !== 'restore' || canContinue && !uncertain)) {
        if (!bridge) throw Error('请在桌面应用中处理任务。');
        const continuing = action === 'continue' || action === 'restore';
        const budget = continuing && showBudget && needsProjectBudget ? checkedBudget(projectBudget) : undefined;
        await bridge.control({
          id: run.id, action: continuing ? run.status === 'paused' ? 'resume' : 'continue' : action,
          ...((continuing || action === 'recover-receipt') && attempt?.id ? { expectedAttemptId: attempt.id } : {}),
          ...(continuing && stepMaxOutputTokens !== undefined ? { stepMaxOutputTokens } : {}),
          ...(continuing && showBudget && needsStepBudget ? { stepBudgetCents: checkedBudget(stepBudget) } : {}),
          ...(continuing && showModels && step && candidate?.model && candidate.credentialId
            ? { stepBinding: { stepId: step.id, modelConfigId: candidate.model.id, credentialId: candidate.credentialId } } : {}),
          project: budget === undefined ? project : { ...project, budgetCents: budget },
          connections: source.current.configuration.connections,
          models: source.current.configuration.models,
        });
        if (budget !== undefined && current.current === requested) source.current.onUpdateProject(project.id, { budgetCents: budget });
      }
      const read = bridge?.runDetail || source.current.workflowRunner.loadRunDetail;
      if (!read) throw Error('此版本暂不支持就地读取任务，请到运行记录查看。');
      const fresh = await read(run.id);
      if (current.current === requested && fresh.id === run.id && fresh.projectId === run.projectId && fresh.workspaceId === run.workspaceId) {
        onRead(fresh);
        if (!quiet && action === 'recover-receipt' && (fresh.status === 'failed' || fresh.status === 'interrupted')) setFeedback('暂未找到能续跑的原结果。请核对服务商任务和账单。');
        if (action === 'restore' && (!canContinue || uncertain)) setFeedback('原文件已恢复。请返回任务详情核对当前状态。');
      }
    } catch (cause) { if (!quiet && current.current === requested) setError(workflowPublicError(cause, '操作未完成，已有结果和费用保留。')); }
    finally { pending.current = false; if (current.current === requested) setBusy(undefined); }
  }
  const probe = useRef(() => act('recover-receipt', true));
  probe.current = () => act('recover-receipt', true);
  const canProbe = visible && run.snapshot?.automaticRecovery === true && run.status === 'interrupted' && uncertain && !!attempt?.id && !reference;
  useEffect(() => {
    if (!canProbe || !window.desktop?.runtime) return;
    function check() {
      if (document.hidden || pending.current || probedReceipts.has(scope)) return;
      if (probedReceipts.size >= 64) probedReceipts.delete(probedReceipts.values().next().value!);
      probedReceipts.add(scope);
      void probe.current();
    }
    check();
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, [canProbe, scope]);

  const chooseIssue = reference ? '修复参考资料' : uncertain ? '核对原任务' : needsBudget ? '调整预算' : needsModel;
  const revealIssue = () => {
    if (reference) {
      if (restoreId) void act('restore');
      else props.navigate(project.kind === 'image' ? 'images' : 'documents', project.id);
    } else if (uncertain) void act('recover-receipt');
    else if (needsBudget) setShowBudget(true);
    else if (candidate) setShowModels(true);
    else props.navigate('models', project.id);
  };
  const issueLabel = restoreId ? canContinue && !uncertain ? '恢复原文件并继续' : '恢复原文件' : chooseIssue;
  const continueLabel = coverLayoutFailure ? '修正构图并继续' : localExport ? '继续本地导出' : stepMaxOutputTokens === undefined ? '继续制作' : '继续当前步骤';
  const helper = reference ? `恢复任务绑定的原文件，已有样稿和费用会保留。${canContinue && !uncertain && !localExport ? '继续后的模型调用按实际用量计费。' : ''}` : uncertain ? '先核对这次请求的结果。找回后按原授权继续后续步骤，本次调用不重复发送。'
    : needsBudget ? '填写本次允许使用的金额上限。已经完成的步骤会保留。'
    : needsModel ? failed?.httpStatus === 429 ? '可能是短时限流，也可能是配额不足。请核对账户后再继续当前步骤。' : '可选择兼容的模型与账户。继续后按实际调用计费，完成的步骤会保留。'
    : coverLayoutFailure ? failed?.errorCode === 'COVER_LAYOUT_REJECTED' ? '本地排版未通过。点击后将用现有样稿精修一次，重新检查并导出；调用模型会新增费用。'
      : '先用现有样稿在本地重新排版。仍不合格时，按已设置的精修次数和预算处理；调用模型会新增费用。'
    : localExport ? '使用已有结果继续本地导出。'
    : primaryContinue ? '从当前步骤继续，保留已完成内容。再次调用模型会新增费用。' : '';

  return <div className="home-result-recovery" aria-label="就地处理制作任务">
    {helper && <p>{stepMaxOutputTokens !== undefined && `继续时将“${step?.name || '当前步骤'}”的输出上限从 ${step?.maxOutputTokens || 2048} 提高到 ${stepMaxOutputTokens} Token。`}{helper}</p>}
    {chooseIssue && !showModels && !showBudget && <button type="button" className="btn btn-primary" disabled={!!busy} onClick={revealIssue}>
      {busy ? <LoaderCircle size={14} className="spin" /> : <ArrowRight size={14} />}{issueLabel}
    </button>}
    {primaryContinue && <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => { void act('continue'); }}>
      {busy === 'continue' ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />}{continueLabel}
    </button>}
    {showModels && candidate && step && <div className="home-recovery-fields">
      <NaturalAutomationModels configuration={props.configuration} capability={step.kind as ModelCapability} value={binding} disabled={!!busy} onChange={setBinding} />
      {(!candidate.models.length || !candidate.credentials.length) && <button type="button" className="text-button" disabled={!!busy} onClick={() => props.navigate('models', project.id)}>打开模型设置</button>}
      <button type="button" className="btn btn-primary" disabled={!!busy || !candidate.model || !candidate.credentialId} onClick={() => { void act('continue'); }}>使用此设置继续</button>
    </div>}
    {showBudget && <form className="home-recovery-fields" onSubmit={event => { event.preventDefault(); void act('continue'); }}>
      {needsProjectBudget && <label>项目预算（元）<input className="field" inputMode="decimal" value={projectBudget} disabled={!!busy} onChange={event => setProjectBudget(event.target.value)} required /></label>}
      {needsStepBudget && <label>此步预算（元）<input className="field" inputMode="decimal" value={stepBudget} disabled={!!busy} onChange={event => setStepBudget(event.target.value)} required /></label>}
      <button type="submit" className="btn btn-primary" disabled={!!busy}>按此预算继续</button>
    </form>}
    <RememberedDetails rememberKey={`workspace:${props.workspaceId}:home-production-recovery-more`} className="home-recovery-details"><summary>其他处理方式</summary><div>
      <button type="button" className="text-button" disabled={!!busy} onClick={() => { void act('read'); }}><RefreshCw size={14} />重新读取状态</button>
      {canCheckRepairedFile && <button type="button" className="text-button" disabled={!!busy} onClick={() => { void act('continue'); }}>文件已恢复，继续制作</button>}
      {coverLayoutFailure && <button type="button" className="text-button" disabled={!!busy} onClick={() => props.navigate('images', project.id)}>打开图片工作台<ArrowRight size={14} /></button>}
      {onOpenSteps && <button type="button" className="text-button" onClick={onOpenSteps}>查看步骤与恢复操作<ArrowRight size={14} /></button>}
      {canCancel && <button type="button" className="text-button" disabled={!!busy} onClick={() => { void act('cancel'); }}><Square size={14} />取消后续制作</button>}
    </div></RememberedDetails>
    {feedback && <p role="status">{feedback}</p>}
    {error && <p className="home-plan-error" role="alert">{error}</p>}
  </div>;
}
