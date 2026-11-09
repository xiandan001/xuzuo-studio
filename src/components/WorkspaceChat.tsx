import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Check, Copy, Download, History, LoaderCircle, MessageCircle, Plus, RotateCcw, Sparkles, Square, UserRound, WandSparkles } from 'lucide-react';
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

const ChatMessagePair = memo(function ChatMessagePair({ turn, canRetry, onRetry, onMake, onCopy }: { turn: ChatTurn; canRetry: boolean; onRetry: (turn: ChatTurn) => void; onMake: (text: string) => void; onCopy: (text: string) => void }) {
  const plan = turn.plan;
  return <div className="workspace-chat-turn">
    <article className="workspace-chat-message is-user" aria-label="你发送的消息"><div className="workspace-chat-author"><UserRound size={15} /><strong>你</strong><span>{turn.mode === 'plan' ? '制作需求' : ''}</span></div><div className="workspace-chat-bubble"><p>{turn.userText}</p></div></article>
    <article className="workspace-chat-message is-assistant" aria-label="序作AI回复"><div className="workspace-chat-author"><Sparkles size={15} /><strong>序作 AI</strong><span title={turn.modelName}>{turn.modelName}</span></div><div className="workspace-chat-bubble">
      {turn.mode === 'plan' ? plan ? <div className="workspace-chat-plan-summary"><span className="chat-plan-badge"><Check size={13} />制作方案已准备好</span><h3>{plan.name}</h3><p>{plan.objective}</p><ol>{plan.steps.slice(0, 4).map((step, index) => <li key={index}>{step.name}</li>)}</ol></div> : <p className="workspace-chat-working">{turn.status === 'running' ? <><LoaderCircle size={16} className="spin" />正在整理方案，完整校验后即可制作…</> : '本轮没有形成可执行的完整方案。已返回内容与费用保留。'}</p> : turn.text ? <ChatReplyText text={turn.text} /> : <p className="workspace-chat-working"><LoaderCircle size={16} className={turn.status === 'running' ? 'spin' : ''} />{turn.status === 'running' ? '正在思考…' : '本轮未返回正文。'}</p>}
      {turn.error && <p className="workspace-chat-error" role="status">{turn.error}</p>}
      {turn.saveIssue && <p className="workspace-chat-error" role="alert">{turn.saveIssue} 请先复制保留回复，再点击下方“重试保存”。</p>}
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
  const [binding, setBinding] = useState(() => readBinding(props.workspaceId));
  const [mode, setMode] = useRememberedString(`workspace:${props.workspaceId}:chat-mode`, 'chat');
  const [kind, setKind] = useRememberedString(`workspace:${props.workspaceId}:chat-format`, 'image');
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
    if (sending.current || chat.running || chat.pending || chat.loading) return;
    const text = retry?.userText || input.text.trim(), model = selected.model;
    const connection = props.configuration.connections.find(item => item.id === model?.connectionId);
    if (!text) return;
    if (!model || !connection || !selected.credentialId) { chat.setError('先在输入框上方选择可用模型；账户未接入时，点击“接入模型”。'); return; }
    const submittedVersion = input.revision.current;
    sending.current = true; pinned.current = true;
    try {
      const accepted = await chat.send({ id: crypto.randomUUID(), workspaceId: props.workspaceId, conversationId, text, model, connection, credentialId: selected.credentialId, reasoningEffort: normalizeReasoningEffort(connection, model, binding.reasoningEffort), mode: retry?.mode || (mode === 'plan' ? 'plan' : 'chat'), outputKind: retry?.outputKind || (HOME_CREATION_KINDS.some(item => item.kind === kind) ? kind : 'image') as ProjectKind, ...(retry ? { sourceTurnId: retry.id } : {}) });
      if (accepted && !retry) input.clearSubmitted(submittedVersion);
    } finally { sending.current = false; }
  }
  function make(text: string) { input.setText(text.slice(0, 10000)); setMode('plan'); textarea.current?.focus(); }
  const actions = useRef({ send, make, props }); actions.current = { send, make, props };
  const retryTurn = useCallback((turn: ChatTurn) => { void actions.current.send(turn); }, []);
  const makeTurn = useCallback((text: string) => actions.current.make(text), []);
  const copyTurn = useCallback((text: string) => { void navigator.clipboard.writeText(text).then(() => actions.current.props.notify('已复制回复。')).catch(() => actions.current.props.notify('未能复制，请选择文字复制。', 'error')); }, []);
  const activePlanTurn = turns.find(turn => turn.id === activePlan && turn.plan);
  return <section className="workspace-chat" aria-label="首页聊天与制作">
    <header className="workspace-chat-header"><div><small>序作 · 你的创作伙伴</small><h2>{turns.length ? chat.conversation?.title : mode === 'plan' ? '说出想法，一起做成作品' : '先聊聊你的想法'}</h2></div><nav><button className="btn-icon" type="button" aria-label="聊天历史" aria-expanded={historyOpen} onClick={() => setHistoryOpen(value => !value)}><History size={18} /></button><button className="btn btn-secondary" type="button" disabled={chat.pending} onClick={() => onSelect(crypto.randomUUID())}><Plus size={15} />新对话</button></nav></header>
    {historyOpen && <div className="workspace-chat-history"><Select aria-label="选择聊天历史" value={conversationId} options={[...(!chat.history.some(item => item.id === conversationId) ? [{ value: conversationId, label: '当前新对话' }] : []), ...chat.history.map(item => ({ value: item.id, label: item.title, description: `${item.turnCount} 轮沟通${item.activeTurnId ? ' · 正在回复' : ''}` }))]} onValueChange={onSelect} /><button type="button" className="btn btn-secondary" disabled={!turns.length} onClick={() => { void downloadFile(`序作-对话-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, JSON.stringify(chat.conversation, null, 2)); }}><Download size={14} />导出</button><button type="button" className="text-button" onClick={onLegacy}>以往创作对话</button></div>}
    {chat.loading && <p className="workspace-chat-working" role="status"><LoaderCircle size={16} className="spin" />正在读取已保存的对话…</p>}
    {!chat.loading && !turns.length && <div className="workspace-chat-welcome"><div className="workspace-chat-welcome-icon"><MessageCircle size={26} /></div><p>问问题、讨论需求，或者把想法变成图片与文档。</p><span>聊天直接开始，只有制作作品时才需要选择保存项目。</span><div>{['帮我把一句产品介绍写得更吸引人', '帮我制作一张产品宣传图，自动检查并精修一轮'].map((text, index) => <button type="button" key={text} onClick={() => { input.setText(text); setMode(index ? 'plan' : 'chat'); textarea.current?.focus(); }}>{text}</button>)}</div></div>}
    {!!turns.length && <div ref={thread} className="workspace-chat-thread" role="log" aria-label="聊天消息" onScroll={() => { const element = thread.current; if (element) pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 90; }}>
      {turns.length > visible && <button type="button" className="text-button" onClick={() => setVisible(value => value + 20)}>查看更早的沟通</button>}
      {turns.slice(-visible).map(turn => <div key={turn.id}><ChatMessagePair turn={turn} canRetry={!chat.running && !chat.pending && turn.id === latest?.id} onRetry={retryTurn} onMake={makeTurn} onCopy={copyTurn} />{turn.plan && <div className="workspace-chat-plan-action">{activePlan === turn.id ? <Suspense fallback={<p role="status">正在打开已保存的制作方案…</p>}><ChatPlanProduction props={props} turn={turn} conversationId={conversationId} planner={{ modelConfigId: turn.modelConfigId, credentialId: turn.credentialId, reasoningEffort: turn.reasoningEffort }} /></Suspense> : <button type="button" className="btn btn-secondary" onClick={() => setActivePlan(turn.id)}>查看这份方案与作品</button>}</div>}</div>)}
    </div>}
    {(chat.error || input.error) && <div className="workspace-chat-error" role="alert">{chat.error || input.error}<button type="button" className="text-button" disabled={chat.pending} onClick={chat.reload}>重新读取 · 不调用 AI</button></div>}
    {turns.some(turn => turn.saveIssue) && <button type="button" className="btn btn-secondary" disabled={chat.pending || chat.running} onClick={() => { void chat.flush(); }}>重试保存 · 不调用 AI</button>}
    <form className="workspace-chat-composer" aria-label="聊天输入" onSubmit={event => { event.preventDefault(); void send(); }}>
      <div className="workspace-chat-composer-toolbar"><div className="workspace-chat-modes" role="group" aria-label="对话用途"><button type="button" aria-pressed={mode !== 'plan'} onClick={() => setMode('chat')}><MessageCircle size={15} />聊天</button><button type="button" aria-pressed={mode === 'plan'} onClick={() => setMode('plan')}><WandSparkles size={15} />制作</button></div><ConversationModelPicker configuration={props.configuration} value={binding} disabled={chat.pending || chat.running} onChange={chooseBinding} /></div>
      {mode === 'plan' && <div className="workspace-chat-formats" role="group" aria-label="制作格式">{HOME_CREATION_KINDS.map(item => <button type="button" key={item.kind} aria-pressed={kind === item.kind} onClick={() => setKind(item.kind)}>{item.label}</button>)}<span>先看方案，再决定制作</span></div>}
      <textarea ref={textarea} rows={3} maxLength={10000} aria-label="聊天内容" placeholder={mode === 'plan' ? '描述你想制作的图片、文档或表格…' : '直接提问，也可以接着讨论上一条回复…'} value={input.text} onChange={event => input.setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void send(); } }} />
      <div className="workspace-chat-composer-footer"><span>{!selected.model || !selected.credentialId ? <button type="button" className="text-button" onClick={() => props.navigate('models')}>接入模型</button> : chat.running ? '正在回复，可停止后补充；也可新建对话' : 'Enter 发送 · Shift+Enter 换行'}{turns.length > 0 && <span className="workspace-chat-total">本对话 <CostTotal summary={summary} /></span>}</span>{chat.running ? <button className="workspace-chat-send is-stop" type="button" disabled={chat.pending} aria-label="停止回复" onClick={() => { void chat.stop(); }}><Square size={17} /></button> : <button className="workspace-chat-send" type="submit" disabled={!input.text.trim() || chat.pending || chat.loading || !chat.available} aria-label="发送聊天消息">{chat.pending ? <LoaderCircle size={19} className="spin" /> : <ArrowUp size={21} />}</button>}</div>
      {!chat.available && <p className="workspace-chat-note">真实聊天请使用最新版桌面应用，Key 保存在本机。</p>}
    </form>
    {activePlanTurn && <p className="workspace-chat-bottom-note">制作任务会在后台排队运行；你可以切回“聊天”继续沟通。</p>}
  </section>;
}
