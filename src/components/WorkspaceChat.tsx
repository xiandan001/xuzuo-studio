import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Check, Copy, FileDown, History, LoaderCircle, MessageCircle, Paperclip, Plus, RotateCcw, Sparkles, Square, UserRound, WandSparkles } from 'lucide-react';
import type { PageProps, Project, ProjectKind } from '../types';
import type { ChatAttachment, ChatTarget, ChatTargetInspection, ChatTurn } from '../chat-types';
import type { NaturalBinding } from './NaturalAutomationModels';
import { NaturalAutomationModels, naturalModelSelection } from './NaturalAutomationModels';
import { ConversationModelPicker } from './ConversationModelPicker';
import { useWorkspaceChat } from '../hooks/useWorkspaceChat';
import { useRememberedString } from '../hooks/useRememberedString';
import { HOME_CREATION_KINDS } from '../lib/home-creation';
import { downloadFile } from '../lib/files';
import { CostAmount, CostTotal } from './CostAmount';
import { summarizeCosts } from '../lib/cost-display';
import { Select } from './Select';
import { StreamingChatReply } from './StreamingChatReply';
import { chatReplyPlainText } from '../lib/chat-markdown';
import { ChatHistorySidebar } from './ChatHistorySidebar';
import { ModalPortal } from './ModalPortal';
import { useChatRefinement } from '../hooks/useChatRefinement';
import { normalizeNaturalBinding } from '../lib/natural-model-bindings';
import { normalizeReasoningEffort } from '../lib/reasoning-options';
import { useChatAttachments } from '../hooks/useChatAttachments';
import { ChatAttachments } from './ChatAttachments';
import { ChatScenarioPicker } from './ChatScenarioPicker';
import { availableChatScenarios, chatScenarioAttachmentIssue, chatScenarioInput, findChatScenario, type ChatScenario } from '../lib/chat-scenarios';
import { recentChatReferences, scenarioChatReferences } from '../lib/chat-reference-selection';
import { prepareSvgReference } from '../lib/svg-reference';
import { prepareAnimationReference } from '../lib/generated-animation-reference';
import './workspace-chat.css';

const ChatReplyExportDialog = lazy(() => import('./ChatReplyExportDialog').then(module => ({ default: module.ChatReplyExportDialog })));
const ChatResourcePicker = lazy(() => import('./ChatResourcePicker').then(module => ({ default: module.ChatResourcePicker })));
const HomeProductionResult = lazy(() => import('./HomeProductionResult').then(module => ({ default: module.HomeProductionResult })));
const ChatPlanProduction = lazy(() => import('./ChatPlanProduction').then(module => ({ default: module.ChatPlanProduction })));

function readBinding(workspaceId: string): NaturalBinding {
  try { return normalizeNaturalBinding(JSON.parse(localStorage.getItem(`xuzuo-chat-model-v1:${workspaceId}`) || '{}')); } catch { return {}; }
}
function useInputDraft(workspaceId: string, conversationId: string) {
  const key = `xuzuo-chat-input-v1:${workspaceId}:${conversationId}`;
  const [text, setState] = useState(() => { try { return localStorage.getItem(key) || ''; } catch { return ''; } });
  const current = useRef(text); current.current = text;
  const revision = useRef(0);
  const setText = (value: string) => { revision.current++; current.current = value; setState(value); };
  const [error, setError] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => { try { localStorage.setItem(key, current.current); } catch { setError('输入草稿暂未保存，请先复制保留。'); } }, 300);
    return () => clearTimeout(timer);
  }, [key, text]);
  useEffect(() => {
    const save = () => { try { localStorage.setItem(key, current.current); } catch { /* The visible input remains available for copying. */ } };
    window.addEventListener('pagehide', save);
    return () => { save(); window.removeEventListener('pagehide', save); };
  }, [key]);
  const clearSubmitted = (version: number) => {
    if (revision.current !== version) return;
    setText('');
    try { localStorage.setItem(key, ''); } catch { setError('发送已确认，但输入草稿暂未清理。'); }
  };
  return { text, setText, error, revision, clearSubmitted };
}

