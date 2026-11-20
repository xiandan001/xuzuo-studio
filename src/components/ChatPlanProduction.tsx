import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatTurn } from '../chat-types';
import type { PageProps } from '../types';
import type { ProjectReference } from '../asset-types';
import { naturalModelSelection, NaturalAutomationModels, type NaturalBinding } from './NaturalAutomationModels';
import { useNaturalAutomationSession } from '../hooks/useNaturalAutomationSession';
import { CHAT_PRODUCTION_REFERENCE_LIMIT } from '../hooks/useNaturalAutomationDraft';
import { useChatPlanExecution } from '../hooks/useChatPlanExecution';
import { imagePlanHasQualityGate, imageReviewEditBinding, repairAfterReviewEnabled } from '../lib/natural-automation-plan';
import { HomePlanCard } from './HomePlanCard';
import { useRememberedBoolean } from '../hooks/useRememberedBoolean';

async function copyChatReferences(workspaceId: string, conversationId: string, projectId: string, references: ProjectReference[]) {
  const bridge = window.desktop?.chat;
  if (!bridge) throw Error('桌面附件服务暂不可用。');
  const files: Awaited<ReturnType<typeof bridge.attachToProject>> = [];
  let ids: string[] = [], bytes = 0;
  for (const file of references) {
    if (ids.length && (ids.length === 8 || bytes + file.bytes > 80 * 1024 * 1024)) {
      files.push(...await bridge.attachToProject({ workspaceId, conversationId, attachmentIds: ids, projectId }));
      ids = []; bytes = 0;
    }
    ids.push(file.id); bytes += file.bytes;
  }
  if (ids.length) files.push(...await bridge.attachToProject({ workspaceId, conversationId, attachmentIds: ids, projectId }));
  return files;
}

