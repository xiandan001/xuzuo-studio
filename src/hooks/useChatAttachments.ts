import { useEffect, useRef, useState } from 'react';
import type { ChatAttachment } from '../chat-types';

export function useChatAttachments(workspaceId: string, conversationId: string) {
  const key = `xuzuo-chat-attachments-v1:${workspaceId}:${conversationId}`;
  const [files, setFiles] = useState<ChatAttachment[]>(() => {
    try { const value = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(value) && value.length <= 8 && value.every(item => item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.mimeType === 'string' && Number.isSafeInteger(item.bytes)) ? value : []; } catch { return []; }
  });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const current = useRef(files), importing = useRef(false), revision = useRef(0), mounted = useRef(true); current.current = files;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function save(next: ChatAttachment[]) {
    try { localStorage.setItem(key, JSON.stringify(next)); }
    catch { setError('附件草稿暂未保留，请保持当前对话打开。'); }
    revision.current++; current.current = next; setFiles(next);
  }
  async function add() {
    const bridge = window.desktop?.chat;
    if (!bridge?.importAttachments || importing.current) return;
    importing.current = true; setBusy(true); setError('');
    try {
      const added = await bridge.importAttachments({ workspaceId, conversationId });
      if (!mounted.current || !added.length) return;
      const next = [...new Map([...current.current, ...added].map(file => [file.id, file])).values()];
      if (next.length > 8 || next.reduce((sum, file) => sum + file.bytes, 0) > 80 * 1024 * 1024) { setError('本轮最多添加8份附件，总大小不超过80MB。请先移除不需要的文件。'); return; }
      save(next);
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '附件未能导入，请重试。'); }
    finally { importing.current = false; if (mounted.current) setBusy(false); }
  }
  function clearSubmitted(version: number) { if (version === revision.current) save([]); }
  return { files, busy, error, revision, add, remove: (id: string) => save(current.current.filter(file => file.id !== id)), clearSubmitted };
}
