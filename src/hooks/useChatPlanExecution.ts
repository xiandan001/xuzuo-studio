import { useEffect, useRef, useState } from 'react';
import type { WorkflowDefinition } from '../configuration-types';
import type { PageProps } from '../types';
import type { AutomationActionResult } from '../lib/automation-dispatch';
import { naturalPreparationMissing, naturalRuleInput } from '../lib/natural-automation-composer-state';
import type { NaturalAutomationSession } from './useNaturalAutomationSession';

export function useChatPlanExecution(props: PageProps, session: NaturalAutomationSession) {
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const latest = useRef({ props, session });
  latest.current = { props, session };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const { chatExecution, projectId } = session.draft;
  const run = chatExecution && props.workflowRunner.runs.find(item => item.mode === 'live' &&
    item.workspaceId === props.workspaceId && item.projectId === projectId &&
    item.workflowId === chatExecution.workflowId && (!chatExecution.runId || item.id === chatExecution.runId));

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
    const workflow: WorkflowDefinition = { ...compiled.workflow, id: crypto.randomUUID(), workspaceId: props.workspaceId, updatedAt: new Date().toISOString() };
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

  async function read() {
    const { props, session } = latest.current;
    const { chatExecution: receipt, projectId } = session.store.current.current;
    if (!receipt || inFlight.current) return;
    const current = () => mounted.current && latest.current.props.workspaceId === props.workspaceId &&
      latest.current.session.store.current.current.projectId === projectId &&
      latest.current.session.store.current.current.chatExecution?.workflowId === receipt.workflowId;
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await props.workflowRunner.readStartResult(projectId);
      if (!current()) return;
      const bridge = window.desktop?.runtime;
      if (!bridge) throw Error('桌面任务服务暂不可用，请稍后读取状态。');
      const snapshot = await bridge.snapshot();
      if (!current()) return;
      const found = snapshot.runs.find(item => item.mode === 'live' && item.projectId === projectId &&
        item.workspaceId === props.workspaceId && item.workflowId === receipt.workflowId && (!receipt.runId || item.id === receipt.runId));
      const store = latest.current.session.store;
      if (found) {
        store.persist({ ...store.current.current, chatExecution: { ...receipt, runId: found.id } });
        session.setError('');
      } else if (!receipt.runId && result.status === 'rejected' && ['START_NOT_FOUND', 'NO_PENDING_START'].includes(result.code || '')) {
        store.persist({ ...store.current.current, chatExecution: undefined });
        session.setError('已确认此方案还未开始，可以重新执行。');
      } else {
        session.setError('暂未读取到此方案的任务，请稍后再次读取状态。');
      }
    } catch (cause) {
      if (current()) session.setError(cause instanceof Error ? cause.message : '暂时无法读取任务状态。');
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return { busy, run, pending: Boolean(chatExecution && !run), execute, read };
}