export function ChatPlanProduction({ props, turn, conversationId, planner }: { props: PageProps; turn: ChatTurn; conversationId: string; planner: NaturalBinding }) {
  const chatReferences = turn.contextAttachments?.length ? turn.contextAttachments : turn.attachments;
  const references = useMemo(() => chatReferences || [], [chatReferences]);
  const session = useNaturalAutomationSession(props, { draftOptions: { keyPrefix: `xuzuo-chat-production-v1:${conversationId}:${turn.id}`, keepCreatedDraft: true, initialPlanner: planner }, chatReferences: references });
  const execution = useChatPlanExecution(props, session);
  const direct = !!session.draft.chatExecution || !session.draft.ruleId && !session.draft.workflowSaved && !session.draft.workflowId;
  const [modelsOpen, setModelsOpen] = useRememberedBoolean(`workspace:${props.workspaceId}:chat-production-models`, false);
  const [choosing, setChoosing] = useState(false), [runProject, setRunProject] = useState(''), [addingReference, setAddingReference] = useState(false);
  const [prepared, setPrepared] = useState<{ projectId: string; ids: string[] }>();
  const preparingFiles = useRef(false), choosingProject = useRef(false), importingReference = useRef(false), propsRef = useRef(props); propsRef.current = props;
  const sourceReferences = useMemo(() => [...new Map([...references, ...(session.draft.chatProductionReferences || [])].map(file => [file.id, file])).values()], [references, session.draft.chatProductionReferences]);
  const mounted = useRef(true), latest = useRef(session); latest.current = session;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (session.draft.plan || !turn.plan || session.store.issue) return;
    try { session.store.persist({ ...session.store.current.current, plan: turn.plan, imagePreset: turn.imagePreset, repairAfterFailedReview: repairAfterReviewEnabled(turn.userText), input: turn.userText.slice(0, 10000), acceptedInput: turn.userText.slice(0, 10000), planner }); }
    catch (cause) { session.setError(cause instanceof Error ? cause.message : '方案草稿未保存，请重试。'); }
  }, [turn.id, session.draft.plan, session.store.issue]);
  useEffect(() => {
    if (runProject && session.store.current.current.projectId !== runProject) {
      setRunProject(''); setPrepared(undefined); session.setError('保存目标已变化，请重新确认并点击制作；尚未提交新任务。');
    }
  }, [runProject, session.draft.projectId]);
  useEffect(() => {
    if (!runProject || session.draft.projectId !== runProject || !props.projects.some(project => project.id === runProject) || !session.draft.plan) return;
    if (sourceReferences.length && prepared?.projectId !== runProject) {
      if (preparingFiles.current) return;
      preparingFiles.current = true; setChoosing(true);
      void copyChatReferences(props.workspaceId, conversationId, runProject, sourceReferences).then(files => {
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
    setRunProject('');
    if (direct) void execution.execute().then(result => { if (mounted.current && result.status === 'needs-input') latest.current.requestPreparation(); });
    else void session.createAndRun();
  }, [runProject, session.draft.projectId, props.projects, session.draft.plan, prepared, sourceReferences]);
  async function beforeRun() {
    if (!sourceReferences.length) return true;
    if (preparingFiles.current) return false;
    setPrepared(undefined); setRunProject(session.draft.projectId); return false;
  }
  async function addReferenceImages() {
    const bridge = window.desktop?.chat;
    if (!bridge || importingReference.current) return;
    importingReference.current = true; setAddingReference(true); session.setError('');
    try {
      const files = await bridge.importAttachments({ workspaceId: props.workspaceId, conversationId });
      if (!mounted.current || !files.length) return;
      const images: ProjectReference[] = files.flatMap(({ id, name, mimeType, bytes, kind }) => kind === 'image' ? [{ id, name, mimeType, bytes, kind }] : []);
      if (!images.length) throw Error('请选择实际参考图片。');
      const { store } = latest.current, source = store.current.current;
      const merged = [...new Map([...(source.chatProductionReferences || []), ...images].map(file => [file.id, file])).values()];
      if (new Set([...references, ...merged].map(file => file.id)).size > CHAT_PRODUCTION_REFERENCE_LIMIT) throw Error('一次制作最多使用16份对话参考资料，请减少选入的图片。');
      store.persist({ ...source, chatProductionReferences: merged });
      setPrepared(undefined);
    } catch (cause) { if (mounted.current) latest.current.setError(cause instanceof Error ? cause.message : '参考图片未能添加，请重试。'); }
    finally { importingReference.current = false; if (mounted.current) setAddingReference(false); }
  }
  function chooseProject() {
    if (choosingProject.current || !session.draft.plan) return;
    choosingProject.current = true; setChoosing(true);
    const plan = session.draft.plan;
    const finish = () => { choosingProject.current = false; if (mounted.current) setChoosing(false); };
    props.onCreateProject(plan.outputKind, { quick: true, initial: { name: plan.name, description: plan.objective }, onCreated: project => {
      finish();
      if (!mounted.current) return;
      try {
        const active = latest.current, source = active.store.current.current;
        if (source.ruleId || source.workflowSaved || source.workflowId) {
          active.store.persist({ ...source, projectId: project.id, ruleId: undefined, workflowId: undefined, creationKey: undefined, workflowSaved: false, bindings: { ...source.bindings, ...active.readiness.bindings } });
          active.setSavedRule(undefined);
        } else active.changeProject(project.id);
        setPrepared(undefined); setRunProject(project.id);
      } catch (cause) { latest.current.setError(cause instanceof Error ? cause.message : '新项目已保留，制作设置暂未保存，请重试。'); }
    }, onCancelled: issue => { finish(); if (mounted.current && issue) latest.current.setError(issue); } });
  }
  if (!session.draft.plan) return <p role="status">正在准备已保存的方案…{session.store.issue || session.error}</p>;
  const compiled = session.preparation?.compiled || session.result.compiled;
  const capabilities = [...new Set((compiled?.workflow.steps || session.draft.plan.steps).map(step => step.kind).filter(kind => ['text', 'vision', 'image-generation', 'image-editing'].includes(kind)))] as ('text' | 'vision' | 'image-generation' | 'image-editing')[];
  const conditionalOnly = !capabilities.includes('image-editing') && imagePlanHasQualityGate(session.draft.plan, session.draft.imagePreset) && repairAfterReviewEnabled(session.draft.acceptedInput || session.draft.input, session.draft.repairAfterFailedReview);
  if (conditionalOnly) capabilities.push('image-editing');
  const fallbackEdit = conditionalOnly ? imageReviewEditBinding(props.configuration, session.bindings) : undefined;
  const labels = { text: '文字与文档', vision: '看图检查', 'image-generation': '生成图片', 'image-editing': '精修图片' };
  const busy = choosing || !!runProject || execution.busy || addingReference;
  const settingsNeeded = capabilities.some(capability => {
    if (capability === 'image-editing' && conditionalOnly) return false;
    const selection = naturalModelSelection(props.configuration, capability, session.bindings[capability]);
    return !selection.models.length || !!selection.model && !selection.credentials.length;
  });
  const modelSettings = <details className="chat-plan-models" open={modelsOpen} onToggle={event => setModelsOpen(event.currentTarget.open)}><summary>制作模型与账户</summary>
    {capabilities.map(capability => <NaturalAutomationModels key={capability} configuration={props.configuration} capability={capability} label={labels[capability]} value={session.bindings[capability] || (capability === 'image-editing' ? fallbackEdit : undefined) || {}} explicitOnly={capability === 'image-editing' && conditionalOnly} disabled={session.locked || busy || !!session.draft.chatExecution} onChange={value => session.setProductionBinding(capability, value)} />)}
    {settingsNeeded && !session.draft.chatExecution && <button type="button" className="text-button" onClick={() => props.navigate('models')}>打开模型和账户设置</button>}
  </details>;
  return <div className="chat-plan-production">
    <HomePlanCard props={props} session={session} externalBusy={busy} execution={direct ? execution : undefined} deferProject beforeRun={beforeRun} onChooseProject={chooseProject} onAddReferenceImages={window.desktop?.chat?.importAttachments ? addReferenceImages : undefined} onOpenModels={() => setModelsOpen(true)} modelSettings={modelSettings} />
    {choosing && <p role="status">正在准备项目与资料…</p>}
  </div>;
}
