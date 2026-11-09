import { useEffect, useRef, useState } from 'react';
import type { PageProps, Project } from '../types';
import type { AutomationPlanningRecord, NaturalAutomationPlan } from '../natural-automation-types';
import { naturalAutomationRequestIssues, parseNaturalAutomationPlan } from '../lib/natural-automation-plan';
import { naturalModelSelection, type NaturalBinding } from '../components/NaturalAutomationModels';
import { normalizedNaturalDraftPlan, type NaturalAutomationDraft, type useNaturalAutomationDraft } from './useNaturalAutomationDraft';
import { naturalTargetProject } from '../lib/natural-automation-composer-state';
import { normalizeReasoningEffort } from '../lib/reasoning-options';

export interface NaturalAutomationPlanningStartOptions {
  input?: string; priorPlanId?: string; currentPlan?: NaturalAutomationPlan; contextNotes?: string; calendarResolved?: boolean; billingProjectId?: string;
}
function newCalendarIntent(input: string): boolean {
  return naturalAutomationRequestIssues(input).some(issue => /日历|cron/i.test(issue)) || input.split(/[，,。；;\n]/).some(clause => !/(?:主题|标题|文案|说明|标语|台词|文字)/.test(clause) && !/(?:不要|不需要|不用|不必|无需|不再|不按|不会).{0,6}\d{1,2}\s*(?:点|[:：]\d{2})/.test(clause) && /(?:还是|改回|恢复|仍然|就按).{0,8}\d{1,2}\s*(?:点|[:：]\d{2})/.test(clause));
}
export function naturalPlanningStartDraft(draft: NaturalAutomationDraft, requestId: string, input: string, billingProjectId: string, planner: NaturalBinding, options?: NaturalAutomationPlanningStartOptions): NaturalAutomationDraft {
  const preserve = options !== undefined, base = preserve ? draft.plan || options.currentPlan : undefined;
  const acceptedRequestId = base ? draft.plan ? draft.acceptedRequestId || draft.requestId : options?.priorPlanId : undefined;
  const acceptedInput = base ? draft.plan ? draft.acceptedInput || draft.input : base.objective : undefined;
  const acceptedPlanningProjectId = base ? draft.acceptedPlanningProjectId || draft.planningProjectId || draft.projectId : undefined;
  return { ...draft, input, planningProjectId: billingProjectId, requestId, cancelledRequestId: undefined, bindings: { ...draft.bindings, text: draft.bindings.text || planner },
    ...(preserve ? { plan: base, acceptedRequestId, acceptedInput, acceptedPlanningProjectId } : { plan: undefined, preparationAnswers: {}, calendarResolved: false, needsSetup: false, workflowId: undefined, creationKey: undefined, workflowSaved: false, ruleId: undefined, acceptedRequestId: undefined, acceptedInput: undefined, acceptedPlanningProjectId: undefined }),
    requestedCalendarResolved: newCalendarIntent(input) ? false : preserve ? options.calendarResolved ?? draft.calendarResolved ?? false : false,
  };
}
export function naturalPlanningAcceptedDraft(previous: NaturalAutomationDraft, value: AutomationPlanningRecord, projects: Project[]): NaturalAutomationDraft {
  if (value.workspaceId !== previous.workspaceId || value.projectId !== (previous.planningProjectId || previous.projectId) || value.id !== previous.requestId || value.id === previous.cancelledRequestId || value.status !== 'complete' || !value.resultText) return previous;
  const original = parseNaturalAutomationPlan(value.resultText);
  const sameAccepted = !!previous.plan && (previous.acceptedRequestId === value.id || !previous.acceptedRequestId && previous.requestedCalendarResolved === undefined);
  const inputCalendar = newCalendarIntent(value.input) && !naturalAutomationRequestIssues(value.input).some(issue => /日历|cron/i.test(issue)) && !original.unsupported.some(issue => /日历|cron|每天|每周|几点|固定.{0,5}时间/i.test(issue)) ? ['本次又要求固定日历时间，当前仍只支持手动或间隔执行，请重新确认执行时机。'] : [];
  const plan = { ...(sameAccepted ? previous.plan! : original), unsupported: [...new Set([...original.unsupported, ...inputCalendar])] };
  const next = { ...previous, plan, acceptedRequestId: value.id, acceptedInput: value.input, acceptedPlanningProjectId: value.projectId, planningProjectId: value.projectId,
    projectId: sameAccepted && previous.workflowSaved ? previous.projectId : naturalTargetProject(projects, previous.projectId, plan.outputKind),
    ...(!sameAccepted ? { workflowId: undefined, creationKey: undefined, workflowSaved: false, ruleId: undefined, needsSetup: false, calendarResolved: previous.requestedCalendarResolved ?? (newCalendarIntent(value.input) ? false : previous.calendarResolved) } : {}), requestedCalendarResolved: undefined,
  };
  return JSON.stringify(next) === JSON.stringify(previous) ? previous : next;
}

