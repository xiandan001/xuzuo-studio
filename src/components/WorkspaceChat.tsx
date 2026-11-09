import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Check, Copy, Download, History, LoaderCircle, MessageCircle, Paperclip, Plus, RotateCcw, Sparkles, Square, UserRound, WandSparkles } from 'lucide-react';
import type { PageProps, ProjectKind } from '../types';
import type { ChatTurn } from '../chat-types';
import type { NaturalBinding } from './NaturalAutomationModels';
import { naturalModelSelection } from './NaturalAutomationModels';
import { ConversationModelPicker } from './ConversationModelPicker';
import { useWorkspaceChat } from '../hooks/useWorkspaceChat';
import { useRememberedString } from '../hooks/useRememberedString';
import { HOME_CREATION_KINDS } from '../lib/home-creation';
import { downloadFile } from '../lib/files';
import { CostAmount, CostTotal } from './CostAmount';
import { summarizeCosts } from '../lib/cost-display';
import { Select } from './Select';
import { ChatReplyText } from './ChatReplyText';
import { normalizeNaturalBinding } from '../lib/natural-model-bindings';
import { normalizeReasoningEffort } from '../lib/reasoning-options';
import { useChatAttachments } from '../hooks/useChatAttachments';
import { ChatAttachments } from './ChatAttachments';
import { ChatScenarioPicker } from './ChatScenarioPicker';
import { availableChatScenarios, chatScenarioAttachmentIssue, chatScenarioInput, findChatScenario, type ChatScenario } from '../lib/chat-scenarios';
import { recentChatReferences, scenarioChatReferences } from '../lib/chat-reference-selection';
import './workspace-chat.css';

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

const ChatMessagePair = memo(function ChatMessagePair({ turn, workspaceId, conversationId, canRetry, onRetry, onMake, onCopy }: { turn: ChatTurn; workspaceId: string; conversationId: string; canRetry: boolean; onRetry: (turn: ChatTurn) => void; onMake: (text: string) => void; onCopy: (text: string) => void }) {
  const plan = turn.plan;
  return <div className="workspace-chat-turn">
    <article className="workspace-chat-message is-user" aria-label="你发送的消息"><div className="workspace-chat-author"><UserRound size={15} /><strong>你</strong><span>{turn.mode === 'plan' ? '制作需求' : ''}</span></div><div className="workspace-chat-bubble"><p>{turn.userText}</p><ChatAttachments files={turn.attachments || []} workspaceId={workspaceId} conversationId={conversationId} /></div></article>
    <article className="workspace-chat-message is-assistant" aria-label="序作AI回复"><div className="workspace-chat-author"><Sparkles size={15} /><strong>序作 AI</strong><span title={turn.modelName}>{turn.modelName}</span></div><div className="workspace-chat-bubble">
      {turn.mode === 'plan' ? plan ? <div className="workspace-chat-plan-summary"><span className="chat-plan-badge"><Check size={13} />制作方案已准备好</span><h3>{plan.name}</h3><p>{plan.objective}</p><ol>{plan.steps.slice(0, 4).map((step, index) => <li key={index}>{step.name}</li>)}</ol></div> : <p className="workspace-chat-working">{turn.status === 'running' ? <><LoaderCircle size={16} className="spin" />正在整理方案，完整校验后即可制作…</> : '本轮没有形成可执行的完整方案。已返回内容与费用保留。'}</p> : turn.text ? <ChatReplyText text={turn.text} /> : <p className="workspace-chat-working"><LoaderCircle size={16} className={turn.status === 'running' ? 'spin' : ''} />{turn.status === 'running' ? '正在思考…' : '本轮未返回正文。'}</p>}
      {turn.error && <p className="workspace-chat-error" role="status">{turn.error}</p>}
      {turn.saveIssue && <p className="workspace-chat-error" role="alert">{turn.saveIssue} 请先复制保留回复，再点击下方“重试保存”。</p>}
      {turn.attachmentNotice && <p className="workspace-chat-note">{turn.attachmentNotice}</p>}
      {turn.contextTruncated && <p className="workspace-chat-note">这段对话较长，本轮使用最近上下文；重要要求可再补充一次。</p>}
      {turn.status !== 'running' && <footer className="workspace-chat-message-actions"><div>{turn.text && turn.mode !== 'plan' && <><button type="button" className="text-button" onClick={() => onCopy(turn.text)} aria-label="复制这条回复"><Copy size={14} />复制</button><button type="button" className="text-button" onClick={() => onMake(`请依据以下沟通内容规划制作：\n${turn.userText}\n\n已讨论内容：\n${turn.text}`)}><WandSparkles size={14} />转为制作方案</button></>}{canRetry && <button type="button" className="text-button" onClick={() => onRetry(turn)} title="重新发送这一轮会另行计费，已有回复与费用保留"><RotateCcw size={14} />重新回答</button>}</div><span className="workspace-chat-turn-cost"><CostAmount entry={{ ...turn, billingMode: 'live' }} /></span></footer>}
    </div></article>
  </div>;
});

