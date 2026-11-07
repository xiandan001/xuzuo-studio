import { RememberedDetails } from './RememberedDetails';
import { useRememberedBoolean } from '../hooks/useRememberedBoolean';
import { runDetailKey } from '../lib/run-details';
import { isLocalExportRun } from '../lib/workflow-purpose';
import { TaskRunActions } from './TaskRunActions';
import { RunReferenceRecovery } from './RunReferenceRecovery';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, CheckCircle2, CirclePause, LoaderCircle, Pencil, Play, RotateCcw, ShieldCheck, Square, AlertCircle } from 'lucide-react';
import type { WorkflowRun, WorkflowStep, WorkflowAttempt } from '../configuration-types';
import { ArtifactResults } from './ArtifactResults';
import { Select } from './Select';
import type { PageProps } from '../types';
import { money, budgetLabel, parseOptionalBudget } from '../data';
import { CostTotal } from './CostAmount';
import { attemptCostRecord, costPrimary, runCostRecords, summarizeCosts } from '../lib/cost-display';
import '../pages/workflows.css';
import { canResumeLocalImageExport } from '../lib/local-image-export';
import { RUN_LABELS, isModelStep, kindLabel, StepIcon, WorkflowDialog } from './workflow-shared';

function AttemptDetails({ attempts, props, live, projectId, stepRole }: { attempts: WorkflowAttempt[]; props: PageProps; live: boolean; projectId: string; stepRole?: WorkflowStep['role'] }) {
  const last = attempts.at(-1);
  const [selectedId, setSelectedId] = useState(last?.id || '');
  useEffect(() => { setSelectedId(last?.id || ''); }, [last?.id]);
  const attempt = attempts.find(item => item.id === selectedId) || last;
  if (!attempt) return null;
  const documentKind = props.projects.find(project => project.id === projectId)?.kind;
  const documentResult = live && !['planner', 'reviewer'].includes(stepRole || '') && documentKind && documentKind !== 'image' && attempt.artifacts?.some(artifact => artifact.kind === 'text' || artifact.kind === 'office');
  return <div className="wf-attempt-details">{attempt.recoveredFromReceiptAt && <p className="wf-run-safety-note"><ShieldCheck size={14} />此步骤已从确认回执恢复，未重新调用模型；原调用费用保留。</p>}{attempts.length > 1 && <label className="wf-attempt-picker">查看尝试<Select aria-label={`查看步骤 ${attempt.stepName} 的历史尝试`} value={attempt.id} onValueChange={setSelectedId} options={attempts.map((item, index) => ({ value: item.id, label: `第 ${index + 1} 次 · ${item.status === 'complete' ? '完成' : item.status === 'failed' ? '失败' : item.status === 'cancelled' ? '取消' : '处理中'} · ${costPrimary(attemptCostRecord(item, props.ledger, live))}` }))} /></label>}{attempt.error && <p className="wf-attempt-error" role="status"><AlertCircle size={13} />{attempt.error}</p>}{attempt.summary && (documentResult ? <p className="wf-attempt-summary">文档内容已生成，点击下方“查看文档”即可检查与编辑完整内容。</p> : <p className="wf-attempt-summary">{attempt.summary}</p>)}{attempt.costState === 'unknown' && <p className="wf-unknown-cost">本次费用尚未完整计算，不能按零元或免费处理。</p>}{attempt.usage && <p className="wf-usage">{typeof attempt.usage.inputTokens === 'number' ? `输入 ${attempt.usage.inputTokens} Token` : ''}{typeof attempt.usage.outputTokens === 'number' ? ` · 输出 ${attempt.usage.outputTokens} Token` : ''}{typeof attempt.usage.images === 'number' ? ` · ${attempt.usage.images} 张图` : ''}{typeof attempt.usage.seconds === 'number' ? ` · ${attempt.usage.seconds} 秒` : ''}</p>}<RememberedDetails rememberKey={`workflow-attempt:${attempt.id}:raw-log`}><summary>查看本次输入、提示词与{live ? '结果' : '模拟结果'}</summary><b>本次输入</b><pre>{attempt.input}</pre>{attempt.prompt && <><b>本次提示词</b><pre>{attempt.prompt}</pre></>}<b>结果正文或摘要</b><pre>{attempt.summary || '当前尝试尚未返回内容。'}</pre>{attempt.providerRequestId && <><b>供应商请求编号</b><pre>{attempt.providerRequestId}</pre></>}</RememberedDetails>{attempt.artifacts?.length ? <ArtifactResults key={attempt.id} fileScope="attempt" artifacts={attempt.artifacts} runner={props.workflowRunner} projectId={projectId} documentKind={documentKind === 'image' || ['planner', 'reviewer'].includes(stepRole || '') ? undefined : documentKind} onEditDocument={documentResult ? () => props.navigate('documents', projectId) : undefined} /> : null}</div>;
}