export function useNaturalAutomationPlanning(props: PageProps, store: ReturnType<typeof useNaturalAutomationDraft>, onError: (message: string) => void) {
  const bridge = window.desktop?.automationPlanning;
  const [record, setRecord] = useState<AutomationPlanningRecord>(), [history, setHistory] = useState<AutomationPlanningRecord[]>([]), [pending, setPending] = useState(false);
  const mounted = useRef(true), sending = useRef(false), current = useRef({ props, store, onError }); current.current = { props, store, onError };
  const generation = useRef(0), flight = useRef<{ id: string; cancelled: boolean; dispatched: boolean; generation: number } | undefined>(undefined);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const error = (cause: unknown) => { if (mounted.current) current.current.onError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '规划记录未能读取，原结果和费用仍保留。'); };
  function accept(value: AutomationPlanningRecord) {
    const { store, props } = current.current, draft = store.current.current;
    if (!mounted.current || value.workspaceId !== props.workspaceId || value.projectId !== (draft.planningProjectId || draft.projectId) || value.id !== draft.requestId) return;
    setRecord(value);
    if (value.status === 'complete' && value.resultText) {
      try {
        store.setDraft(previous => naturalPlanningAcceptedDraft(previous, value, props.projects));
      }
      catch (cause) { error(cause); }
    }
    if (value.error) current.current.onError(value.error);
  }
  async function read() {
    const id = current.current.store.current.current.requestId, scope = current.current.props.workspaceId, epoch = generation.current; if (!id || !bridge) return;
    try { const value = await bridge.read({ id, workspaceId: scope }); if (epoch === generation.current && current.current.store.current.current.requestId === id) { accept(value); return value; } }
    catch (cause) { if (epoch === generation.current && current.current.store.current.current.requestId === id) error(cause); }
  }
  useEffect(() => { if (!bridge) return; const scope = props.workspaceId; let stopped = false; void bridge.list(scope).then(items => { if (!stopped && mounted.current && current.current.props.workspaceId === scope) setHistory(items); }).catch(cause => { if (!stopped) error(cause); }); if (store.current.current.requestId && !sending.current) void read(); return () => { stopped = true; }; }, [bridge, props.workspaceId, store.draft.requestId]);
  useEffect(() => {
    if (!record || !['starting', 'running', 'cancelling'].includes(record.status)) return;
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => { await read(); if (!stopped) timer = setTimeout(() => { void poll(); }, document.hidden ? 2500 : 800); };
    timer = setTimeout(() => { void poll(); }, 500);
    return () => { stopped = true; clearTimeout(timer); };
  }, [record?.id, record?.status]);
  async function start(options?: NaturalAutomationPlanningStartOptions) {
    if (sending.current) return;
    if (!bridge) { onError('请在新版 Windows 桌面应用中生成方案；浏览器预览不能调用本机密钥。'); return; }
    const { props, store } = current.current, draft = store.current.current;
    const input = options?.input ?? draft.input, billingProjectId = options?.billingProjectId || draft.projectId;
    const selected = naturalModelSelection(props.configuration, 'text', draft.planner);
    const reasoning = draft.planner.reasoningEffort === undefined ? {} : { reasoningEffort: normalizeReasoningEffort(props.configuration.connections.find(connection => connection.id === selected.model?.connectionId), selected.model, draft.planner.reasoningEffort) };
    if (!input.trim() || !props.projects.some(project => project.id === billingProjectId && project.workspaceId === props.workspaceId && !project.trashedAt) || !selected.model || !selected.credentialId) { onError('先写下需求，并选择保存项目和一个可用的文字模型 / Key。'); return; }
    if (options && !options.priorPlanId && (options.currentPlan || options.contextNotes?.trim())) { onError('续改需要先选择一份已完成的方案；已有方案和费用没有改变。'); return; }
    let contextPlan: NaturalAutomationPlan | undefined;
    try { if (options?.priorPlanId && (options.currentPlan || draft.plan)) contextPlan = parseNaturalAutomationPlan(JSON.stringify(normalizedNaturalDraftPlan(options.currentPlan || draft.plan!))); } catch (cause) { error(cause); return; }
    const next = naturalPlanningStartDraft(draft, crypto.randomUUID(), input, billingProjectId, { modelConfigId: selected.model.id, credentialId: selected.credentialId, ...reasoning }, options);
    try { store.persist(next); } catch (cause) { error(cause); return; }
    const attempt = { id: next.requestId!, cancelled: false, dispatched: false, generation: ++generation.current }; flight.current = attempt;
    sending.current = true; setPending(true); setRecord(undefined); onError('');
    try {
      await window.desktop?.automation?.syncContext({ workspaceId: props.workspaceId, workspaces: props.workspaces, projects: props.projects, workflows: props.configuration.workflows, models: props.configuration.models, connections: props.configuration.connections });
      if (attempt.cancelled || attempt.generation !== generation.current || current.current.store.current.current.requestId !== next.requestId) return;
      attempt.dispatched = true;
      const request = { id: next.requestId!, workspaceId: props.workspaceId, projectId: billingProjectId, input: input.trim(), modelConfigId: selected.model.id, credentialId: selected.credentialId, ...reasoning, ...(options?.priorPlanId ? { priorPlanId: options.priorPlanId, ...(contextPlan ? { currentPlan: contextPlan } : {}), ...(options.contextNotes !== undefined ? { contextNotes: options.contextNotes } : {}), calendarResolved: next.requestedCalendarResolved } : {}) };
      let result = await bridge.start(request);
      if (attempt.cancelled) result = await bridge.cancel({ id: next.requestId!, workspaceId: props.workspaceId });
      if (attempt.generation === generation.current && mounted.current && current.current.store.current.current.requestId === next.requestId) { accept(result); return attempt.cancelled ? undefined : result; }
    } catch (cause) { if (!attempt.cancelled && attempt.generation === generation.current && current.current.store.current.current.requestId === next.requestId) error(cause); }
    finally { if (flight.current === attempt) { flight.current = undefined; sending.current = false; if (mounted.current) setPending(false); } }
  }
  async function cancel() {
    const draft = current.current.store.current.current; if (!bridge || !draft.requestId) return;
    const attempt = flight.current;
    const cancelledRequestId = draft.plan && draft.acceptedRequestId !== draft.requestId ? draft.requestId : draft.cancelledRequestId;
    if (attempt?.id === draft.requestId) {
      attempt.cancelled = true;
      if (!attempt.dispatched) {
        try { current.current.store.persist({ ...draft, cancelledRequestId, requestId: draft.plan ? draft.acceptedRequestId : undefined, planningProjectId: draft.plan ? draft.acceptedPlanningProjectId || draft.planningProjectId : draft.planningProjectId, requestedCalendarResolved: undefined }); } catch (cause) { error(cause); }
        flight.current = undefined; sending.current = false; setPending(false); setRecord(undefined); onError('规划尚未提交，已停止，没有新增调用。'); return;
      }
    }
    if (cancelledRequestId) {
      try { current.current.store.persist({ ...draft, cancelledRequestId }); }
      catch (cause) { current.current.store.setDraft(previous => previous.requestId === draft.requestId ? { ...previous, cancelledRequestId } : previous); error(cause); }
    }
    try { accept(await bridge.cancel({ id: draft.requestId, workspaceId: props.workspaceId })); } catch (cause) { error(cause); }
  }
  function restore(item: AutomationPlanningRecord, plan?: NaturalAutomationPlan) {
    if (sending.current || item.workspaceId !== current.current.props.workspaceId) return;
    const { props, store } = current.current;
    const planner = { modelConfigId: item.modelConfigId, credentialId: item.credentialId, ...(item.reasoningEffort !== undefined ? { reasoningEffort: item.reasoningEffort } : {}) };
    const target = props.projects.some(project => project.id === store.current.current.projectId) ? store.current.current.projectId : props.projects[0]?.id || '';
    try { const restored = plan && parseNaturalAutomationPlan(JSON.stringify(normalizedNaturalDraftPlan(plan))); store.persist({ version: 1, workspaceId: props.workspaceId, projectId: target, planningProjectId: item.projectId, input: item.input, planner, requestId: item.id, bindings: { text: planner }, preparationAnswers: {}, ...(restored ? { plan: restored, acceptedRequestId: item.id, acceptedInput: item.input, acceptedPlanningProjectId: item.projectId } : {}) }); generation.current++; setRecord(item); void read(); return true; } catch (cause) { error(cause); return false; }
  }
  const reset = () => { generation.current++; flight.current = undefined; sending.current = false; setPending(false); setRecord(undefined); };
  return { bridge, record, history, pending, start, read, cancel, restore, reset, active: pending || !!record && ['starting', 'running', 'cancelling'].includes(record.status) };
}
