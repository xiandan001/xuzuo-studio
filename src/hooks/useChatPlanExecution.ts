import { useEffect, useRef, useState } from 'react';
import type { WorkflowDefinition, WorkflowRun } from '../configuration-types';
import type { PageProps } from '../types';
import type { AutomationActionResult } from '../lib/automation-dispatch';
import { naturalPreparationMissing, naturalRuleInput } from '../lib/natural-automation-composer-state';
import type { NaturalAutomationSession } from './useNaturalAutomationSession';

const receiptReadDelays = [300, 1500, 2500];

export function useChatPlanExecution(props: PageProps, session: NaturalAutomationSession) {
  const [busy, setBusy] = useState(false);
  const [readProgress, setReadProgress] = useState({ scope: '', count: 0 });
  const [recoveredRun, setRecoveredRun] = useState<WorkflowRun>();
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const latest = useRef({ props, session });
  latest.current = { props, session };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const { chatExecution, projectId } = session.draft;
  const matches = (item: WorkflowRun | undefined, receipt = chatExecution) => item && receipt && item.mode === 'live' &&
    item.workspaceId === props.workspaceId && item.projectId === projectId &&
    item.workflowId === receipt.workflowId && (!receipt.runId || item.id === receipt.runId);
  const run = chatExecution && (props.workflowRunner.runs.find(item => matches(item)) || (matches(recoveredRun) ? recoveredRun : undefined));
  const pending = Boolean(chatExecution && !run);
  const scope = `${props.workspaceId}/${projectId}/${chatExecution?.workflowId || ''}`;

  async function execute(): Promise<AutomationActionResult> {
    const { props, session } = latest.current;
    const source = session.store.current.current;
    const { plan, projectId } = source;
    if (inFlight.current || source.chatExecution || !plan) return { status: 'failed' };
    const compiled = session.result.compiled;
    const answers = source.preparationAnswers || {};
    const missing = naturalPreparationMissing(plan, answers);
    if (session.store.issue || session.result.error || !compiled || compiled.missing.length || missing.length) {
      session.setError(session.store.issue || session.result.error || compiled?.missing.join('；') || missing.map(question => `请补充：${question}`).join('；') || '请选择此方案的保存项目。');
      return { status: 'needs-input' };
    }
    const project = session.project;
    if (!project || project.id !== projectId || project.kind !== plan.outputKind) return { status: 'needs-input' };
    const current = () => mounted.current && latest.current.props.workspaceId === props.workspaceId &&
      latest.current.session.store.current.current.projectId === projectId;
    const workflow: WorkflowDefinition = { ...compiled.workflow, automaticRecovery: true, id: crypto.randomUUID(), workspaceId: props.workspaceId, updatedAt: new Date().toISOString() };
    const input = naturalRuleInput(plan, compiled.rule.input, answers);
    const attachmentIds = (project.referenceFiles || []).map(file => file.id);
    const persist = (receipt?: typeof chatExecution) => {
      const store = latest.current.session.store;
      store.persist({ ...store.current.current, chatExecution: receipt });
    };
    inFlight.current = true;
    setBusy(true);
    session.setError('');
    try {
      const check = await props.workflowRunner.preflight(workflow, projectId, input, compiled.rule.variables, attachmentIds);
      if (!current()) return { status: 'failed' };
      if (!check.ok) {
        session.setError(check.errors.join('；') || '方案预检未通过，请检查制作设置。');
        return { status: 'needs-input' };
      }
      // Write the turn's identity before asking the main process to start. A
      // lost reply or reopening the conversation only permits a status read.
      persist({ workflowId: workflow.id });
      const result = await props.workflowRunner.startLive(workflow, projectId, input, compiled.rule.variables, attachmentIds, true);
      if (!current()) return { status: 'failed' };
      if (result.status === 'started') {
        persist({ workflowId: workflow.id, runId: result.runId });
        return { status: 'started' };
      }
      if (result.status === 'rejected') persist();
      session.setError(result.error);
      return { status: result.status === 'unknown' ? 'unknown' : 'failed' };
    } catch (cause) {
      if (current()) session.setError(cause instanceof Error ? cause.message : '方案执行未能确认，请读取当前任务状态。');
      return { status: latest.current.session.store.current.current.chatExecution ? 'unknown' : 'failed' };
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function read(showPending = true) {
    const { props, session } = latest.current;
    const { chatExecution: receipt, projectId } = session.store.current.current;
    if (!receipt || inFlight.current) return;
    const current = () => mounted.current && latest.current.props.workspaceId === props.workspaceId &&
      latest.current.session.store.current.current.projectId === projectId &&
      latest.current.session.store.current.current.chatExecution?.workflowId === receipt.workflowId;
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await props.workflowRunner.readStartResult(projectId, { workspaceId: props.workspaceId, workflowId: receipt.workflowId });
      if (!current()) return;
      let found: WorkflowRun | undefined;
      if (result.status === 'started') {
        found = result.run || latest.current.props.workflowRunner.runs.find(item => item.id === result.runId);
        if (!found) found = await window.desktop?.runtime?.runDetail?.(result.runId);
        if (!current()) return;
      }
      const store = latest.current.session.store;
      if (found && matches(found, receipt)) {
        store.persist({ ...store.current.current, chatExecution: { ...receipt, runId: found.id } });
        setRecoveredRun(found);
        session.setError('');
      } else if (!receipt.runId && result.status === 'rejected' && result.code === 'START_NOT_FOUND') {
        store.persist({ ...store.current.current, chatExecution: undefined });
        session.setError('已确认此方案还未开始，可以重新执行。');
      } else if (showPending) {
        session.setError('暂时无法确认原任务。再次读取状态不会重复开始制作。');
      }
    } catch (cause) {
      if (current() && showPending) session.setError(cause instanceof Error ? cause.message : '暂时无法读取任务状态。');
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  useEffect(() => {
    if (!pending || busy || !projectId || !window.desktop?.runtime) return;
    const count = readProgress.scope === scope ? readProgress.count : 0;
    if (count >= receiptReadDelays.length) return;
    const timer = window.setTimeout(() => {
      if (inFlight.current) return;
      setReadProgress({ scope, count: count + 1 });
      void read(count + 1 === receiptReadDelays.length);
    }, receiptReadDelays[count]);
    return () => window.clearTimeout(timer);
  }, [pending, busy, projectId, scope, readProgress]);

  return { busy, run, pending, execute, read: () => read() };
}
