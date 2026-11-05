import { useEffect, useMemo, useRef, useState } from 'react';
import type { PageProps } from '../types';
import type { AutomationContinuation, AutomationRule } from '../automation-types';
import { compileNaturalAutomationPlan, naturalAutomationRequestIssues } from '../lib/natural-automation-plan';
import { registerEditorSession } from '../lib/editor-session-guard';
import { normalizedNaturalDraftPlan, useNaturalAutomationDraft } from './useNaturalAutomationDraft';
import type { NaturalAutomationDraft, NaturalAutomationDraftOptions } from './useNaturalAutomationDraft';
import { useNaturalAutomationPlanning } from './useNaturalAutomationPlanning';
import { useAutomationReadiness } from './useAutomationReadiness';
import { useNaturalAutomationCreation } from './useNaturalAutomationCreation';
import type { AutomationActionResult } from '../lib/automation-dispatch';
import { naturalEffectiveBindings, naturalPreparationMissing } from '../lib/natural-automation-composer-state';
import { naturalModelSelection } from '../components/NaturalAutomationModels';
import { normalizeNaturalBinding, normalizeNaturalBindings, replaceNaturalProductionBinding, type NaturalModelBinding, type NaturalProductionCapability } from '../lib/natural-model-bindings';
import { automationProjectAvailability } from '../lib/automation-project-availability';

export interface NaturalAutomationSessionOptions { onClose?: () => void; onSaved?: () => void; draftOptions?: NaturalAutomationDraftOptions; }