export function WorkflowRunCard({ props, run: summary, referenceFilesRequest = 0 }: { props: PageProps; run: WorkflowRun; referenceFilesRequest?: number }) {
  const [detailsOpen, setDetailsOpen] = useRememberedBoolean(`task:${summary.id}:workflow-details`, !summary.contentTruncated && summary.projectId === props.activeProject.id);
  const [detail, setDetail] = useState<WorkflowRun>();
  const [detailRead, setDetailRead] = useState<{ key: string; loading: boolean; error: string }>();
  const [detailRequest, setDetailRequest] = useState(0), detailPending = useRef(false);
  const [referenceFeedback, setReferenceFeedback] = useState(''), [refreshingReferences, setRefreshingReferences] = useState(false);
  const [referenceFocus, setReferenceFocus] = useState('');
  const referenceScope = useRef(summary.id), referencePending = useRef(false); referenceScope.current = summary.id;
  const detailKey = runDetailKey(summary), currentRead = detailRead?.key === detailKey ? detailRead : undefined;
  const run = detail && runDetailKey(detail) === runDetailKey(summary) ? detail : summary;
  useEffect(() => {
    if (!detailsOpen || !summary.contentTruncated) { detailPending.current = false; return; }
    const load = props.workflowRunner.loadRunDetail;
    if (!load) { detailPending.current = false; setDetailRead({ key: detailKey, loading: false, error: '当前环境无法读取完整详情，请连接桌面后台。' }); return; }
    let stopped = false; detailPending.current = true; setDetailRead({ key: detailKey, loading: true, error: '' });
    void Promise.resolve().then(() => load.call(props.workflowRunner, summary.id)).then(value => {
      if (!stopped) { detailPending.current = false; setDetail(value); setDetailRead({ key: detailKey, loading: false, error: '' }); }
    }, cause => {
      if (!stopped) { detailPending.current = false; setDetailRead({ key: detailKey, loading: false, error: cause instanceof Error ? cause.message : '执行详情读取失败。' }); }
    });
    return () => { stopped = true; detailPending.current = false; };
  }, [detailsOpen, summary.id, detailKey, summary.contentTruncated, props.workflowRunner.loadRunDetail, detailRequest]);
  function rereadDetail() {
    if (detailPending.current) return;
    detailPending.current = true; setDetailRead({ key: detailKey, loading: true, error: '' }); setDetailRequest(value => value + 1);
  }
  useEffect(() => { if (summary.referenceIssue) setDetailsOpen(true); }, [summary.referenceIssue?.sourceStepId, summary.referenceIssue?.artifactId, summary.referenceIssue?.reason]);
  useEffect(() => () => { referenceScope.current = ''; }, []);
  useEffect(() => {
    if (!referenceFocus || !detailsOpen || run.contentTruncated) return;
    const frame = requestAnimationFrame(() => { const target = document.getElementById(`workflow-source-${run.id}-${referenceFocus}`); target?.focus({ preventScroll: true }); target?.scrollIntoView({ block: 'nearest', behavior: 'auto' }); });
    return () => cancelAnimationFrame(frame);
  }, [referenceFocus, detailsOpen, run.contentTruncated, run.id, referenceFilesRequest]);
  function showReferenceFiles() { setDetailsOpen(true); setReferenceFocus(run.referenceIssue?.sourceStepId || ''); if (run.contentTruncated && !currentRead?.loading) rereadDetail(); }
  useEffect(() => { if (referenceFilesRequest > 0 && summary.referenceIssue) showReferenceFiles(); }, [referenceFilesRequest]);
  async function refreshReferenceFiles() {
    if (!props.workflowRunner.listProjectArtifacts || referencePending.current) return;
    const scope = run.id; referencePending.current = true; setRefreshingReferences(true); setReferenceFeedback('');
    try { await props.workflowRunner.listProjectArtifacts(run.projectId, { refresh: true }); if (referenceScope.current === scope) { setReferenceFeedback('文件清单已刷新。恢复文件后请重新点击继续；本次未调用模型。'); showReferenceFiles(); } }
    catch (cause) { if (referenceScope.current === scope) setReferenceFeedback(cause instanceof Error ? cause.message : '文件清单未能刷新，请返回工作台检查。'); }
    finally { referencePending.current = false; if (referenceScope.current === scope) setRefreshingReferences(false); }
  }
  const archived = Boolean(run.hiddenAt || run.trashedAt);
  const [confirmation, setConfirmation] = useState<{ action: 'retry' | 'continue'; stepId?: string; name: string } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [continueBudget, setContinueBudget] = useState('');
  const [continueBudgetError, setContinueBudgetError] = useState('');
  const terminal = ['complete', 'cancelled', 'interrupted', 'failed'].includes(run.status);
  const live = run.mode === 'live';
  const localExport = isLocalExportRun(run);
  const labels: Record<WorkflowRun['status'], string> = live ? { running: '正在执行', paused: '已暂停', 'waiting-review': '等待人工检查', complete: '已完成', cancelled: '已取消', interrupted: '已中断', failed: '执行失败' } : RUN_LABELS;
  const runLabel = run.status === 'cancelled' && run.supersededByRunId ? '已由后续创作替代' : run.retryStepOnly && run.status === 'complete' ? '单步重试完成' : labels[run.status];
  const cost = summarizeCosts(runCostRecords(run, props.ledger));
  const project = props.projects.find(item => item.id === run.projectId);
  const editableReview = run.mode === 'live' && run.status === 'waiting-review' && !!project && ['word', 'ppt', 'excel'].includes(project.kind);
  function retry(stepId: string, name: string) { if (live && !props.preferences.confirmGeneration) { props.workflowRunner.retry(run.id, stepId); return; } if (live) { setAcknowledged(false); setConfirmation({ action: 'retry', stepId, name }); } else props.workflowRunner.retry(run.id, stepId); }
  function continueRun() {
    if (!live || !props.preferences.confirmGeneration) { props.workflowRunner.resume(run.id); return; }
    const step = run.snapshot.steps[run.stepIndex];
    setContinueBudget(step?.budgetCents == null ? '' : money(step.budgetCents)); setContinueBudgetError(''); setAcknowledged(false);
    setConfirmation({ action: 'continue', stepId: step?.id, name: step?.name || '从当前位置继续' });
  }
  function confirm() {
    if (!confirmation || !acknowledged) return;
    if (confirmation.action === 'retry' && confirmation.stepId) props.workflowRunner.retry(run.id, confirmation.stepId);
    else {
      if (confirmation.stepId !== run.snapshot.steps[run.stepIndex]?.id) { setContinueBudgetError('当前步骤已变化，请关闭后重新确认。'); return; }
      let limit: number | undefined;
      try { limit = parseOptionalBudget(continueBudget); } catch (error) { setContinueBudgetError(error instanceof Error ? error.message : '请填写非负有效金额或留空。'); return; }
      props.workflowRunner.resume(run.id, limit ?? null);
    }
    setConfirmation(null);
  }
  return <section className={`panel wf-run-card ${live ? 'wf-real-run' : ''}`}><header><span className={`wf-run-state-icon ${run.status}`}>{run.status === 'running' ? <LoaderCircle size={20} className="spin" /> : run.status === 'complete' ? <CheckCircle2 size={20} /> : run.status === 'waiting-review' ? <ShieldCheck size={20} /> : run.status === 'failed' ? <AlertCircle size={20} /> : <CirclePause size={20} />}</span><div><h3>{run.workflowName}<span className={`wf-run-mode ${live ? 'live' : ''}`}>{localExport ? '本地导出' : live ? '真实' : '模拟'}</span></h3><p>{project?.name || '关联项目'}<i />{Number.isNaN(Date.parse(run.createdAt)) ? run.createdAt : new Date(run.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</p></div><span className={`wf-run-badge ${run.status}`}>{runLabel}</span><strong>{localExport ? '未调用模型 ' : live ? '调用费用 ' : '模拟费用 '}<CostTotal summary={cost} /></strong></header>
    {run.referenceIssue ? <RunReferenceRecovery issue={run.referenceIssue} message={run.error} onShowFiles={showReferenceFiles} onRefreshFiles={props.workflowRunner.listProjectArtifacts ? () => { void refreshReferenceFiles(); } : undefined} onReturnToStudio={() => props.navigate(project?.kind === 'image' ? 'images' : 'documents', run.projectId)} refreshing={refreshingReferences} feedback={referenceFeedback} /> : run.error && <div className="wf-run-error" role="status"><AlertCircle size={15} /><span>{run.error}</span></div>}{run.pauseRequested && <div className="wf-retry-notice"><CirclePause size={13} /><span>已请求暂停，将在当前请求结束后停止后续步骤；已经发出的请求仍可能收费。</span></div>}
    <button className="btn btn-ghost" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(value => !value)}>{detailsOpen ? '收起步骤与结果' : '查看步骤与结果'}</button>{detailsOpen && currentRead?.error && <div className="wf-run-error" role="alert"><span>{currentRead.error}</span>{props.workflowRunner.loadRunDetail && <button type="button" className="btn btn-secondary" onClick={rereadDetail} title="只读取已有记录，不调用模型或新增费用">重新读取详情</button>}</div>}{detailsOpen && currentRead?.loading && run.contentTruncated && <p role="status">正在按需读取完整执行详情…</p>}{detailsOpen && !run.contentTruncated && <div className="wf-run-steps">{run.snapshot.steps.map((step, index) => {
      const attempts = run.attempts.filter(attempt => attempt.stepId === step.id); const last = attempts.at(-1); const current = index === run.stepIndex;
      const state = !step.enabled ? '已停用' : (current && run.status === 'waiting-review') || last?.status === 'waiting-review' ? '待人工确认' : last?.status === 'running' ? run.status === 'paused' ? '已暂停' : live ? '处理中' : '模拟中' : last?.status === 'complete' ? '已完成' : last?.status === 'failed' ? '执行失败' : last?.status === 'cancelled' ? '本次已取消' : run.retryStepOnly ? '未重新执行' : terminal ? '未执行' : '待执行';
      const stepCost = summarizeCosts(attempts.map(attempt => attemptCostRecord(attempt, props.ledger, live)));
      return <div id={`workflow-source-${run.id}-${step.id}`} tabIndex={-1} className={`wf-run-step ${current && !terminal ? 'current' : ''} ${!step.enabled ? 'disabled' : ''}`} key={step.id}><span className="wf-run-step-mark">{state === '已完成' ? <Check size={14} /> : <StepIcon kind={step.kind} size={14} />}</span><div className="wf-run-step-info"><div><strong>{step.name}</strong><span>{state}</span></div><small>{kindLabel(step.kind)}{attempts.length > 0 && <> · {attempts.length} 次尝试 · <CostTotal summary={stepCost} /></>}</small><AttemptDetails stepRole={step.role} attempts={attempts} props={props} live={live} projectId={run.projectId} /></div>{step.enabled && isModelStep(step.kind) && attempts.length > 0 && terminal && !archived && <button className="btn btn-ghost wf-retry-step" aria-label={`重试步骤 ${step.name}`} onClick={() => retry(step.id, step.name)} title={live ? '再次向服务商请求，可能再次收费' : '新增模拟调用与费用'}><RotateCcw size={13} />重试此步</button>}</div>;
    })}</div>}{run.retryStepOnly && <div className="wf-retry-notice"><RotateCcw size={13} /><span>{run.status === 'complete' ? '本次仅完成单步重试，后续步骤未重新运行；已有结果和历史费用仍保留。' : '本次仅重试所选步骤，后续步骤不会自动重新运行。'}</span></div>}
    <footer><span><ShieldCheck size={13} />{canResumeLocalImageExport(run) ? '继续本地适配不调用模型，已发生费用保留' : live ? '每次重试独立计费，返回用量后自动累计花费' : '演示费用按尝试累计，历史记录保留'}</span><div><TaskRunActions run={run} runner={props.workflowRunner} notify={props.notify} />{!archived && canResumeLocalImageExport(run) && <button type="button" className="btn btn-primary" title="不调用模型，不新增API费用" onClick={() => props.workflowRunner.resume(run.id)}>继续本地适配</button>}{!archived && <>{run.status === 'running' && <button className="btn btn-secondary" disabled={run.pauseRequested} onClick={() => props.workflowRunner.pause(run.id)}><CirclePause size={14} />{run.pauseRequested ? '正在暂停…' : '暂停'}</button>}{run.status === 'paused' && <button className="btn btn-primary" onClick={() => live ? continueRun() : props.workflowRunner.resume(run.id)}><Play size={14} />继续运行</button>}{run.status === 'waiting-review' && (editableReview ? <><button className="btn btn-primary" onClick={() => props.navigate('documents', run.projectId)}><Pencil size={14} />编辑并交付</button><RememberedDetails rememberKey={`task:${run.id}:retry-parameters`} className="wf-advanced-settings"><summary>更多检查操作</summary><p>使用原结果继续不会采用尚未绑定的人工编辑稿，后续步骤按原工作流执行。</p><button className="btn btn-secondary" onClick={() => props.workflowRunner.resume(run.id)}>使用原结果继续</button></RememberedDetails></> : <button className="btn btn-primary" onClick={() => props.workflowRunner.resume(run.id)}><Check size={14} />确认通过，继续</button>)}{live && (run.status === 'failed' || run.status === 'interrupted') && <button className="btn btn-primary" onClick={continueRun}><Play size={14} />从当前位置继续</button>}{!terminal && <button className="btn btn-secondary" onClick={() => props.workflowRunner.cancel(run.id)}><Square size={12} />取消运行</button>}{run.status === 'complete' && project && project.status !== 'complete' && <button className="btn btn-secondary" onClick={() => props.navigate(project.kind === 'image' ? 'images' : 'documents', project.id)}><Check size={13} />验收并交付当前版本</button>}</>}<button className="btn btn-ghost" onClick={() => props.navigate(project?.kind === 'image' ? 'images' : 'documents', run.projectId)}>查看项目<ArrowRight size={13} /></button></div></footer>
    {confirmation && <WorkflowDialog title={confirmation.action === 'retry' ? '确认单步重试' : '确认继续执行'} subtitle={confirmation.name} className="wf-charge-dialog" onClose={() => setConfirmation(null)} footer={<><button className="btn btn-secondary" onClick={() => setConfirmation(null)}>取消</button><button className="btn btn-primary" disabled={!acknowledged} onClick={confirm}>确认，接受可能再次收费</button></>}><div className="wf-charge-body"><AlertCircle size={28} /><p>{confirmation.action === 'retry' ? '会重新向该步骤配置的服务商发送请求，可能再次收费；后续步骤不会自动重新执行。' : run.status === 'paused' ? '会从暂停位置继续当前及后续步骤，新的请求可能产生费用。' : '会从失败或中断位置重新尝试，然后继续后续步骤，可能再次收费。'}</p><p>会保留本次运行的步骤参数；相同 ID 的模型、连接和凭证使用当前配置。修改了流程模板中的提示词或尺寸时，请重新运行流程。之前发生的费用仍保留，超时或中断不代表供应商未计费。</p>{confirmation.action === 'continue' && <div className="wf-continue-budget"><label className="wf-field"><span>当前步骤金额上限（元，选填）</span><input className="field" aria-label="继续执行当前步骤金额上限" type="number" min="0" step="0.01" value={continueBudget} placeholder="选填，留空不设上限" onChange={event => { setContinueBudget(event.target.value); setContinueBudgetError(''); }} /><small>留空会清除本次运行当前步骤上限，填写 0 表示零上限。已保存流程模板、项目上限及其它提示词与参数保持不变。</small></label><p>项目金额上限独立保留：<b>{budgetLabel(project?.budgetCents)}</b></p>{continueBudgetError && <p className="form-error" role="alert">{continueBudgetError}</p>}</div>}<label><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />我已检查现有记录，接受重新发送请求可能产生的费用。</label></div></WorkflowDialog>}
  </section>;
}