const ChatMessagePair = memo(function ChatMessagePair({ turn, workspaceId, conversationId, canRetry, onRetry, onMake, onCopy, onSaveFile }: { turn: ChatTurn; workspaceId: string; conversationId: string; canRetry: boolean; onRetry: (turn: ChatTurn) => void; onMake: (text: string) => void; onCopy: (text: string) => void; onSaveFile: (turn: ChatTurn) => void }) {
  const plan = turn.plan;
  return <div className="workspace-chat-turn">
    <article className="workspace-chat-message is-user" aria-label="你发送的消息"><div className="workspace-chat-author"><UserRound size={15} /><strong>你</strong><span>{turn.mode === 'plan' ? '制作需求' : ''}</span></div><div className="workspace-chat-bubble"><p>{turn.userText}</p><ChatAttachments files={turn.attachments || []} workspaceId={workspaceId} conversationId={conversationId} /></div></article>
    <article className="workspace-chat-message is-assistant" aria-label="序作AI回复"><div className="workspace-chat-author"><Sparkles size={15} /><strong>序作 AI</strong><span title={turn.modelName}>{turn.modelName}</span></div><div className="workspace-chat-bubble">
      {turn.mode === 'plan' ? plan ? <div className="workspace-chat-plan-summary"><span className="chat-plan-badge"><Check size={13} />制作方案已准备好</span><h3>{plan.name}</h3><p>{plan.objective}</p><ol>{plan.steps.slice(0, 4).map((step, index) => <li key={index}>{step.name}</li>)}</ol></div> : <p className="workspace-chat-working">{turn.status === 'running' ? <><LoaderCircle size={16} className="spin" />正在整理方案，完整校验后即可制作…</> : '本轮没有形成可执行的完整方案。已返回内容与费用保留。'}</p> : turn.text ? <StreamingChatReply text={turn.text} streaming={turn.status === 'running'} /> : <p className="workspace-chat-working"><LoaderCircle size={16} className={turn.status === 'running' ? 'spin' : ''} />{turn.status === 'running' ? '正在思考…' : '本轮未返回正文。'}</p>}
      {turn.error && <p className="workspace-chat-error" role="status">{turn.error}</p>}
      {turn.saveIssue && <p className="workspace-chat-error" role="alert">{turn.saveIssue} 请先复制保留回复，再点击下方“重试保存”。</p>}
      {turn.attachmentNotice && <p className="workspace-chat-note">{turn.attachmentNotice}</p>}
      {turn.contextTruncated && <p className="workspace-chat-note">这段对话较长，本轮使用最近上下文；重要要求可再补充一次。</p>}
      {turn.status !== 'running' && <footer className="workspace-chat-message-actions"><div>{turn.text && turn.mode !== 'plan' && <><button type="button" className="text-button" onClick={() => onCopy(turn.text)} aria-label="复制这条回复"><Copy size={14} />复制</button>{turn.status === 'complete' && <button type="button" className="text-button" onClick={() => onSaveFile(turn)}><FileDown size={14} />保存为文件</button>}<button type="button" className="text-button" onClick={() => onMake(`请依据以下沟通内容规划制作：\n${turn.userText}\n\n已讨论内容：\n${turn.text}`)}><WandSparkles size={14} />转为制作方案</button></>}{canRetry && <button type="button" className="text-button" onClick={() => onRetry(turn)} title="重新发送这一轮会另行计费，已有回复与费用保留"><RotateCcw size={14} />重新回答</button>}</div><span className="workspace-chat-turn-cost"><CostAmount entry={{ ...turn, billingMode: 'live' }} /></span></footer>}
    </div></article>
  </div>;
});