export function useNaturalAutomationSession(props: PageProps, options: NaturalAutomationSessionOptions = {}) {
  const onClose = () => options.onClose?.(), onSaved = () => options.onSaved?.();
  const store = useNaturalAutomationDraft(props.workspaceId, props.activeProject.id || props.projects[0]?.id || '', options.draftOptions);
  const { draft, setDraft } = store;
  const [error, setError] = useState(''), [savedRule, setSavedRule] = useState<AutomationRule>();
  const mounted = useRef(true), latest = useRef({ props, store }); latest.current = { props, store };
  const creation = useNaturalAutomationCreation(props, store, setError, rule => { setSavedRule(rule); onSaved(); });
  const busy = creation.busy, saving = creation.isSaving;
  const runFlight = useRef<{ scope: string; token: string; ruleId?: string; dispatched: boolean; repeat: boolean; continuation?: AutomationContinuation; promise: Promise<AutomationActionResult>; resolve: (result: AutomationActionResult) => void; timer?: ReturnType<typeof setTimeout> } | undefined>(undefined);
  const [runBusy, setRunBusy] = useState(false), [runToken, setRunToken] = useState(''), [preparationRequest, setPreparationRequest] = useState(0);
  const planningSource = useNaturalAutomationPlanning(props, store, setError);
  const planning = { ...planningSource, start: (request?: Parameters<typeof planningSource.start>[0]) => {
    if (saving.current || runFlight.current) { setError('自动化正在创建，请稍后再发送新的修改。'); return Promise.resolve(undefined); }
    const source = store.current.current;
    const availability = automationProjectAvailability(props.workspaceId, props.projects, props.purgedProjects, source.projectId, request?.billingProjectId || source.acceptedPlanningProjectId || source.planningProjectId || planningSource.record?.projectId || source.projectId);
    if (availability.targetPurged || availability.billingOwnerPurged) { setError('这段对话关联的项目已永久删除，历史费用保留；请新建对话再发送 AI 需求。'); return Promise.resolve(undefined); }
    if (source.ruleId) {
      if (savedRule?.id !== source.ruleId || !props.configuration.workflows.some(workflow => workflow.id === source.workflowId)) { setError('正在读取当前流程的制作模型，请稍后再发送；尚未调用 AI。'); return Promise.resolve(undefined); }
      try { store.persist({ ...source, bindings: normalizeNaturalBindings({ ...source.bindings, ...readiness.bindings }) }); }
      catch (cause) { setError(cause instanceof Error ? cause.message : '制作模型设置未能保留，尚未发送新的 AI 请求。'); return Promise.resolve(undefined); }
    }
    return planningSource.start(request);
  } };
  const ownerId = draft.acceptedPlanningProjectId || draft.planningProjectId || planningSource.record?.projectId;
  const { targetPurged, billingOwnerPurged } = useMemo(() => automationProjectAvailability(props.workspaceId, props.projects, props.purgedProjects, draft.projectId, ownerId), [props.workspaceId, props.projects, props.purgedProjects, draft.projectId, ownerId]);
  const project = props.projects.find(item => item.id === draft.projectId && !item.purgedAt && !item.trashedAt);
  const selected = naturalModelSelection(props.configuration, 'text', draft.planner);
  const bindings = useMemo(() => naturalEffectiveBindings(props.configuration, draft.bindings, selected.model && selected.credentialId ? { modelConfigId: selected.model.id, credentialId: selected.credentialId } : draft.planner), [draft.bindings, draft.planner, selected.model?.id, selected.credentialId, props.configuration.models, props.configuration.connections, props.configuration.credentials]);
  const result = useMemo(() => {
    if (!draft.plan || !project) return {};
    try { const plan = { ...normalizedNaturalDraftPlan(draft.plan), unsupported: [...new Set([...draft.plan.unsupported, ...naturalAutomationRequestIssues(draft.acceptedInput || planning.record?.input || draft.input)])] }; return { compiled: compileNaturalAutomationPlan(plan, project, props.configuration, bindings, { allowPreparationQuestions: true, calendarResolved: draft.calendarResolved }) }; }
    catch (cause) { return { error: cause instanceof Error ? cause.message : '方案还需要调整。' }; }
  }, [draft.plan, bindings, draft.input, draft.acceptedInput, draft.calendarResolved, planning.record?.input, project?.id, project?.kind, project?.referenceFiles, props.configuration.models, props.configuration.connections, props.configuration.credentials, props.configuration.workflows]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => registerEditorSession({ id: `natural-automation-${props.workspaceId}`, projectId: draft.projectId, label: '一句话自动化方案', getState: () => ({ dirty: true, pending: saving.current, persistenceError: latest.current.store.issue || latest.current.store.recovery.error || undefined }), save: async () => latest.current.store.recovery.retry(), exportRecovery: () => latest.current.store.recovery.exportDraft(), flushRecovery: () => latest.current.store.recovery.retry() }), [props.workspaceId, draft.projectId]);
  useEffect(() => { const id = draft.ruleId; if (!id) return; void window.desktop?.automation?.snapshot(props.workspaceId).then(snapshot => { if (mounted.current && latest.current.store.current.current.ruleId === id) setSavedRule(snapshot.rules.find(rule => rule.id === id)); }).catch(() => undefined); }, [draft.ruleId, props.workspaceId]);
  const ensureCreated = () => {
    const current = latest.current, source = current.store.current.current;
    if (automationProjectAvailability(current.props.workspaceId, current.props.projects, current.props.purgedProjects, source.projectId, undefined).targetPurged) { setError('保存项目已永久删除，不能重新创建或继续制作；历史费用保留。'); return Promise.resolve(undefined); }
    return creation.ensureCreated();
  };
  const save = () => planning.active ? Promise.resolve(undefined) : ensureCreated();
  const existingFlow = !!draft.workflowId && props.configuration.workflows.some(workflow => workflow.id === draft.workflowId);
  const entries = props.ledger.filter(entry => entry.workflowRunId === planning.record?.runId), frozen = busy || !!draft.workflowSaved || existingFlow;
  const savedWorkflow = props.configuration.workflows.find(workflow => workflow.id === draft.workflowId);
  const currentRule = savedRule && savedRule.id === draft.ruleId && project && savedRule.projectId === project.id ? savedRule : undefined;
  const readiness = useAutomationReadiness(props, currentRule, savedWorkflow, rule => {
    setSavedRule(rule); setDraft(value => ({ ...value, preparationAnswers: rule.preparation?.answers || {}, needsSetup: readiness.remaining > 0 })); onSaved();
  }, () => { try { store.persist({ ...store.current.current, needsSetup: false }); } catch { props.notify('任务已开始，可在任务中心查看；当前草稿保存未完成。', 'info'); } onClose(); });
  const locked = busy || readiness.busy || runBusy;
  const runScope = () => { const value = latest.current.store.current.current; return `${latest.current.props.workspaceId}/${value.projectId}/${value.acceptedRequestId || value.requestId || ''}`; };
  function finishRun(result: AutomationActionResult) { const flight = runFlight.current; if (!flight) return; clearTimeout(flight.timer); runFlight.current = undefined; if (mounted.current) { setRunBusy(false); if (result.status === 'needs-input') setPreparationRequest(value => value + 1); } flight.resolve(result); }
  useEffect(() => () => { finishRun({ status: 'failed' }); }, []);
  useEffect(() => { if (runFlight.current && runFlight.current.scope !== runScope()) finishRun({ status: 'failed' }); }, [props.workspaceId, draft.projectId, draft.acceptedRequestId]);
  useEffect(() => {
    const flight = runFlight.current;
    if (!flight?.ruleId || flight.dispatched || readiness.loadedRuleId !== flight.ruleId || readiness.dispatchLoading || savedWorkflow?.id !== store.current.current.workflowId) return;
    if (flight.scope !== runScope()) { finishRun({ status: 'failed' }); return; }
    flight.dispatched = true;
    if (readiness.remaining) { readiness.reveal(); finishRun({ status: 'needs-input' }); return; }
    void readiness.perform('run', { reuseCompleted: !flight.repeat, continuation: flight.continuation }).then(result => { if (runFlight.current === flight) finishRun(result); });
  }, [runToken, readiness.loadedRuleId, readiness.dispatchLoading, readiness.remaining, savedWorkflow?.id]);
  function createAndRun(options: { repeat?: boolean; continuation?: AutomationContinuation } = {}): Promise<AutomationActionResult> {
    if (targetPurged) { setError('保存项目已永久删除，不能重新运行或查看旧作品；历史费用保留。'); return Promise.resolve({ status: 'failed' }); }
    if (runFlight.current) return runFlight.current.promise;
    if (planning.active || busy || readiness.busy) return Promise.resolve({ status: 'failed' });
    if (!options.repeat && readiness.lastJob) return Promise.resolve({ status: 'existing', job: readiness.lastJob });
    const current = store.current.current;
    if (!current.ruleId && !current.workflowSaved && !existingFlow && (result.error || !project || project.kind !== current.plan?.outputKind || result.compiled?.missing.length || current.plan && naturalPreparationMissing(current.plan, current.preparationAnswers || {}).length)) { setPreparationRequest(value => value + 1); return Promise.resolve({ status: 'needs-input' }); }
    let resolve!: (result: AutomationActionResult) => void; const promise = new Promise<AutomationActionResult>(done => { resolve = done; });
    const flight = { scope: runScope(), token: crypto.randomUUID(), ruleId: undefined as string | undefined, dispatched: false, repeat: !!options.repeat, continuation: options.continuation && { ...options.continuation }, promise, resolve, timer: undefined as ReturnType<typeof setTimeout> | undefined }; runFlight.current = flight; setRunBusy(true); setRunToken(flight.token);
    flight.timer = setTimeout(() => { if (runFlight.current === flight) { setError('运行设置还未读取完成，当前方案保留。请再次确认开始；不会自动运行。'); finishRun({ status: 'failed' }); } }, 20000);
    void ensureCreated().then(rule => {
      if (runFlight.current !== flight) return;
      if (!rule || flight.scope !== runScope()) { finishRun({ status: 'failed' }); return; }
      flight.ruleId = rule.id; setRunToken(`${flight.token}:ready`);
    });
    return promise;
  }
  function setProductionBinding(capability: NaturalProductionCapability, value: NaturalModelBinding): boolean {
    if (targetPurged) { setError('保存项目已永久删除，制作设置保持只读。'); return false; }
    const source = store.current.current;
    if (saving.current || locked || planning.active) { setError('当前正在处理任务，结束后再调整制作模型。'); return false; }
    if (source.ruleId && savedRule?.id === source.ruleId && savedRule.enabled) { setError('请先暂停自动触发，再调整制作模型。'); return false; }
    if (source.ruleId ? savedRule?.id !== source.ruleId || !savedWorkflow : source.workflowSaved || existingFlow) { setError('请先完成并确认当前自动化的创建，再调整已保存流程的制作模型。'); return false; }
    try {
      const binding = normalizeNaturalBinding(value);
      store.persist({ ...source, bindings: replaceNaturalProductionBinding(source.bindings, capability, binding) });
      if (source.ruleId) readiness.setCapability(capability, binding);
      setError(''); return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : '制作模型设置未能保存，原设置保留。'); return false; }
  }
  function newDraft() {
    if (locked || planning.active) return;
    try { store.startNew(); planning.reset(); setSavedRule(undefined); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : '新草稿未能保存，原流程和费用保留。'); }
  }
  const changeProject = (id: string) => { setDraft(value => ({ ...value, planningProjectId: value.planningProjectId || (value.requestId ? planning.record?.projectId || value.projectId : undefined), projectId: id })); setError(''); };
  function adoptDraft(snapshot: NaturalAutomationDraft): boolean {
    if (locked || planning.active) return false;
    if (snapshot.version !== 1 || snapshot.workspaceId !== props.workspaceId) { setError('这份方案不属于当前工作区。'); return false; }
    try {
      if (JSON.stringify(snapshot) === JSON.stringify(store.current.current)) return true;
      const previousRuleId = store.current.current.ruleId;
      store.persist(structuredClone(snapshot)); planning.reset(); setError('');
      if (snapshot.ruleId !== previousRuleId) setSavedRule(undefined);
      if (snapshot.requestId) void planning.read();
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : '已有方案未能恢复，原记录和费用保留。'); return false; }
  }
  return { store, draft, setDraft, project, selected, bindings, result, planning, error, setError, busy, locked, frozen, savedRule: currentRule, setSavedRule, readiness, entries, ownerId, targetPurged, billingOwnerPurged, save, ensureCreated, createAndRun, runBusy, preparationRequest, newDraft, changeProject, setProductionBinding, adoptDraft, existingFlow, savedWorkflow };
}
export type NaturalAutomationSession = ReturnType<typeof useNaturalAutomationSession>;
