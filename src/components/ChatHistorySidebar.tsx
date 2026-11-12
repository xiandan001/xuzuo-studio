import { useEffect, useRef, useState } from 'react';
import { Archive, History, LoaderCircle, Pin, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react';
import type { ChatConversationSummary, ChatHistoryPage, ChatManageRequest } from '../chat-types';
import { Select } from './Select';
import './chat-history-sidebar.css';

interface Props { workspaceId: string; activeId: string; onSelect: (id: string) => void; onNew: () => void; onClose?: () => void; }
export function ChatHistorySidebar({ workspaceId, activeId, onSelect, onNew, onClose }: Props) {
  const [query, setQuery] = useState(''), [scope, setScope] = useState<'active' | 'archived' | 'trash'>('active');
  const [page, setPage] = useState<ChatHistoryPage>({ items: [], scanned: 0, total: 0 });
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [refresh, setRefresh] = useState(0), [actionBusy, setActionBusy] = useState('');
  const [rename, setRename] = useState<{ id: string; title: string }>();
  const epoch = useRef(0), live = useRef(true), renameInput = useRef<HTMLInputElement>(null), paging = useRef(false);
  const workspace = useRef(workspaceId), actionPending = useRef(false); workspace.current = workspaceId;
  useEffect(() => { live.current = true; return () => { live.current = false; epoch.current++; }; }, []);
  useEffect(() => { if (rename) renameInput.current?.focus(); }, [rename?.id]);
  useEffect(() => {
    const bridge = window.desktop?.chat;
    if (!bridge?.search) { setError('请使用新版桌面应用查看聊天记录。'); return; }
    const generation = ++epoch.current; let disposed = false;
    setBusy(true); setError(''); setPage({ items: [], scanned: 0, total: 0 });
    const timer = setTimeout(() => { void (async () => {
      try {
        let value = await bridge.search({ workspaceId, query: query.trim(), scope, limit: 30 });
        for (let index = 0; query.trim() && !value.items.length && value.nextCursor !== undefined && index < 4 && !disposed; index++) {
          if (generation !== epoch.current) return;
          const next = await bridge.search({ workspaceId, query: query.trim(), scope, limit: 30, cursor: value.nextCursor });
          value = { ...next, scanned: value.scanned + next.scanned };
        }
        if (!disposed && generation === epoch.current) setPage(value);
      } catch (cause) { if (!disposed && generation === epoch.current) setError(cause instanceof Error ? cause.message : '聊天目录暂时无法读取，记录未被修改。'); }
      finally { if (!disposed && generation === epoch.current) setBusy(false); }
    })(); }, query ? 220 : 0);
    return () => { disposed = true; clearTimeout(timer); };
  }, [workspaceId, query, scope, refresh]);
  useEffect(() => window.desktop?.chat?.onChanged(event => { if (event.workspaceId === workspaceId && (event.historyChanged || event.ledgerChanged)) setRefresh(value => value + 1); }), [workspaceId]);
  async function more() {
    if (paging.current || busy || page.nextCursor === undefined || !window.desktop?.chat?.search) return;
    paging.current = true; setBusy(true); const generation = epoch.current;
    try { const next = await window.desktop.chat.search({ workspaceId, query: query.trim(), scope, cursor: page.nextCursor, limit: 30 }); if (live.current && generation === epoch.current) setPage(previous => ({ ...next, items: [...new Map([...previous.items, ...next.items].map(item => [item.id, item])).values()], scanned: previous.scanned + next.scanned })); }
    catch (cause) { if (live.current && generation === epoch.current) setError(cause instanceof Error ? cause.message : '较早记录暂时无法读取。'); }
    finally { paging.current = false; if (live.current && generation === epoch.current) setBusy(false); }
  }
  async function manage(item: ChatConversationSummary, action: ChatManageRequest['action'], title?: string) {
    if (actionPending.current || !window.desktop?.chat?.manage) return;
    const requested = workspaceId; actionPending.current = true; setActionBusy(item.id); setError('');
    try { await window.desktop.chat.manage({ workspaceId, conversationId: item.id, action, ...(title ? { title } : {}) }); if (live.current && workspace.current === requested) { setRename(undefined); setRefresh(value => value + 1); if (item.id === activeId && ['archive', 'trash'].includes(action)) onNew(); } }
    catch (cause) { if (live.current && workspace.current === requested) setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '整理未完成，原记录和费用保留。'); }
    finally { actionPending.current = false; if (live.current && workspace.current === requested) setActionBusy(''); }
  }
  function options(item: ChatConversationSummary) {
    return [{ value: '', label: '⋯' }, { value: 'rename', label: '重命名' }, { value: item.pinned ? 'unpin' : 'pin', label: item.pinned ? '取消置顶' : '置顶' }, ...(scope === 'trash' ? [{ value: 'restore', label: '恢复聊天' }] : scope === 'archived' ? [{ value: 'restore', label: '回到当前列表' }, { value: 'trash', label: '移入回收站' }] : [{ value: 'archive', label: '归档聊天' }, { value: 'trash', label: '移入回收站' }])];
  }
  return <aside className="chat-history-sidebar" aria-label="聊天记录管理"><header><History size={17} /><strong>聊天记录</strong><button type="button" className="btn-icon" aria-label="新建聊天" onClick={onNew}><Plus size={17} /></button>{onClose && <button type="button" className="btn-icon" aria-label="关闭聊天记录" onClick={onClose}><X size={17} /></button>}</header>
    <label className="chat-history-search"><Search size={15} /><input aria-label="搜索聊天标题和内容" placeholder="搜索标题或对话内容" value={query} onChange={event => setQuery(event.target.value)} />{query && <button type="button" className="btn-icon" aria-label="清空聊天搜索" onClick={() => setQuery('')}><X size={13} /></button>}</label>
    <div className="chat-history-scopes" role="group" aria-label="聊天记录范围">{([{ id: 'active', label: '当前', Icon: History }, { id: 'archived', label: '归档', Icon: Archive }, { id: 'trash', label: '回收站', Icon: Trash2 }] as const).map(item => <button type="button" key={item.id} aria-pressed={scope === item.id} onClick={() => { setScope(item.id); setRename(undefined); }}><item.Icon size={13} />{item.label}</button>)}</div>
    {error && <p className="chat-history-error" role="alert">{error}<button className="text-button" type="button" onClick={() => setRefresh(value => value + 1)}>重新读取</button></p>}
    <div className="chat-history-list">{page.items.map(item => <div key={item.id} className={`chat-history-row${item.id === activeId ? ' is-active' : ''}`}>
      {rename?.id === item.id ? <form onSubmit={event => { event.preventDefault(); void manage(item, 'rename', rename.title.trim()); }}><input ref={renameInput} aria-label="聊天新名称" maxLength={100} value={rename.title} onChange={event => setRename({ id: item.id, title: event.target.value })} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setRename(undefined); } }} /><button className="text-button" disabled={!rename.title.trim() || !!actionBusy} type="submit">保存</button><button className="text-button" type="button" onClick={() => setRename(undefined)}>取消</button></form> : <><button className="chat-history-open" type="button" onClick={() => onSelect(item.id)} aria-current={item.id === activeId ? 'page' : undefined}><strong>{item.pinned && <Pin size={12} />}{item.title}</strong><small>{item.activeTurnId ? '正在回复 · ' : ''}{item.turnCount} 轮 · {new Date(item.updatedAt).toLocaleDateString('zh-CN')}</small>{(item as ChatConversationSummary & { matchSnippet?: string }).matchSnippet && <span>{(item as ChatConversationSummary & { matchSnippet?: string }).matchSnippet}</span>}</button><div className="chat-history-actions"><Select aria-label={`整理聊天 ${item.title}`} value="" options={options(item)} disabled={!!item.activeTurnId || !!actionBusy} onValueChange={value => { if (value === 'rename') setRename({ id: item.id, title: item.title }); else if (value) void manage(item, value as ChatManageRequest['action']); }} /></div></>}
    </div>)}{!busy && !page.items.length && <div className="chat-history-empty">{query ? page.nextCursor !== undefined ? '已检索的记录中没有匹配，可继续查找较早内容。' : '没有找到匹配的聊天。' : scope === 'trash' ? '回收站为空。' : scope === 'archived' ? '还没有归档聊天。' : '还没有保存的聊天。'}</div>}{busy && <p className="chat-history-loading" role="status"><LoaderCircle size={15} className="spin" />正在读取记录…</p>}{page.nextCursor !== undefined && <button className="text-button chat-history-more" type="button" disabled={busy} onClick={() => { void more(); }}>{query ? '继续查找较早记录' : '加载更早记录'}</button>}</div>
    <footer>{query ? `已检索 ${page.scanned} / ${page.total} 段` : `${page.total} 段聊天`}<span><RotateCcw size={12} />归档和回收不撤回已发生费用</span></footer>
  </aside>;
}
