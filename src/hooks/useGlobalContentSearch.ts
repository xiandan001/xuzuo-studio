import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatHistoryPage } from '../chat-types';
import type { ContentSearchPage } from '../content-search-types';
import type { LocalSearchItem } from '../lib/global-search';
import { normalizeSearch } from '../lib/global-search';

interface State { scope: string; query: string; chats: LocalSearchItem[]; documents: LocalSearchItem[]; chatCursor?: number; documentCursor?: string; chatLoading: boolean; documentLoading: boolean; scannedChats: number; scannedDocuments: number; skippedDocuments: number; cacheUnavailable: boolean; error: string; }
const empty = (scope: string, query: string): State => ({ scope, query, chats: [], documents: [], chatLoading: false, documentLoading: false, scannedChats: 0, scannedDocuments: 0, skippedDocuments: 0, cacheUnavailable: false, error: '' });
function chats(page: ChatHistoryPage, query: string, workspaceId: string): LocalSearchItem[] {
  return page.items.filter(item => item.workspaceId === workspaceId && !item.trashedAt && !item.archivedAt).map(item => ({ key: 'chat:' + item.id, id: item.id, conversationId: item.id, ...(item.matchTurnId ? { turnId: item.matchTurnId } : {}), kind: 'chat', name: item.title, description: item.matchSnippet || '打开这段已保存的聊天', text: normalizeSearch(item.title + ' ' + (item.matchSnippet || '')), matchedQuery: query, view: 'overview' }));
}
function documents(page: ContentSearchPage, query: string): LocalSearchItem[] {
  return page.items.filter(item => item.artifact.id === item.id && item.artifact.projectId === item.projectId && !item.artifact.trashedAt && !item.artifact.unavailable).map(item => ({ key: 'document:' + item.id, id: item.id, kind: 'document', name: item.artifact.name, description: item.projectName + ' · ' + item.snippet, text: normalizeSearch(item.artifact.name + ' ' + item.snippet), matchedQuery: query, projectId: item.projectId, file: item.artifact, view: 'documents' }));
}
export function useGlobalContentSearch(workspaceId: string, query: string) {
  const [state, setState] = useState(() => empty(workspaceId, query)), [revision, setRevision] = useState(0);
  const epoch = useRef(0), requests = useRef(new Map<string, 'chat' | 'document'>()), paging = useRef({ chat: false, document: false });
  const chat = window.desktop?.chat, content = window.desktop?.contentSearch;
  useEffect(() => {
    const generation = ++epoch.current; let current = true;
    setState({ ...empty(workspaceId, query), chatLoading: !!query && !!chat?.search, documentLoading: !!query && !!content });
    const timer = setTimeout(() => {
      if (!query) return;
      if (chat?.search) {
        const requestId = crypto.randomUUID(); requests.current.set(requestId, 'chat');
        void chat.search({ workspaceId, requestId, query, scope: 'active', limit: 6 }).then(page => { if (current && generation === epoch.current) setState(value => ({ ...value, chats: chats(page, query, workspaceId), chatCursor: page.nextCursor, scannedChats: page.scanned })); }).catch(cause => { if (current && generation === epoch.current) setState(value => ({ ...value, error: cause instanceof Error ? cause.message : '聊天正文暂未检索完成。' })); }).finally(() => { requests.current.delete(requestId); if (current && generation === epoch.current) setState(value => ({ ...value, chatLoading: false })); });
      }
      if (content) {
        const requestId = crypto.randomUUID(); requests.current.set(requestId, 'document');
        void content.search({ workspaceId, requestId, query, limit: 6 }).then(page => { if (current && generation === epoch.current) setState(value => ({ ...value, documents: documents(page, query), documentCursor: page.nextCursor, scannedDocuments: page.scanned, skippedDocuments: page.skipped, cacheUnavailable: !!page.cacheUnavailable })); }).catch(cause => { if (current && generation === epoch.current) setState(value => ({ ...value, error: cause instanceof Error ? cause.message : '文档正文暂未检索完成。' })); }).finally(() => { requests.current.delete(requestId); if (current && generation === epoch.current) setState(value => ({ ...value, documentLoading: false })); });
      }
    }, query ? 220 : 0);
    return () => {
      current = false; clearTimeout(timer); epoch.current++;
      for (const [requestId, kind] of requests.current) void (kind === 'chat' ? chat?.cancelSearch?.({ workspaceId, requestId }) : content?.cancel({ workspaceId, requestId }))?.catch(() => undefined);
      requests.current.clear(); paging.current = { chat: false, document: false };
    };
  }, [workspaceId, query, chat, content, revision]);
  async function more(kind: 'chat' | 'document') {
    const cursor = kind === 'chat' ? state.chatCursor : state.documentCursor;
    if (!query || paging.current[kind] || cursor === undefined || kind === 'chat' && !chat?.search || kind === 'document' && !content) return;
    const generation = epoch.current, requestId = crypto.randomUUID(); paging.current[kind] = true; requests.current.set(requestId, kind);
    setState(value => ({ ...value, [kind === 'chat' ? 'chatLoading' : 'documentLoading']: true, error: '' }));
    try {
      if (kind === 'chat') {
        const page = await chat!.search({ workspaceId, requestId, query, cursor: cursor as number, scope: 'active', limit: 6 });
        if (generation === epoch.current) setState(value => ({ ...value, chats: [...new Map([...value.chats, ...chats(page, query, workspaceId)].map(item => [item.key, item])).values()], chatCursor: page.nextCursor, scannedChats: value.scannedChats + page.scanned }));
      } else {
        const page = await content!.search({ workspaceId, requestId, query, cursor: cursor as string, limit: 6 });
        if (generation === epoch.current) setState(value => ({ ...value, documents: [...new Map([...value.documents, ...documents(page, query)].map(item => [item.key, item])).values()], documentCursor: page.nextCursor, scannedDocuments: value.scannedDocuments + page.scanned, skippedDocuments: value.skippedDocuments + page.skipped, cacheUnavailable: value.cacheUnavailable || !!page.cacheUnavailable }));
      }
    } catch (cause) { if (generation === epoch.current) setState(value => ({ ...value, error: cause instanceof Error ? cause.message : '较早正文尚未检索完成。' })); }
    finally { requests.current.delete(requestId); if (generation === epoch.current) paging.current[kind] = false; if (generation === epoch.current) setState(value => ({ ...value, [kind === 'chat' ? 'chatLoading' : 'documentLoading']: false })); }
  }
  const visible = state.scope === workspaceId && state.query === query ? state : empty(workspaceId, query);
  const items = useMemo(() => [...visible.chats, ...visible.documents], [visible.chats, visible.documents]);
  return { ...visible, items, more, retry: () => setRevision(value => value + 1), supported: !!chat?.search || !!content };
}
