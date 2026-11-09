import { useEffect, useRef, useState } from 'react';
import type { ChatAttachment } from '../chat-types';

export const CHAT_ATTACHMENT_LIMIT = 5;
const valid = (value: unknown): value is ChatAttachment => {
  if (!value || typeof value !== 'object') return false;
  const item = value as ChatAttachment;
  return /^[A-Za-z0-9-]{1,160}$/.test(item.id) && typeof item.name === 'string' && item.name.length > 0 && item.name.length <= 255 && typeof item.mimeType === 'string' && Number.isSafeInteger(item.bytes) && item.bytes > 0 && ['text', 'image', 'document'].includes(item.kind);
};

export function useChatAttachments(workspaceId: string, conversationId: string) {
  const key = `xuzuo-chat-attachments-v1:${workspaceId}:${conversationId}`;
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [items, setItems] = useState<ChatAttachment[]>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(value) && value.length <= CHAT_ATTACHMENT_LIMIT && value.every(valid) ? value : [];
    } catch { return []; }
  });
  const current = useRef(items), importing = useRef(false), mounted = useRef(true);
  current.current = items;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function change(next: ChatAttachment[]) {
    current.current = next; setItems(next);
    try { localStorage.setItem(key, JSON.stringify(next)); }
    catch { setError('附件草稿暂未保存，请保留当前窗口后检查本地存储。'); }
  }
  async function add() {
    if (importing.current) return;
    const importFiles = window.desktop?.chat?.importAttachments;
    if (!importFiles) { setError('请使用最新版桌面应用添加聊天附件。'); return; }
    if (current.current.length >= CHAT_ATTACHMENT_LIMIT) { setError('每条消息最多添加 5 个附件，请先移除不需要的文件。'); return; }
    importing.current = true; setBusy(true); setError('');
    try {
      const files = await importFiles({ workspaceId, conversationId });
      if (!mounted.current || !files.length) return;
      if (!files.every(valid)) throw Error('附件信息无效，请重新添加。');
      const next = [...new Map([...current.current, ...files].map(file => [file.id, file])).values()];
      if (next.length > CHAT_ATTACHMENT_LIMIT) throw Error('每条消息最多添加 5 个附件，请减少选择后重试。');
      change(next);
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '附件未能添加，原输入与附件仍保留。'); }
    finally { importing.current = false; if (mounted.current) setBusy(false); }
  }
  function useReferences(files: ChatAttachment[]) {
    const next = [...new Map([...current.current, ...files].map(file => [file.id, file])).values()];
    if (next.length > CHAT_ATTACHMENT_LIMIT) { setError('合并后超过 5 个附件，请先移除不需要的文件再转为制作。'); return false; }
    setError(''); change(next); return true;
  }
  return { items, busy, error, add, useReferences, remove: (id: string) => { setError(''); change(current.current.filter(file => file.id !== id)); }, clearSubmitted: (ids: string[]) => change(current.current.filter(file => !ids.includes(file.id))) };
}
