import { useEffect, useRef, useState } from 'react';
import type { PageProps } from '../types';
import type { AutomationRule } from '../automation-types';
import type { useNaturalAutomationDraft } from './useNaturalAutomationDraft';
import { normalizedNaturalDraftPlan } from './useNaturalAutomationDraft';
import { compileNaturalAutomationPlan, naturalAutomationRequestIssues } from '../lib/natural-automation-plan';
import { naturalEffectiveBindings, naturalKindLabel, naturalPreparationMissing, naturalQuestionAnswer, naturalRuleInput } from '../lib/natural-automation-composer-state';
import { naturalModelSelection } from '../components/NaturalAutomationModels';

type Store = ReturnType<typeof useNaturalAutomationDraft>;
interface CreationFlight { scope: string; workflowId: string; promise: Promise<AutomationRule | undefined>; resolve: (rule?: AutomationRule) => void; timer?: ReturnType<typeof setTimeout>; finishing: boolean; }
const creationScope = (workspaceId: string, store: Store) => `${workspaceId}/${store.current.current.projectId}/${store.current.current.acceptedRequestId || store.current.current.requestId || ''}`;
export function useNaturalAutomationCreation(props: PageProps, store: Store, onError: (message: string) => void, onRule: (rule: AutomationRule) => void) {
  const [busy, setBusy] = useState(false), isSaving = useRef(false), pending = useRef<CreationFlight | undefined>(undefined), mounted = useRef(true);
  const current = useRef({ props, store, onError, onRule }); current.current = { props, store, onError, onRule };
  const valid = (flight: CreationFlight) => mounted.current && pending.current === flight && creationScope(current.current.props.workspaceId, current.current.store) === flight.scope;
  function settle(flight: CreationFlight, rule?: AutomationRule) { clearTimeout(flight.timer); if (pending.current === flight) { pending.current = undefined; isSaving.current = false; if (mounted.current) setBusy(false); } flight.resolve(rule); }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (pending.current) settle(pending.current); }; }, []);
  useEffect(() => { const flight = pending.current; if (flight && creationScope(props.workspaceId, store) !== flight.scope) settle(flight); }, [props.workspaceId, store.draft.projectId, store.draft.acceptedRequestId]);
  async function finish(flight: CreationFlight) {
    if (!valid(flight) || flight.finishing) return;
    const { props, store } = current.current, draft = store.current.current, bridge = window.desktop?.automation;
    const workflow = props.configuration.workflows.find(item => item.id === flight.workflowId);
    if (!bridge || !workflow || !draft.plan || !draft.creationKey) return;
    flight.finishing = true;
    try {
      const project = props.projects.find(item => item.id === draft.projectId && item.workspaceId === props.workspaceId); if (!project) throw Error('项目已变化，请回到原项目继续。');
      const selected = naturalModelSelection(props.configuration, 'text', draft.planner), bindings = naturalEffectiveBindings(props.configuration, draft.bindings, selected.model && selected.credentialId ? { modelConfigId: selected.model.id, credentialId: selected.credentialId } : draft.planner);
      const plan = { ...normalizedNaturalDraftPlan(draft.plan), unsupported: [...new Set([...draft.plan.unsupported, ...naturalAutomationRequestIssues(draft.acceptedInput || draft.input)])] };
      const compiled = compileNaturalAutomationPlan(plan, project, props.configuration, bindings, { allowPreparationQuestions: true, calendarResolved: draft.calendarResolved });
      await bridge.syncContext({ workspaceId: props.workspaceId, workspaces: props.workspaces, projects: props.projects, workflows: props.configuration.workflows, models: props.configuration.models, connections: props.configuration.connections });
      if (!valid(flight)) return;
      const answers = draft.preparationAnswers || {}, preparation = draft.plan.questions.length ? { questions: draft.plan.questions, answers: Object.fromEntries(draft.plan.questions.map(question => [question, naturalQuestionAnswer(answers, question)])) } : undefined;
      const rule = await bridge.saveRule({ ...compiled.rule, input: naturalRuleInput(plan, compiled.rule.input, answers), ...(preparation ? { preparation } : {}), workspaceId: props.workspaceId, projectId: project.id, workflowId: workflow.id, enabled: false, creationKey: draft.creationKey });
      if (!valid(flight)) return;
      store.persist({ ...store.current.current, ruleId: rule.id, needsSetup: !!compiled.missing.length || !!naturalPreparationMissing(plan, answers).length }); current.current.onRule(rule); settle(flight, rule);
    } catch (cause) { if (valid(flight)) { current.current.onError(`流程和方案保留，创建还未确认完成。${cause instanceof Error ? cause.message : ''} 可重试，不会重新调用规划 AI。`); settle(flight); } }
  }
  useEffect(() => { if (pending.current) void finish(pending.current); }, [props.configuration.workflows, store.draft.workflowId]);
  function ensureCreated(): Promise<AutomationRule | undefined> {
    if (pending.current) return pending.current.promise;
    const { props, store } = current.current, draft = store.current.current, bridge = window.desktop?.automation;
    if (!bridge || !draft.plan) { onError(!bridge ? '请在桌面应用中创建自动化。' : '先说需求，生成一份方案。'); return Promise.resolve(undefined); }
    const project = props.projects.find(item => item.id === draft.projectId && item.workspaceId === props.workspaceId && !item.trashedAt);
    if (!project || project.kind !== draft.plan.outputKind) { onError(`请为这份方案选择或新建${naturalKindLabel[draft.plan.outputKind]}项目；已有方案不会丢失。`); return Promise.resolve(undefined); }
    const workflowId = draft.workflowId || crypto.randomUUID(); let resolve!: CreationFlight['resolve']; const promise = new Promise<AutomationRule | undefined>(done => { resolve = done; });
    const flight: CreationFlight = { scope: creationScope(props.workspaceId, store), workflowId, promise, resolve, finishing: false }; pending.current = flight; isSaving.current = true; setBusy(true); onError('');
    flight.timer = setTimeout(() => { if (valid(flight)) { onError('保存还未能确认，原方案和创建编号保留。可以重试保存，不会重新规划或自动运行。'); settle(flight); } }, 15000);
    void (async () => {
      try {
        if (draft.ruleId) {
          const snapshot = await bridge.snapshot(props.workspaceId), rule = snapshot.rules.find(item => item.id === draft.ruleId);
          if (!rule || !props.configuration.workflows.some(item => item.id === rule.workflowId)) throw Error('暂时找不到原流程，请先恢复原记录。');
          if (valid(flight)) { current.current.onRule(rule); settle(flight, rule); } return;
        }
        const selected = naturalModelSelection(props.configuration, 'text', draft.planner), bindings = naturalEffectiveBindings(props.configuration, draft.bindings, selected.model && selected.credentialId ? { modelConfigId: selected.model.id, credentialId: selected.credentialId } : draft.planner);
        const plan = { ...normalizedNaturalDraftPlan(draft.plan!), unsupported: [...new Set([...draft.plan!.unsupported, ...naturalAutomationRequestIssues(draft.acceptedInput || draft.input)])] };
        const compiled = compileNaturalAutomationPlan(plan, project, props.configuration, bindings, { allowPreparationQuestions: true, calendarResolved: draft.calendarResolved });
        const next = { ...draft, workflowId, creationKey: draft.creationKey || crypto.randomUUID() }; store.persist(next);
        const existing = props.configuration.workflows.find(item => item.id === workflowId);
        if (draft.workflowSaved && !existing) throw Error('已保存的流程暂时找不到，请先恢复原流程，当前方案保留。');
        if (!existing && !props.configuration.saveWorkflow(compiled.workflow, workflowId, { silent: true })) throw Error('流程尚未可靠保存，请检查本地存储。');
        store.persist({ ...next, workflowSaved: true }); if (existing) await finish(flight);
      } catch (cause) { if (valid(flight)) { onError(cause instanceof Error ? cause.message : '方案尚未保存，当前输入保留。'); settle(flight); } }
    })();
    return promise;
  }
  return { busy, isSaving, ensureCreated };
}