export function WorkspaceChat({ props, onLegacy }: { props: PageProps; onLegacy: () => void }) {
  const [freshId] = useState(() => crypto.randomUUID());
  const [conversationId, setConversationId] = useRememberedString(`workspace:${props.workspaceId}:chat-conversation`, freshId);
  useEffect(() => { setConversationId(conversationId); }, [conversationId, setConversationId]);
  const shownId = props.chatIntent?.workspaceId === props.workspaceId ? props.chatIntent.conversationId : conversationId;
  useEffect(() => { if (shownId !== conversationId) setConversationId(shownId); }, [shownId, conversationId, setConversationId]);
  return <WorkspaceChatSession key={`${props.workspaceId}/${shownId}`} props={props} conversationId={shownId} onSelect={setConversationId} onLegacy={onLegacy} />;
}
function WorkspaceChatSession({ props, conversationId, onSelect, onLegacy }: { props: PageProps; conversationId: string; onSelect: (id: string) => void; onLegacy: () => void }) {
  const chat = useWorkspaceChat(props.workspaceId, conversationId), input = useInputDraft(props.workspaceId, conversationId);
  const attachments = useChatAttachments(props.workspaceId, conversationId);
  const [binding, setBinding] = useState(() => readBinding(props.workspaceId));
  const [imageBinding, setImageBinding] = useState<NaturalBinding>({});
  const [resourceSource, setResourceSource] = useState<'assets' | 'project'>(), [attachmentMenu, setAttachmentMenu] = useState(false), [dragging, setDragging] = useState(false);
  const [toolProjectId, setToolProjectId] = useRememberedString(`workspace:${props.workspaceId}:tool-project`, 'new');
  const targetKey = `xuzuo-chat-target-v1:${props.workspaceId}:${conversationId}`;
  const [targetData, setTargetData] = useState<{ target: ChatTarget; inspection: ChatTargetInspection; note?: string; discussionReferenceId?: string } | undefined>(() => { try { const value = JSON.parse(localStorage.getItem(targetKey) || 'null'); return typeof value?.target?.artifactId === 'string' && typeof value?.inspection?.artifact?.name === 'string' && /^[a-f0-9]{64}$/.test(value.target.sha256 || '') ? value : undefined; } catch { return undefined; } });
  const [targetAction, setTargetAction] = useState<'edit' | 'discuss'>('edit'), [targetPreparing, setTargetPreparing] = useState(false);
  const [targetDiscussionIssue, setTargetDiscussionIssue] = useState(''), [discussionPreparing, setDiscussionPreparing] = useState(false), discussionController = useRef<AbortController | undefined>(undefined);
  const currentTarget = useRef(targetData); currentTarget.current = targetData;
  useEffect(() => () => discussionController.current?.abort(), []);
  const handledIntent = useRef('');
  const refinement = useChatRefinement(props, conversationId, chat.reload);
  useEffect(() => { try { if (targetData) localStorage.setItem(targetKey, JSON.stringify({ ...targetData, inspection: { ...targetData.inspection, documentSource: undefined } })); else localStorage.removeItem(targetKey); } catch { chat.setError('修改目标暂未保留，请保持本对话打开。'); } }, [targetData, targetKey]);
  useEffect(() => { const intent = props.chatIntent; if (!intent || intent.workspaceId !== props.workspaceId || intent.conversationId !== conversationId || handledIntent.current === intent.token) return; handledIntent.current = intent.token; let current = true; discussionController.current?.abort(); setTargetPreparing(true); void (async () => { try { const selected = await window.desktop!.chat!.selectTarget({ workspaceId: props.workspaceId, projectId: intent.projectId, artifactId: intent.artifactId, kind: intent.kind }); if (!current) return; const mime = selected.inspection.artifact.mimeType; if (['image/gif', 'image/svg+xml'].includes(mime)) { setTargetData({ ...selected, note: mime === 'image/svg+xml' ? '精修会先准备静态参考，生成新的 PNG，原 SVG 保留。' : '继续精修前会检查动画来源并准备参考；本地工坊动画请在 GIF 工坊修改。' }); } else { const added = await attachments.addProjectArtifact(intent.projectId, intent.artifactId); if (!current) return; if (!added.length) throw Error('成品尚未带入，请重新读取或从项目文件选入。'); setTargetData(selected); } } catch (cause) { if (current) chat.setError(cause instanceof Error ? cause.message : '成品暂时无法载入，原稿保留。'); } finally { if (current) { setTargetPreparing(false); props.onChatIntentConsumed?.(intent.token); textarea.current?.focus(); } } })(); return () => { current = false; }; }, [props.chatIntent?.token]);
  const [mode, setMode] = useRememberedString(`workspace:${props.workspaceId}:chat-mode`, 'chat');
  const [kind, setKind] = useRememberedString(`workspace:${props.workspaceId}:chat-format`, 'image');
  const [scenarioId, setScenarioId] = useRememberedString(`workspace:${props.workspaceId}:chat-scenario`, mode === 'plan' ? kind === 'image' ? 'image-poster' : `document-${kind}` : 'chat-default');
  const scenarios = useMemo(() => availableChatScenarios(props.workspaceId, props.configuration.useTemplates), [props.workspaceId, props.configuration.useTemplates]);
  const scenario = findChatScenario(scenarios, scenarioId), isTool = scenario.entry === 'image-workbench';
  const [toolBusy, setToolBusy] = useState(false), toolPending = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [saveTurn, setSaveTurn] = useState<ChatTurn>();
  const [historyOpen, setHistoryOpen] = useState(false), [visible, setVisible] = useState(20), [activePlan, setActivePlan] = useState('');
  const textarea = useRef<HTMLTextAreaElement>(null), thread = useRef<HTMLDivElement>(null), pinned = useRef(true), sending = useRef(false), attachmentPopup = useRef<HTMLDivElement>(null), attachmentTrigger = useRef<HTMLButtonElement>(null);
  const selected = naturalModelSelection(props.configuration, 'text', binding);
  const turns = chat.conversation?.turns || [], latest = turns.at(-1), latestPlan = [...turns].reverse().find(turn => turn.plan);
  const productionLinks = chat.conversation?.productions || [], editingTarget = !!targetData && targetAction === 'edit', continuingTool = isTool && !targetData;
  const targetBusy = targetPreparing || discussionPreparing;
  useEffect(() => { setTargetDiscussionIssue(''); }, [targetData?.target.artifactId]);
  useEffect(() => {
    if (!attachmentMenu) return;
    attachmentPopup.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !attachmentPopup.current?.contains(event.target) && !attachmentTrigger.current?.contains(event.target)) setAttachmentMenu(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setAttachmentMenu(false); attachmentTrigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [attachmentMenu]);
  const costSignature = turns.map(turn => [turn.id, turn.costCents, turn.costState, turn.calculation?.nativeCurrency, turn.calculation?.nativeAmount, turn.calculation?.cnyAmount, turn.calculation?.completeness].join(':')).join('|');
  const summary = useMemo(() => summarizeCosts(turns.map(turn => ({ ...turn, billingMode: 'live' as const }))), [costSignature]);
  useEffect(() => { if (latestPlan) setActivePlan(latestPlan.id); }, [latestPlan?.id]);
  useEffect(() => {
    if (!pinned.current) return;
    const frame = requestAnimationFrame(() => { if (thread.current) thread.current.scrollTop = thread.current.scrollHeight; });
    return () => cancelAnimationFrame(frame);
  }, [latest?.updatedAt, latest?.text, turns.length]);
  function chooseBinding(value: NaturalBinding) {
    try { localStorage.setItem(`xuzuo-chat-model-v1:${props.workspaceId}`, JSON.stringify(value)); setBinding(value); }
    catch { chat.setError('模型选择暂未保存，请检查本地存储后重试。'); }
  }
  async function discussionReference(): Promise<ChatAttachment[] | undefined> {
    const selectedTarget = targetData;
    if (!selectedTarget || !['image/gif', 'image/svg+xml'].includes(selectedTarget.inspection.artifact.mimeType)) return undefined;
    const existing = [...attachments.files, ...recentChatReferences(turns)].find(file => file.id === selectedTarget.discussionReferenceId && file.mimeType === 'image/png');
    if (existing) return [existing];
    if (discussionController.current) return undefined;
    const controller = new AbortController(), target = selectedTarget.target; discussionController.current = controller; setDiscussionPreparing(true); setTargetDiscussionIssue(''); chat.setError('');
    const valid = () => alive.current && !controller.signal.aborted && currentTarget.current?.target.projectId === target.projectId && currentTarget.current?.target.artifactId === target.artifactId && currentTarget.current?.target.sha256 === target.sha256;
    try {
      const prepared = selectedTarget.inspection.artifact.mimeType === 'image/svg+xml' ? await prepareSvgReference(props.workflowRunner, target.projectId, target.artifactId, controller.signal) : await prepareAnimationReference(props.workflowRunner, target.projectId, target.artifactId, controller.signal);
      if (!valid()) return undefined;
      if (prepared.sourceSha256 !== target.sha256 || !prepared.reference || prepared.reference.projectId !== target.projectId || prepared.reference.mimeType !== 'image/png') throw Error('原成品已变化或静态参考未能准备，请重新选择成品；尚未调用模型。');
      const added = await attachments.addProjectArtifact(target.projectId, prepared.reference.id); if (!valid()) return undefined;
      if (!added.length) throw Error('静态参考尚未带入，请检查附件数量后重试；尚未调用模型。');
      setTargetData(previous => previous?.target.artifactId === target.artifactId && previous.target.sha256 === target.sha256 ? { ...previous, discussionReferenceId: added[0].id, note: '已带入静态参考，仅评价画面，不检查动画时序。原成品保留。' } : previous);
      return added;
    } catch (cause) { if (valid()) { const message = cause instanceof Error ? cause.message : '静态参考准备失败。'; setTargetDiscussionIssue(message); chat.setError(`${message} 未发送聊天或调用模型。`); } return undefined; }
    finally { if (discussionController.current === controller) { discussionController.current = undefined; if (alive.current) setDiscussionPreparing(false); } }
  }
  async function toggleTargetAction() {
    if (targetAction === 'discuss') { setTargetAction('edit'); return; }
    if (targetData && ['image/gif', 'image/svg+xml'].includes(targetData.inspection.artifact.mimeType) && !(await discussionReference())?.length) return;
    if (alive.current) setTargetAction('discuss');
  }
  function openGifWorkshop() {
    if (!targetData) return;
    props.onUsePrompt({ id: 'chat-gif-workshop', name: 'GIF动画工坊', description: '在原项目中修改动画', category: 'image', imagePreset: 'GIF动画工坊', mode: 'create', content: '', builtin: true, updatedAt: new Date().toISOString() }, input.text, targetData.target.projectId);
  }
  async function send(retry?: ChatTurn) {
    if (!retry && continuingTool) { if (!attachments.busy && !toolPending.current) openTool(); return; }
    if (sending.current || chat.pending || chat.loading || attachments.busy || toolPending.current || targetBusy || refinement.busy) return;
    if (!retry && editingTarget && targetData) { if (!input.text.trim()) { chat.setError('先写下这份成品需要修改的地方。'); textarea.current?.focus(); return; } const submittedVersion = input.revision.current; const done = await refinement.start(targetData.target, input.text.trim(), targetData.target.kind === 'image' ? imageBinding : binding); if (done) input.clearSubmitted(submittedVersion); return; }
    if (chat.running) return;
    const preparedDiscussion = !retry && targetData && targetAction === 'discuss' && ['image/gif', 'image/svg+xml'].includes(targetData.inspection.artifact.mimeType) ? await discussionReference() : undefined;
    if (!retry && targetData && targetAction === 'discuss' && ['image/gif', 'image/svg+xml'].includes(targetData.inspection.artifact.mimeType) && !preparedDiscussion?.length) return;
    const selectedFiles = retry?.attachments || preparedDiscussion || (targetData ? attachments.files : scenarioChatReferences(scenario, attachments.files, recentChatReferences(turns), !!selected.model?.capabilities.includes('vision')));
    const text = retry?.userText || input.text.trim() || (selectedFiles.length ? '请结合附件回答，并说明其中的关键信息。' : ''), model = selected.model;
    const connection = props.configuration.connections.find(item => item.id === model?.connectionId);
    if (!text) return;
    const effectiveFiles = selectedFiles;
    const attachmentIssue = !retry && !targetData && chatScenarioAttachmentIssue(scenario, effectiveFiles);
    if (attachmentIssue) { chat.setError(attachmentIssue); return; }
    if (selectedFiles.some(file => file.mimeType.startsWith('image/') || file.mimeType === 'application/pdf') && !model?.capabilities.includes('vision')) { chat.setError('当前模型只读取文字。请先选择支持看图和PDF的模型，再发送。'); return; }
    if (!model || !connection || !selected.credentialId) { chat.setError('先在输入框上方选择可用模型；账户未接入时，点击“接入模型”。'); return; }
    const requestText = retry?.requestText || (preparedDiscussion ? `附件为选定成品的静态PNG参考，仅评价画面；不能据此检查动画时序，也不能声称检查了SVG矢量结构。\n${text}` : targetData ? selectedFiles.length ? text : `本轮只讨论成品的修改要求，未提供可读取的原图或正文，不能声称看过文件内容。\n${text}` : chatScenarioInput(scenario, text));
    const submittedVersion = input.revision.current, attachmentVersion = attachments.revision.current;
    sending.current = true; pinned.current = true;
    try {
      const accepted = await chat.send({ id: crypto.randomUUID(), workspaceId: props.workspaceId, conversationId, text, requestText, attachmentIds: selectedFiles.map(file => file.id), model, connection, credentialId: selected.credentialId, reasoningEffort: normalizeReasoningEffort(connection, model, binding.reasoningEffort), target: retry ? retry.target : targetData?.target, mode: retry?.mode || (targetData ? 'chat' : mode === 'plan' ? 'plan' : 'chat'), outputKind: retry?.outputKind || (HOME_CREATION_KINDS.some(item => item.kind === kind) ? kind : 'image') as ProjectKind, ...(retry ? { sourceTurnId: retry.id } : {}) });
      if (accepted && !retry) { input.clearSubmitted(submittedVersion); attachments.clearSubmitted(attachmentVersion); }
    } finally { sending.current = false; }
  }
  function chooseScenario(value: ChatScenario) { setScenarioId(value.id); setMode(value.mode); if (value.outputKind) setKind(value.outputKind); chat.setError(''); textarea.current?.focus(); }
  function switchMode(value: 'chat' | 'plan') { setMode(value); setScenarioId(value === 'chat' ? 'chat-default' : kind === 'image' ? 'image-poster' : `document-${kind}`); }
  function make(text: string) { input.setText(text.slice(0, 10000)); switchMode('plan'); textarea.current?.focus(); }
  function openTool() {
    if (toolPending.current) return;
    const files = (attachments.files.length ? attachments.files : (latest?.contextAttachments?.length ? latest.contextAttachments : latest?.attachments || [])).filter(file => file.mimeType.startsWith("image/"));
    const issue = chatScenarioAttachmentIssue(scenario, files); if (issue) { chat.setError(issue); return; }
    toolPending.current = true; setToolBusy(true); chat.setError('');
    const request = chatScenarioInput(scenario, input.text), workspaceId = props.workspaceId;
    const continueProject = props.projects.find(project => project.id === toolProjectId && project.kind === 'image' && project.workspaceId === workspaceId && !project.trashedAt && !project.purgedAt);
    const options = { quick: true, initial: { name: scenario.name, description: input.text || scenario.description }, onCreated: (project: Project) => { void (async () => {
      try {
        const references = files.length ? await window.desktop!.chat!.attachToProject({ workspaceId, conversationId, attachmentIds: files.map(file => file.id), projectId: project.id }) : [];
        if (!alive.current) return;
        if (references.length) props.onUpdateProject(project.id, { referenceFiles: references.map(file => ({ id: file.id, name: file.name, mimeType: file.mimeType, bytes: file.bytes, kind: file.kind })) });
        props.onUsePrompt({ id: `chat-${scenario.id}`, name: scenario.name, description: scenario.description, category: 'image', imagePreset: scenario.imagePreset, mode: 'create', content: scenario.prompt, builtin: true, updatedAt: new Date().toISOString() }, request, project.id, { referenceFiles: references });
      } catch (cause) { if (alive.current) chat.setError(cause instanceof Error ? cause.message : '资料未能带入，项目和原附件保留，请重试。'); }
      finally { toolPending.current = false; if (alive.current) setToolBusy(false); }
    })(); }, onCancelled: (issue?: string) => { toolPending.current = false; if (alive.current) { setToolBusy(false); if (issue) chat.setError(issue); } } };
    if (continueProject) options.onCreated(continueProject); else props.onCreateProject('image', options);
  }
  const actions = useRef({ send, make, props }); actions.current = { send, make, props };
  const retryTurn = useCallback((turn: ChatTurn) => { void actions.current.send(turn); }, []);
  const makeTurn = useCallback((text: string) => actions.current.make(text), []);
  const copyTurn = useCallback((text: string) => { void navigator.clipboard.writeText(chatReplyPlainText(text)).then(() => actions.current.props.notify('已复制正文。')).catch(() => actions.current.props.notify('未能复制，请选择文字复制。', 'error')); }, []);
  const activePlanTurn = turns.find(turn => turn.id === activePlan && turn.plan);
  const stopInComposer = chat.running && !continuingTool && !editingTarget;
  function addIncomingFiles(files: File[]) { if (!files.length) return; if (attachments.busy) { chat.setError('正在添加上一批附件，请稍候再添加。'); return; } void attachments.addFiles(files); }
  return <section className="workspace-chat" aria-label="首页聊天与制作">
    <header className="workspace-chat-header"><div><small>序作 · 你的创作伙伴</small><h2>{turns.length || productionLinks.length ? chat.conversation?.title : mode === 'plan' ? '说出想法，一起做成作品' : '先聊聊你的想法'}</h2></div><nav><button className="btn-icon" type="button" aria-label="聊天历史" aria-expanded={historyOpen} onClick={() => setHistoryOpen(value => !value)}><History size={18} /></button><Select aria-label="更多聊天操作" value="" options={[{ value: '', label: '更多' }, { value: 'export', label: '导出当前对话', disabled: !turns.length && !productionLinks.length }, { value: 'legacy', label: '以往创作对话' }]} onValueChange={value => { if (value === 'legacy') onLegacy(); if (value === 'export' && chat.conversation) void downloadFile(`序作-对话-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, JSON.stringify(chat.conversation, null, 2)); }} /><button className="btn btn-secondary" type="button" disabled={chat.pending} onClick={() => onSelect(crypto.randomUUID())}><Plus size={15} />新对话</button></nav></header>
    {historyOpen && <ModalPortal onClose={() => setHistoryOpen(false)} variant="drawer"><div className="workspace-chat-history-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setHistoryOpen(false); }}><section className="workspace-chat-history-panel" role="dialog" aria-modal="true" aria-label="聊天记录"><ChatHistorySidebar workspaceId={props.workspaceId} activeId={conversationId} onSelect={id => { onSelect(id); setHistoryOpen(false); }} onNew={() => { onSelect(crypto.randomUUID()); setHistoryOpen(false); }} onClose={() => setHistoryOpen(false)} /></section></div></ModalPortal>}
    {chat.loading && <p className="workspace-chat-working" role="status"><LoaderCircle size={16} className="spin" />正在读取已保存的对话…</p>}
    {!chat.loading && !turns.length && !productionLinks.length && <div className="workspace-chat-welcome"><div className="workspace-chat-welcome-icon"><MessageCircle size={26} /></div><p>问问题、讨论需求，或者把想法变成图片与文档。</p><span>聊天直接开始，只有制作作品时才需要选择保存项目。</span><div>{['帮我把一句产品介绍写得更吸引人', '帮我制作一张产品宣传图，自动检查并精修一轮'].map((text, index) => <button type="button" key={text} onClick={() => { input.setText(text); switchMode(index ? 'plan' : 'chat'); textarea.current?.focus(); }}>{text}</button>)}</div></div>}
    {(!!turns.length || !!productionLinks.length) && <div ref={thread} className="workspace-chat-thread" role="log" aria-label="聊天消息" onScroll={() => { const element = thread.current; if (element) pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 90; }}>
      {turns.length > visible && <button type="button" className="text-button" onClick={() => setVisible(value => value + 20)}>查看更早的沟通</button>}
      {turns.slice(-visible).map(turn => <div key={turn.id}><ChatMessagePair turn={turn} workspaceId={props.workspaceId} conversationId={conversationId} canRetry={!chat.running && !chat.pending && turn.id === latest?.id} onRetry={retryTurn} onMake={makeTurn} onCopy={copyTurn} onSaveFile={setSaveTurn} />{turn.plan && <div className="workspace-chat-plan-action">{activePlan === turn.id ? <Suspense fallback={<p role="status">正在打开已保存的制作方案…</p>}><ChatPlanProduction props={props} turn={turn} conversationId={conversationId} planner={{ modelConfigId: turn.modelConfigId, credentialId: turn.credentialId, reasoningEffort: turn.reasoningEffort }} /></Suspense> : <button type="button" className="btn btn-secondary" onClick={() => setActivePlan(turn.id)}>查看这份方案与作品</button>}</div>}</div>)}
      {(chat.conversation?.exports || []).slice(-visible).map(link => { const run = !link.sourceOnly && props.workflowRunner.runs.find(item => item.id === link.runId); return run ? <Suspense key={link.runId} fallback={<p>正在读取保存文件…</p>}><HomeProductionResult props={props} run={run} kind={link.kind} /></Suspense> : <p key={link.runId} className="workspace-chat-production-record">已保存 {link.kind.toUpperCase()} 文件，原回复保留。<button type="button" className="text-button" onClick={() => props.navigate('project', link.projectId)}>查看项目</button></p>; })}
      {productionLinks.length > visible && <button type="button" className="text-button" onClick={() => setVisible(value => value + 20)}>查看更早的制作记录</button>}
      {productionLinks.slice(-visible).map(link => { const run = !link.sourceOnly && props.workflowRunner.runs.find(run => run.id === link.runId); return run ? <Suspense key={link.runId} fallback={<p>正在读取修订结果…</p>}><HomeProductionResult props={props} run={run} kind={link.target.kind} /></Suspense> : <p className="workspace-chat-production-record" key={link.runId}>{link.sourceOnly ? '来自备份的历史修订记录，仅可查看来源摘要。' : '已保存修订记录，可在原项目查看；不会重新制作。'}</p>; })}
    </div>}
    {saveTurn && <Suspense fallback={<p role="status">正在准备保存文件…</p>}><ChatReplyExportDialog props={props} conversationId={conversationId} turn={saveTurn} onClose={() => setSaveTurn(undefined)} onSaved={chat.reload} /></Suspense>}
    {refinement.error && <p className="workspace-chat-error" role="alert">{refinement.error}{refinement.unknown && <button type="button" className="text-button" onClick={() => { void refinement.readUnknown(); }}>读取任务状态 · 不重发</button>}</p>}
    {(chat.error || input.error || attachments.error) && <div className="workspace-chat-error" role="alert">{chat.error || input.error || attachments.error}<button type="button" className="text-button" disabled={chat.pending} onClick={chat.reload}>重新读取 · 不调用 AI</button></div>}
    {turns.some(turn => turn.saveIssue) && <button type="button" className="btn btn-secondary" disabled={chat.pending || chat.running} onClick={() => { void chat.flush(); }}>重试保存 · 不调用 AI</button>}
    <form className={`workspace-chat-composer${dragging ? ' is-dragging' : ''}`} aria-label="聊天输入" onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDragging(true); } }} onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false); }} onDrop={event => { if (!event.dataTransfer.files.length) return; event.preventDefault(); setDragging(false); addIncomingFiles([...event.dataTransfer.files]); }} onSubmit={event => { event.preventDefault(); void send(); }}>
      <div className="workspace-chat-composer-toolbar">{targetData ? <div className="chat-target-heading"><strong>修改：{targetData.inspection.artifact.name}</strong><small>{targetData.target.editorRevision ? '保存版本 v' + targetData.target.editorRevision : '选定成品 · 原稿保留'}</small><button type="button" className="text-button" disabled={refinement.busy || targetBusy} onClick={() => { void toggleTargetAction(); }}>{targetAction === 'edit' ? '先讨论' : '改为直接精修'}</button><button type="button" className="text-button" disabled={refinement.busy || targetBusy} onClick={() => setTargetData(undefined)}>退出成品修改</button></div> : <ChatScenarioPicker workspaceId={props.workspaceId} scenarios={scenarios} value={scenario.id} disabled={toolBusy} onSelect={chooseScenario} />}{targetData?.target.kind === 'image' && targetAction === 'edit' ? <NaturalAutomationModels configuration={props.configuration} capability="image-editing" label="精修图片" value={imageBinding} disabled={refinement.busy || targetBusy} onChange={setImageBinding} /> : (!isTool || !!targetData) && <ConversationModelPicker configuration={props.configuration} value={binding} disabled={chat.pending || chat.running || refinement.busy} onChange={chooseBinding} />}</div>
      {!targetData && <p className="workspace-chat-note">{isTool ? "专用工具 · 进入后设置并制作" : scenario.mode === "plan" ? "先出方案，确认后才制作" : "直接沟通，无需创建项目"}</p>}
      {attachmentMenu && <div ref={attachmentPopup} className="chat-attachment-menu" role="group" aria-label="附件来源"><button type="button" onClick={() => { setAttachmentMenu(false); void attachments.add(); }}>本机文件</button><button type="button" onClick={() => { setAttachmentMenu(false); setResourceSource('assets'); }}>素材库</button><button type="button" onClick={() => { setAttachmentMenu(false); setResourceSource('project'); }}>项目成品／资料</button><small>也可粘贴截图或拖入文件，选入不收费。</small></div>}
      {resourceSource && <Suspense fallback={<p>正在打开资料库…</p>}><ChatResourcePicker props={props} source={resourceSource} busy={attachments.busy} onClose={() => setResourceSource(undefined)} onAsset={attachments.addAsset} onFile={attachments.addProjectArtifact} /></Suspense>}
      {continuingTool && <Select aria-label="工具保存项目" value={toolProjectId} disabled={toolBusy} onValueChange={setToolProjectId} options={[{ value: 'new', label: '新建作品' }, ...props.projects.filter(project => project.kind === 'image' && project.workspaceId === props.workspaceId && !project.trashedAt && !project.purgedAt).map(project => ({ value: project.id, label: '继续：' + project.name }))]} />}
      <ChatAttachments files={attachments.files} workspaceId={props.workspaceId} conversationId={conversationId} onRemove={attachments.remove} disabled={attachments.busy} />
      {continuingTool && <p className="workspace-chat-note">{scenario.description} 先打开工具，再调整并生成。</p>}
      {dragging && <p className="chat-drop-hint">放开即可添加到本对话 · 不调用模型</p>}
      {targetData?.note && <p className="workspace-chat-note">{targetData.note}</p>}
      {targetDiscussionIssue && targetData?.inspection.artifact.mimeType === 'image/gif' && <p className="workspace-chat-note">这份动画尚未作为参考发送。<button type="button" className="text-button" onClick={openGifWorkshop}>打开 GIF 工坊修改</button></p>}
      <textarea ref={textarea} rows={3} maxLength={10000} aria-label="聊天内容" placeholder={targetData ? targetAction === 'edit' ? '说出这份成品要改哪里…直接生成独立修订，原稿与未保存草稿保留' : '先讨论这份成品，你想了解什么？' : scenario.placeholder} value={input.text} onChange={event => input.setText(event.target.value)} onPaste={event => { const files = [...event.clipboardData.files]; if (files.length) { event.preventDefault(); addIncomingFiles(files); } }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void send(); } }} />
      <div className="workspace-chat-composer-footer"><span><button ref={attachmentTrigger} type="button" className="workspace-chat-attachment-add" aria-label="添加聊天附件" aria-expanded={attachmentMenu} disabled={attachments.busy || toolBusy || !chat.available} onClick={() => setAttachmentMenu(value => !value)}>{attachments.busy ? <LoaderCircle size={16} className="spin" /> : <Paperclip size={16} />}附件{attachments.files.length ? ` · ${attachments.files.length}` : ''}</button>{continuingTool ? '直接打开工具，不影响当前回复' : refinement.unknown ? '上次提交尚未确认，请先读取任务状态' : editingTarget ? '输入修改要求，生成独立修订' : !selected.model || !selected.credentialId ? <button type="button" className="text-button" onClick={() => props.navigate('models')}>接入模型</button> : chat.running ? '正在回复，可停止后补充；也可新建对话' : 'Enter 发送 · Shift+Enter 换行'}{turns.length > 0 && <span className="workspace-chat-total">本对话 <CostTotal summary={summary} /></span>}</span>{stopInComposer ? <button className="workspace-chat-send is-stop" type="button" disabled={chat.pending} aria-label="停止回复" onClick={() => { void chat.stop(); }}><Square size={17} /></button> : <button className={`workspace-chat-send${continuingTool || editingTarget ? ' is-tool' : ''}`} type="submit" disabled={(editingTarget ? !input.text.trim() : !continuingTool && !input.text.trim() && !attachments.files.length) || (!continuingTool && (chat.pending || chat.loading)) || attachments.busy || toolBusy || targetBusy || refinement.busy || !!refinement.unknown || !chat.available} aria-label={editingTarget ? '开始精修选定成品' : continuingTool ? `进入${scenario.name}` : '发送聊天消息'}>{chat.pending && !continuingTool || toolBusy || refinement.busy ? <LoaderCircle size={19} className="spin" /> : editingTarget ? <><WandSparkles size={18} /><span>开始精修</span></> : continuingTool ? <><WandSparkles size={18} /><span>进入{scenario.name}</span></> : <ArrowUp size={21} />}</button>}</div>
      {!chat.available && <p className="workspace-chat-note">真实聊天请使用最新版桌面应用，Key 保存在本机。</p>}
    </form>
    {activePlanTurn && <p className="workspace-chat-bottom-note">制作任务会在后台排队运行；你可以切回“聊天”继续沟通。</p>}
  </section>;
}