export function WorkspaceChat({ props, onLegacy }: { props: PageProps; onLegacy: () => void }) {
  const [freshId] = useState(() => crypto.randomUUID());
  const [conversationId, setConversationId] = useRememberedString(`workspace:${props.workspaceId}:chat-conversation`, freshId);
  useEffect(() => { setConversationId(conversationId); }, [conversationId, setConversationId]);
  return <WorkspaceChatSession key={`${props.workspaceId}/${conversationId}`} props={props} conversationId={conversationId} onSelect={setConversationId} onLegacy={onLegacy} />;
}
function WorkspaceChatSession({ props, conversationId, onSelect, onLegacy }: { props: PageProps; conversationId: string; onSelect: (id: string) => void; onLegacy: () => void }) {
  const chat = useWorkspaceChat(props.workspaceId, conversationId), input = useInputDraft(props.workspaceId, conversationId);
  const attachments = useChatAttachments(props.workspaceId, conversationId);
  const [binding, setBinding] = useState(() => readBinding(props.workspaceId));
  const [mode, setMode] = useRememberedString(`workspace:${props.workspaceId}:chat-mode`, 'chat');
  const [kind, setKind] = useRememberedString(`workspace:${props.workspaceId}:chat-format`, 'image');
  const [scenarioId, setScenarioId] = useRememberedString(`workspace:${props.workspaceId}:chat-scenario`, mode === 'plan' ? kind === 'image' ? 'image-poster' : `document-${kind}` : 'chat-default');
  const scenarios = useMemo(() => availableChatScenarios(props.workspaceId, props.configuration.useTemplates), [props.workspaceId, props.configuration.useTemplates]);
  const scenario = findChatScenario(scenarios, scenarioId), isTool = scenario.entry === 'image-workbench';
  const [toolBusy, setToolBusy] = useState(false), toolPending = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [historyOpen, setHistoryOpen] = useState(false), [visible, setVisible] = useState(20), [activePlan, setActivePlan] = useState('');
  const textarea = useRef<HTMLTextAreaElement>(null), thread = useRef<HTMLDivElement>(null), pinned = useRef(true), sending = useRef(false);
  const selected = naturalModelSelection(props.configuration, 'text', binding);
  const turns = chat.conversation?.turns || [], latest = turns.at(-1), latestPlan = [...turns].reverse().find(turn => turn.plan);
  const summary = useMemo(() => summarizeCosts(turns.map(turn => ({ ...turn, billingMode: 'live' as const }))), [turns]);
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
  async function send(retry?: ChatTurn) {
    if (sending.current || chat.running || chat.pending || chat.loading || attachments.busy || toolPending.current) return;
    if (!retry && isTool) { openTool(); return; }
    const selectedFiles = retry?.attachments || scenarioChatReferences(scenario, attachments.files, recentChatReferences(turns), !!selected.model?.capabilities.includes('vision'));
    const text = retry?.userText || input.text.trim() || (selectedFiles.length ? '请结合附件回答，并说明其中的关键信息。' : ''), model = selected.model;
    const connection = props.configuration.connections.find(item => item.id === model?.connectionId);
    if (!text) return;
    const effectiveFiles = selectedFiles;
    const attachmentIssue = !retry && chatScenarioAttachmentIssue(scenario, effectiveFiles);
    if (attachmentIssue) { chat.setError(attachmentIssue); return; }
    if (selectedFiles.some(file => file.mimeType.startsWith('image/') || file.mimeType === 'application/pdf') && !model?.capabilities.includes('vision')) { chat.setError('当前模型只读取文字。请先选择支持看图和PDF的模型，再发送。'); return; }
    if (!model || !connection || !selected.credentialId) { chat.setError('先在输入框上方选择可用模型；账户未接入时，点击“接入模型”。'); return; }
    const submittedVersion = input.revision.current, attachmentVersion = attachments.revision.current;
    sending.current = true; pinned.current = true;
    try {
      const accepted = await chat.send({ id: crypto.randomUUID(), workspaceId: props.workspaceId, conversationId, text, requestText: retry?.requestText || chatScenarioInput(scenario, text), attachmentIds: selectedFiles.map(file => file.id), model, connection, credentialId: selected.credentialId, reasoningEffort: normalizeReasoningEffort(connection, model, binding.reasoningEffort), mode: retry?.mode || (mode === 'plan' ? 'plan' : 'chat'), outputKind: retry?.outputKind || (HOME_CREATION_KINDS.some(item => item.kind === kind) ? kind : 'image') as ProjectKind, ...(retry ? { sourceTurnId: retry.id } : {}) });
      if (accepted && !retry) { input.clearSubmitted(submittedVersion); attachments.clearSubmitted(attachmentVersion); }
    } finally { sending.current = false; }
  }
  function chooseScenario(value: ChatScenario) { setScenarioId(value.id); setMode(value.mode); if (value.outputKind) setKind(value.outputKind); chat.setError(''); textarea.current?.focus(); }
  function switchFormat(value: ProjectKind) { setKind(value); setScenarioId(value === 'image' ? 'image-poster' : `document-${value}`); }
  function switchMode(value: 'chat' | 'plan') { setMode(value); setScenarioId(value === 'chat' ? 'chat-default' : kind === 'image' ? 'image-poster' : `document-${kind}`); }
  function make(text: string) { input.setText(text.slice(0, 10000)); switchMode('plan'); textarea.current?.focus(); }
  function openTool() {
    if (toolPending.current) return;
    const files = (attachments.files.length ? attachments.files : (latest?.contextAttachments?.length ? latest.contextAttachments : latest?.attachments || [])).filter(file => file.mimeType.startsWith("image/"));
    const issue = chatScenarioAttachmentIssue(scenario, files); if (issue) { chat.setError(issue); return; }
    toolPending.current = true; setToolBusy(true); chat.setError('');
    const request = chatScenarioInput(scenario, input.text), workspaceId = props.workspaceId;
    props.onCreateProject('image', { quick: true, initial: { name: scenario.name, description: input.text || scenario.description }, onCreated: project => { void (async () => {
      try {
        const references = files.length ? await window.desktop!.chat!.attachToProject({ workspaceId, conversationId, attachmentIds: files.map(file => file.id), projectId: project.id }) : [];
        if (!alive.current) return;
        if (references.length) props.onUpdateProject(project.id, { referenceFiles: references.map(file => ({ id: file.id, name: file.name, mimeType: file.mimeType, bytes: file.bytes, kind: file.kind })) });
        props.onUsePrompt({ id: `chat-${scenario.id}`, name: scenario.name, description: scenario.description, category: 'image', imagePreset: scenario.imagePreset, mode: 'create', content: scenario.prompt, builtin: true, updatedAt: new Date().toISOString() }, request, project.id, { referenceFiles: references });
      } catch (cause) { if (alive.current) chat.setError(cause instanceof Error ? cause.message : '资料未能带入，项目和原附件保留，请重试。'); }
      finally { toolPending.current = false; if (alive.current) setToolBusy(false); }
    })(); }, onCancelled: issue => { toolPending.current = false; if (alive.current) { setToolBusy(false); if (issue) chat.setError(issue); } } });
  }
  const actions = useRef({ send, make, props }); actions.current = { send, make, props };
  const retryTurn = useCallback((turn: ChatTurn) => { void actions.current.send(turn); }, []);
  const makeTurn = useCallback((text: string) => actions.current.make(text), []);
  const copyTurn = useCallback((text: string) => { void navigator.clipboard.writeText(text).then(() => actions.current.props.notify('已复制回复。')).catch(() => actions.current.props.notify('未能复制，请选择文字复制。', 'error')); }, []);
  const activePlanTurn = turns.find(turn => turn.id === activePlan && turn.plan);
  return <section className="workspace-chat" aria-label="首页聊天与制作">
    <header className="workspace-chat-header"><div><small>序作 · 你的创作伙伴</small><h2>{turns.length ? chat.conversation?.title : mode === 'plan' ? '说出想法，一起做成作品' : '先聊聊你的想法'}</h2></div><nav><button className="btn-icon" type="button" aria-label="聊天历史" aria-expanded={historyOpen} onClick={() => setHistoryOpen(value => !value)}><History size={18} /></button><button className="btn btn-secondary" type="button" disabled={chat.pending} onClick={() => onSelect(crypto.randomUUID())}><Plus size={15} />新对话</button></nav></header>
    {historyOpen && <div className="workspace-chat-history"><Select aria-label="选择聊天历史" value={conversationId} options={[...(!chat.history.some(item => item.id === conversationId) ? [{ value: conversationId, label: '当前新对话' }] : []), ...chat.history.map(item => ({ value: item.id, label: item.title, description: `${item.turnCount} 轮沟通${item.activeTurnId ? ' · 正在回复' : ''}` }))]} onValueChange={onSelect} /><button type="button" className="btn btn-secondary" disabled={!turns.length} onClick={() => { void downloadFile(`序作-对话-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, JSON.stringify(chat.conversation, null, 2)); }}><Download size={14} />导出</button><button type="button" className="text-button" onClick={onLegacy}>以往创作对话</button></div>}
    {chat.loading && <p className="workspace-chat-working" role="status"><LoaderCircle size={16} className="spin" />正在读取已保存的对话…</p>}
    {!chat.loading && !turns.length && <div className="workspace-chat-welcome"><div className="workspace-chat-welcome-icon"><MessageCircle size={26} /></div><p>问问题、讨论需求，或者把想法变成图片与文档。</p><span>聊天直接开始，只有制作作品时才需要选择保存项目。</span><div>{['帮我把一句产品介绍写得更吸引人', '帮我制作一张产品宣传图，自动检查并精修一轮'].map((text, index) => <button type="button" key={text} onClick={() => { input.setText(text); switchMode(index ? 'plan' : 'chat'); textarea.current?.focus(); }}>{text}</button>)}</div></div>}
    {!!turns.length && <div ref={thread} className="workspace-chat-thread" role="log" aria-label="聊天消息" onScroll={() => { const element = thread.current; if (element) pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 90; }}>
      {turns.length > visible && <button type="button" className="text-button" onClick={() => setVisible(value => value + 20)}>查看更早的沟通</button>}
      {turns.slice(-visible).map(turn => <div key={turn.id}><ChatMessagePair turn={turn} workspaceId={props.workspaceId} conversationId={conversationId} canRetry={!chat.running && !chat.pending && turn.id === latest?.id} onRetry={retryTurn} onMake={makeTurn} onCopy={copyTurn} />{turn.plan && <div className="workspace-chat-plan-action">{activePlan === turn.id ? <Suspense fallback={<p role="status">正在打开已保存的制作方案…</p>}><ChatPlanProduction props={props} turn={turn} conversationId={conversationId} planner={{ modelConfigId: turn.modelConfigId, credentialId: turn.credentialId, reasoningEffort: turn.reasoningEffort }} /></Suspense> : <button type="button" className="btn btn-secondary" onClick={() => setActivePlan(turn.id)}>查看这份方案与作品</button>}</div>}</div>)}
    </div>}
    {(chat.error || input.error || attachments.error) && <div className="workspace-chat-error" role="alert">{chat.error || input.error || attachments.error}<button type="button" className="text-button" disabled={chat.pending} onClick={chat.reload}>重新读取 · 不调用 AI</button></div>}
    {turns.some(turn => turn.saveIssue) && <button type="button" className="btn btn-secondary" disabled={chat.pending || chat.running} onClick={() => { void chat.flush(); }}>重试保存 · 不调用 AI</button>}
    <form className="workspace-chat-composer" aria-label="聊天输入" onSubmit={event => { event.preventDefault(); void send(); }}>
      <div className="workspace-chat-composer-toolbar"><div className="workspace-chat-modes" role="group" aria-label="对话用途"><button type="button" aria-pressed={mode !== 'plan'} onClick={() => switchMode('chat')}><MessageCircle size={15} />聊天</button><button type="button" aria-pressed={mode === 'plan'} onClick={() => switchMode('plan')}><WandSparkles size={15} />制作</button></div><ChatScenarioPicker scenarios={scenarios} value={scenario.id} disabled={toolBusy} onSelect={chooseScenario} />{!isTool && <ConversationModelPicker configuration={props.configuration} value={binding} disabled={chat.pending || chat.running} onChange={chooseBinding} />}</div>
      {mode === 'plan' && !isTool && <div className="workspace-chat-formats" role="group" aria-label="制作格式">{HOME_CREATION_KINDS.map(item => <button type="button" key={item.kind} aria-pressed={kind === item.kind} onClick={() => switchFormat(item.kind)}>{item.label}</button>)}<span>先看方案，再决定制作</span></div>}
      <ChatAttachments files={attachments.files} workspaceId={props.workspaceId} conversationId={conversationId} onRemove={attachments.remove} disabled={attachments.busy} />
      {isTool && <p className="workspace-chat-note">{scenario.description} 点击进入后再选择保存位置，不会自动生成。专用工具只带入参考图片，文档请先用“资料解读”整理为要求。</p>}
      <textarea ref={textarea} rows={3} maxLength={10000} aria-label="聊天内容" placeholder={scenario.placeholder} value={input.text} onChange={event => input.setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void send(); } }} />
      <div className="workspace-chat-composer-footer"><span><button type="button" className="workspace-chat-attachment-add" aria-label="添加聊天附件" disabled={attachments.busy || toolBusy || !chat.available} onClick={() => { void attachments.add(); }}>{attachments.busy ? <LoaderCircle size={16} className="spin" /> : <Paperclip size={16} />}附件{attachments.files.length ? ` · ${attachments.files.length}` : ""}</button>{isTool ? '进入工具后调整尺寸、样式和制作模型' : !selected.model || !selected.credentialId ? <button type="button" className="text-button" onClick={() => props.navigate('models')}>接入模型</button> : chat.running ? '正在回复，可停止后补充；也可新建对话' : 'Enter 发送 · Shift+Enter 换行'}{turns.length > 0 && <span className="workspace-chat-total">本对话 <CostTotal summary={summary} /></span>}</span>{chat.running ? <button className="workspace-chat-send is-stop" type="button" disabled={chat.pending} aria-label="停止回复" onClick={() => { void chat.stop(); }}><Square size={17} /></button> : <button className={`workspace-chat-send${isTool ? " is-tool" : ""}`} type="submit" disabled={(!isTool && !input.text.trim() && !attachments.files.length) || chat.pending || chat.loading || attachments.busy || toolBusy || !chat.available} aria-label={isTool ? `进入${scenario.name}` : "发送聊天消息"}>{chat.pending || toolBusy ? <LoaderCircle size={19} className="spin" /> : isTool ? <><WandSparkles size={18} /><span>进入{scenario.name}</span></> : <ArrowUp size={21} />}</button>}</div>
      {!chat.available && <p className="workspace-chat-note">真实聊天请使用最新版桌面应用，Key 保存在本机。</p>}
    </form>
    {activePlanTurn && <p className="workspace-chat-bottom-note">制作任务会在后台排队运行；你可以切回“聊天”继续沟通。</p>}
  </section>;
}
