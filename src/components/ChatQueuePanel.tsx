import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Clock3, LoaderCircle, Pencil, Play, X } from 'lucide-react';
import type { ChatQueueEntry, ChatQueueManageRequest } from '../chat-types';
import { useRememberedBoolean } from '../hooks/useRememberedBoolean';
import './chat-queue-panel.css';

const effortLabels = { auto: '自动', none: '快速', minimal: '极轻', low: '轻度', medium: '标准', high: '深入', xhigh: '更深入', max: '最高' };
interface Props {
  scope: string;
  entries: ChatQueueEntry[];
  busy: boolean;
  onManage: (request: Omit<ChatQueueManageRequest, 'workspaceId' | 'conversationId'>) => Promise<boolean>;
  onRestore: (entry: ChatQueueEntry) => void;
  onReturnFocus: () => void;
}
export function ChatQueuePanel({ scope, entries, busy, onManage, onRestore, onReturnFocus }: Props) {
  const key = 'xuzuo-chat-queue-edit-v1:' + scope;
  const [expanded, setExpanded] = useRememberedBoolean('chat:' + scope + ':queue-expanded', false), [issue, setIssue] = useState('');
  const [editing, setEditing] = useState(() => entries.find(item => item.editing)?.id || '');
  const [text, setText] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem(key) || 'null'); if (entries.some(item => item.id === saved?.id && item.editing) && typeof saved.text === 'string') return saved.text; } catch { /* Saved queue remains authoritative. */ }
    return entries.find(item => item.editing)?.text || '';
  });
  const editInput = useRef<HTMLTextAreaElement>(null), focusEdit = useRef(false);
  useEffect(() => { if (editing && focusEdit.current) { focusEdit.current = false; editInput.current?.focus(); } }, [editing]);
  useEffect(() => { if (editing && !entries.some(item => item.id === editing)) setEditing(''); }, [editing, entries]);
  const held = entries.some(item => item.status === 'paused'), unknown = entries.some(item => item.status === 'unknown'), restoreAccount = entries.some(item => item.needsAccount);
  const shown = expanded || editing ? entries : entries.slice(0, 2);
  function updateText(value: string) {
    setText(value);
    try { localStorage.setItem(key, JSON.stringify({ id: editing, text: value })); }
    catch { setIssue('这次编辑草稿暂未保留，请先保存修改。原待发要求不变。'); }
  }
  async function beginEdit(entry: ChatQueueEntry) {
    if (editing && editing !== entry.id) { setIssue('请先保存或取消正在编辑的待发要求。'); return; }
    if (!entry.editing && !await onManage({ id: entry.id, action: 'pause' })) return;
    let draft = entry.text;
    try { const saved = JSON.parse(localStorage.getItem(key) || 'null'); if (saved?.id === entry.id && typeof saved.text === 'string') draft = saved.text; } catch { /* The original text stays available. */ }
    setIssue(''); setText(draft); focusEdit.current = true; setEditing(entry.id);
  }
  async function finish(save: boolean) {
    if (!editing || !await onManage({ id: editing, action: save ? 'edit' : 'cancel-edit', ...(save ? { text } : {}) })) return;
    try { localStorage.removeItem(key); } catch { /* The authoritative queue has already confirmed the edit. */ }
    setEditing(''); setIssue(''); onReturnFocus();
  }
  return <section className="chat-queue-panel" aria-label="待发消息">
    <header><span><Clock3 size={14} /><strong>待发 {entries.length}</strong><small>排队与编辑不收费 · 实际发送后另行计费</small></span>{held && !unknown && !restoreAccount && <button type="button" className="text-button" disabled={busy || !!editing || entries.some(item => item.editing)} onClick={() => { void onManage({ action: 'resume' }); }}><Play size={13} />继续队列</button>}</header>
    <div className="chat-queue-items">{shown.map((entry, index) => <article key={entry.id} className={entry.status === 'unknown' ? 'is-unknown' : ''} data-queue-id={entry.id}>
      <div className="chat-queue-summary"><strong>{index + 1}</strong><div><p>{entry.text}</p><small>{entry.sceneName || (entry.mode === 'plan' ? '制作方案' : '聊天')} · {entry.modelName} · 思考：{effortLabels[entry.reasoningEffort || 'auto']} · {entry.attachments.length ? entry.attachments.length + ' 份附件 · ' : ''}{entry.status === 'starting' ? '正在提交' : entry.status === 'unknown' ? '提交未确认，不自动重发' : entry.editing ? '正在编辑' : entry.status === 'paused' ? '等待继续' : '当前回复完成后发送'}</small></div><nav>{entry.needsAccount ? <button type="button" className="text-button" disabled={busy} onClick={() => onRestore(entry)}>带回输入框</button> : entry.status !== 'unknown' && <button type="button" className="text-button" aria-label={'编辑待发消息 ' + entry.id} disabled={busy || entry.status === 'starting'} onClick={() => { void beginEdit(entry); }}><Pencil size={13} />{entry.editing ? '继续编辑' : '编辑'}</button>}<button type="button" className="text-button" aria-label={'撤回待发消息 ' + entry.id} disabled={busy || entry.status === 'starting'} onClick={() => { void onManage({ id: entry.id, action: 'withdraw' }); }}><X size={13} />{entry.status === 'unknown' ? '移出待发' : '撤回'}</button></nav></div>
      {entry.error && <p className="chat-queue-note">{entry.error}</p>}
      {editing === entry.id && <div className="chat-queue-edit" role="group" aria-label="编辑待发要求"><textarea ref={editInput} rows={3} maxLength={10000} aria-label="修改待发要求" value={text} onChange={event => updateText(event.target.value)} /><div><small>保持这条要求排队时的场景、模型、思考方式与附件。</small><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { void finish(false); }}>取消编辑</button><button type="button" className="btn btn-primary" onClick={() => { void finish(true); }} disabled={busy || !text.trim()}>{busy ? <LoaderCircle size={13} className="spin" /> : null}保存修改</button></div></div>}
    </article>)}</div>
    {entries.length > 2 && !editing && <button type="button" className="text-button chat-queue-expand" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? '收起待发列表' : '查看全部待发要求'}<ChevronDown size={12} /></button>}
    {issue && <p role="status" className="chat-queue-note">{issue}</p>}
  </section>;
}
