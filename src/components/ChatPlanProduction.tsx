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
  const [prepared, setPrepared] = useState<{ projectId: string; ids: string[] }>();
  const preparingFiles = useRef(false), propsRef = useRef(props); propsRef.current = props;
  const referenceIds = (turn.contextAttachments?.length ? turn.contextAttachments : turn.attachments || []).map(file => file.id);
  const mounted = useRef(true), latest = useRef(session); latest.current = session;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (session.draft.plan || !turn.plan || session.store.issue) return;
    try { session.store.persist({ ...session.store.current.current, plan: turn.plan, input: turn.userText.slice(0, 10000), acceptedInput: turn.userText.slice(0, 10000), planner, bindings: { text: planner } }); }
    catch (cause) { session.setError(cause instanceof Error ? cause.message : '方案草稿未保存，请重试。'); }
  }, [turn.id, session.draft.plan, session.store.issue]);
  useEffect(() => {
    if (runProject && session.store.current.current.projectId !== runProject) {
      setRunProject(''); setPrepared(undefined); session.setError('保存目标已变化，请重新确认并点击制作；尚未提交新任务。');
    }
  }, [runProject, session.draft.projectId]);
  useEffect(() => {
    if (!runProject || session.draft.projectId !== runProject || !props.projects.some(project => project.id === runProject) || !session.draft.plan) return;
    if (referenceIds.length && prepared?.projectId !== runProject) {
      if (preparingFiles.current) return;
      preparingFiles.current = true; setChoosing(true);
      void window.desktop!.chat!.attachToProject({ workspaceId: props.workspaceId, conversationId, attachmentIds: referenceIds, projectId: runProject }).then(files => {
        if (!mounted.current) return;
        if (latest.current.store.current.current.projectId !== runProject) { setRunProject(''); setPrepared(undefined); latest.current.setError('保存目标已变化，原参考资料保留；请确认目标后重新点击制作。'); return; }
        const project = propsRef.current.projects.find(project => project.id === runProject);
        if (!project) throw Error('保存项目已变化，参考资料已保留，尚未调用模型。');
        propsRef.current.onUpdateProject(project.id, { referenceFiles: [...new Map([...(project.referenceFiles || []), ...files].map(file => [file.id, { id: file.id, name: file.name, mimeType: file.mimeType, bytes: file.bytes, kind: file.kind }])).values()] });
        setPrepared({ projectId: project.id, ids: files.map(file => file.id) });
      }).catch(cause => { if (mounted.current) { setRunProject(''); session.setError(cause instanceof Error ? cause.message : '参考资料未能带入，请重试；尚未调用模型。'); } }).finally(() => { preparingFiles.current = false; if (mounted.current) setChoosing(false); });
      return;
    }
    if (prepared?.projectId === runProject && prepared.ids.some(id => !props.projects.find(project => project.id === runProject)?.referenceFiles?.some(file => file.id === id))) return;
    setRunProject(''); void session.createAndRun();
  }, [runProject, session.draft.projectId, props.projects, session.draft.plan, prepared]);
  async function beforeRun() {
    if (!referenceIds.length) return true;
    if (preparingFiles.current) return false;
    setPrepared(undefined); setRunProject(session.draft.projectId); return false;
  }
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
        setPrepared(undefined); setChoosing(false); setRunProject(project.id);
      } catch (cause) { setChoosing(false); latest.current.setError(cause instanceof Error ? cause.message : '新项目已保留，制作设置暂未保存，请重试。'); }
    }, onCancelled: issue => { if (mounted.current) { setChoosing(false); if (issue) latest.current.setError(issue); } } });
  }
  if (!session.draft.plan) return <p role="status">正在准备已保存的方案…{session.store.issue || session.error}</p>;
  const capabilities = [...new Set((session.result.compiled?.workflow.steps || session.draft.plan.steps).map(step => step.kind).filter(kind => ['text', 'vision', 'image-generation', 'image-editing'].includes(kind)))] as ('text' | 'vision' | 'image-generation' | 'image-editing')[];
  const labels = { text: '文字与文档', vision: '看图检查', 'image-generation': '生成图片', 'image-editing': '精修图片' };
  return <div className="chat-plan-production"><HomePlanCard props={props} session={session} externalBusy={choosing} deferProject beforeRun={beforeRun} onChooseProject={chooseProject} onOpenModels={() => setModelsOpen(true)} /><details className="chat-plan-models" open={modelsOpen} onToggle={event => setModelsOpen(event.currentTarget.open)}><summary>制作模型与账户</summary>{capabilities.map(capability => <NaturalAutomationModels key={capability} configuration={props.configuration} capability={capability} label={labels[capability]} value={session.bindings[capability] || {}} disabled={session.locked || choosing} onChange={value => session.setProductionBinding(capability, value)} />)}</details>{choosing && <p role="status">选择保存位置后继续制作；取消会保留方案。</p>}</div>;
}
