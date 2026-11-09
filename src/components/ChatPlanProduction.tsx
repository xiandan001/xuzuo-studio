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
  const [copyingReferences, setCopyingReferences] = useState(false), [referenceRetry, setReferenceRetry] = useState(0);
  const [copiedReferences, setCopiedReferences] = useState<{ projectId: string; ids: string[] }>();
  const mounted = useRef(true), latest = useRef(session); latest.current = session;
  const latestProps = useRef(props); latestProps.current = props;
  const hasAttachments = !!turn.attachments?.length, attachmentProjectId = session.project?.id;
  const referencesReady = !hasAttachments || !!attachmentProjectId && copiedReferences?.projectId === attachmentProjectId && copiedReferences.ids.every(id => session.project?.referenceFiles?.some(file => file.id === id));
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (session.draft.plan || !turn.plan || session.store.issue) return;
    try { session.store.persist({ ...session.store.current.current, plan: turn.plan, input: turn.userText.slice(0, 10000), acceptedInput: turn.userText.slice(0, 10000), planner, bindings: { text: planner } }); }
    catch (cause) { session.setError(cause instanceof Error ? cause.message : '方案草稿未保存，请重试。'); }
  }, [turn.id, session.draft.plan, session.store.issue]);
  useEffect(() => {
    if (!hasAttachments || !attachmentProjectId) return;
    let disposed = false;
    setCopyingReferences(true); setCopiedReferences(undefined);
    const workspaceId = props.workspaceId;
    void (async () => {
      try {
        const transfer = window.desktop?.chat?.transferAttachments;
        if (!transfer) throw Error('请使用最新版桌面应用，将聊天附件加入制作项目。');
        const files = await transfer({ workspaceId, conversationId, turnId: turn.id, projectId: attachmentProjectId });
        if (disposed || !mounted.current || latestProps.current.workspaceId !== workspaceId) return;
        const project = latestProps.current.projects.find(item => item.id === attachmentProjectId && item.workspaceId === workspaceId);
        if (!project || !files.length) throw Error('聊天附件尚未加入当前保存项目，请重试准备附件。');
        const references = [...new Map([...(project.referenceFiles || []), ...files.map(file => ({ id: file.id, name: file.name, mimeType: file.mimeType, bytes: file.bytes, kind: file.kind }))].map(file => [file.id, file])).values()];
        latestProps.current.onUpdateProject(project.id, { referenceFiles: references });
        setCopiedReferences({ projectId: project.id, ids: files.map(file => file.id) });
      } catch (cause) { if (!disposed && mounted.current) { setRunProject(''); latest.current.setError(cause instanceof Error ? cause.message : '原始附件尚未准备好，未开始制作。'); } }
      finally { if (!disposed && mounted.current) setCopyingReferences(false); }
    })();
    return () => { disposed = true; };
  }, [hasAttachments, attachmentProjectId, props.workspaceId, conversationId, turn.id, referenceRetry]);
  useEffect(() => {
    if (!runProject || !referencesReady || session.draft.projectId !== runProject || !props.projects.some(project => project.id === runProject) || !session.draft.plan) return;
    setRunProject(''); void session.createAndRun();
  }, [runProject, referencesReady, session.draft.projectId, props.projects, session.draft.plan]);
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
  const guardedSession = { ...session, locked: session.locked || copyingReferences, createAndRun: async (options?: Parameters<typeof session.createAndRun>[0]) => {
    if (!referencesReady) { session.setError('原始附件尚未准备好，未开始制作。请先重试准备附件。'); return { status: 'failed' as const }; }
    return session.createAndRun(options);
  } };
  return <div className="chat-plan-production"><HomePlanCard props={props} session={guardedSession} deferProject onChooseProject={chooseProject} onOpenModels={() => setModelsOpen(true)} />{copyingReferences && <p role="status">正在把聊天原始附件加入制作项目…</p>}{hasAttachments && attachmentProjectId && !copyingReferences && !referencesReady && <button type="button" className="btn btn-secondary" onClick={() => setReferenceRetry(value => value + 1)}>重试准备附件 · 不调用 AI</button>}<details className="chat-plan-models" open={modelsOpen} onToggle={event => setModelsOpen(event.currentTarget.open)}><summary>制作模型与账户</summary>{capabilities.map(capability => <NaturalAutomationModels key={capability} configuration={props.configuration} capability={capability} label={labels[capability]} value={session.bindings[capability] || {}} disabled={session.locked || choosing || copyingReferences} onChange={value => session.setProductionBinding(capability, value)} />)}</details>{choosing && <p role="status">选择保存位置后继续制作；取消会保留方案。</p>}</div>;
}
