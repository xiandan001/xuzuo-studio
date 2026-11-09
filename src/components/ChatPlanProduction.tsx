import { useEffect, useRef, useState } from 'react';
import type { ChatTurn } from '../chat-types';
import type { PageProps } from '../types';
import { NaturalAutomationModels, type NaturalBinding } from './NaturalAutomationModels';
import { useNaturalAutomationSession } from '../hooks/useNaturalAutomationSession';
import { HomePlanCard } from './HomePlanCard';
import { useRememberedBoolean } from '../hooks/useRememberedBoolean';

export function ChatPlanProduction({ props, turn, conversationId, planner }: { props: PageProps; turn: ChatTurn; conversationId: string; planner: NaturalBinding }) {
  const session = useNaturalAutomationSession(props, { draftOptions: { keyPrefix: `xuzuo-chat-production-v1:${conversationId}:${turn.id}`, keepCreatedDraft: true, initialPlanner: planner, initialBindings: { text: planner } } });
  const [modelsOpen, setModelsOpen] = useRememberedBoolean(`workspace:${props.workspaceId}:chat-production-models`, false);
  const [choosing, setChoosing] = useState(false), [runProject, setRunProject] = useState('');
  const mounted = useRef(true), latest = useRef(session); latest.current = session;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (session.draft.plan || !turn.plan || session.store.issue) return;
    try { session.store.persist({ ...session.store.current.current, plan: turn.plan, input: turn.userText.slice(0, 10000), acceptedInput: turn.userText.slice(0, 10000), planner, bindings: { text: planner } }); }
    catch (cause) { session.setError(cause instanceof Error ? cause.message : '方案草稿未保存，请重试。'); }
  }, [turn.id, session.draft.plan, session.store.issue]);
  useEffect(() => {
    if (!runProject || session.draft.projectId !== runProject || !props.projects.some(project => project.id === runProject) || !session.draft.plan) return;
    setRunProject(''); void session.createAndRun();
  }, [runProject, session.draft.projectId, props.projects, session.draft.plan]);
  function chooseProject() {
    if (choosing || !turn.plan) return;
    setChoosing(true);
    props.onCreateProject(turn.plan.outputKind, { quick: true, initial: { name: turn.plan.name, description: turn.plan.objective }, onCreated: project => {
      if (!mounted.current) return;
      try {
        const active = latest.current, source = active.store.current.current;
        if (source.ruleId || source.workflowSaved || source.workflowId) {
          active.store.persist({ ...source, projectId: project.id, ruleId: undefined, workflowId: undefined, creationKey: undefined, workflowSaved: false, bindings: { ...source.bindings, ...active.readiness.bindings } });
          active.setSavedRule(undefined);
        } else active.changeProject(project.id);
        setChoosing(false); setRunProject(project.id);
      } catch (cause) { setChoosing(false); latest.current.setError(cause instanceof Error ? cause.message : '新项目已保留，制作设置暂未保存，请重试。'); }
    }, onCancelled: issue => { if (mounted.current) { setChoosing(false); if (issue) latest.current.setError(issue); } } });
  }
  if (!session.draft.plan) return <p role="status">正在准备已保存的方案…{session.store.issue || session.error}</p>;
  const capabilities = [...new Set((session.result.compiled?.workflow.steps || session.draft.plan.steps).map(step => step.kind).filter(kind => ['text', 'vision', 'image-generation', 'image-editing'].includes(kind)))] as ('text' | 'vision' | 'image-generation' | 'image-editing')[];
  const labels = { text: '文字与文档', vision: '看图检查', 'image-generation': '生成图片', 'image-editing': '精修图片' };
  return <div className="chat-plan-production"><HomePlanCard props={props} session={session} deferProject onChooseProject={chooseProject} onOpenModels={() => setModelsOpen(true)} /><details className="chat-plan-models" open={modelsOpen} onToggle={event => setModelsOpen(event.currentTarget.open)}><summary>制作模型与账户</summary>{capabilities.map(capability => <NaturalAutomationModels key={capability} configuration={props.configuration} capability={capability} label={labels[capability]} value={session.bindings[capability] || {}} disabled={session.locked || choosing} onChange={value => session.setProductionBinding(capability, value)} />)}</details>{choosing && <p role="status">选择保存位置后继续制作；取消会保留方案。</p>}</div>;
}
