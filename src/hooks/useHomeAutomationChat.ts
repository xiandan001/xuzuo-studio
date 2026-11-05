import { useEffect, useRef, useState } from 'react';
import { downloadFile } from '../lib/files';
import { homeChatIndexKey, homeChatKey, newHomeConversation, normalizeHomeInitialContext, readHomeChatIndex, readHomeConversation, upsertHomeMessage, writeHomeChatIndex, writeHomeConversation } from '../lib/home-automation-chat';
import type { HomeAutomationChatIndex, HomeAutomationConversation, HomeAutomationInitialContext, HomeAutomationMessage } from '../lib/home-automation-chat';

function load(workspaceId: string): { index: HomeAutomationChatIndex; conversation: HomeAutomationConversation; issue: string } {
  try {
    const existing = readHomeChatIndex(localStorage, workspaceId);
    if (existing) return { index: existing, conversation: readHomeConversation(localStorage, workspaceId, existing.activeId), issue: '' };
    const conversation = newHomeConversation(workspaceId), index: HomeAutomationChatIndex = { version: 1, workspaceId, activeId: conversation.id, items: [{ id: conversation.id, title: conversation.title, createdAt: conversation.createdAt, updatedAt: conversation.updatedAt }] };
    return { index, conversation, issue: '' };
  } catch (cause) {
    const conversation = newHomeConversation(workspaceId);
    return { index: { version: 1, workspaceId, activeId: conversation.id, items: [] }, conversation, issue: cause instanceof Error ? cause.message : '首页对话暂时无法读取，原记录未覆盖。' };
  }
}
export function useHomeAutomationChat(workspaceId: string) {
  const [loaded] = useState(() => load(workspaceId));
  const [index, setIndex] = useState(loaded.index), [conversation, setConversation] = useState(loaded.conversation), [issue, setIssue] = useState(loaded.issue);
  const current = useRef({ index, conversation, issue }); current.current = { index, conversation, issue };
  useEffect(() => {
    if (loaded.issue) return;
    try { if (!localStorage.getItem(homeChatIndexKey(workspaceId))) { writeHomeConversation(localStorage, loaded.conversation); writeHomeChatIndex(localStorage, loaded.index); } }
    catch (cause) { setIssue(cause instanceof Error ? cause.message : '首页对话草稿未能保留，请先恢复存储。'); }
  }, [workspaceId, loaded]);
  function save(next: HomeAutomationConversation) {
    if (current.current.issue && loaded.issue) throw Error(current.current.issue);
    const previous = current.current.index;
    const item = { id: next.id, title: next.title, createdAt: next.createdAt, updatedAt: next.updatedAt };
    const updated = { ...previous, activeId: next.id, items: [item, ...previous.items.filter(entry => entry.id !== next.id)] };
    writeHomeConversation(localStorage, next); writeHomeChatIndex(localStorage, updated);
    current.current = { index: updated, conversation: next, issue: '' }; setConversation(next); setIndex(updated); setIssue('');
  }
  const append = (message: HomeAutomationMessage) => { const next = upsertHomeMessage(current.current.conversation, message); save(next); };
  function newConversation(initialContext?: HomeAutomationInitialContext) {
    try { const defaults = initialContext && normalizeHomeInitialContext(initialContext); save({ ...newHomeConversation(workspaceId), ...(defaults ? { initialContext: defaults } : {}) }); } catch (cause) { setIssue(cause instanceof Error ? cause.message : '新对话未保存，原记录保留。'); }
  }
  function select(id: string) {
    try { const next = readHomeConversation(localStorage, workspaceId, id); const updated = { ...current.current.index, activeId: id }; writeHomeChatIndex(localStorage, updated); current.current = { index: updated, conversation: next, issue: '' }; setConversation(next); setIndex(updated); setIssue(''); }
    catch (cause) { setIssue(cause instanceof Error ? cause.message : '对话未能切换，原消息仍保留。'); }
  }
  async function exportConversation() {
    const currentId = current.current.index.activeId;
    const raw = localStorage.getItem(homeChatKey(workspaceId, currentId)) || JSON.stringify(current.current.conversation, null, 2);
    return downloadFile('序作-首页对话.json', JSON.stringify({ index: localStorage.getItem(homeChatIndexKey(workspaceId)), conversation: raw, input: localStorage.getItem(`xuzuo-home-chat-input-v1:${workspaceId}:${currentId}`) }, null, 2));
  }
  async function recoverAndStart() {
    if (!await exportConversation()) return false;
    const next = newHomeConversation(workspaceId), updated: HomeAutomationChatIndex = { version: 1, workspaceId, activeId: next.id, items: [{ id: next.id, title: next.title, createdAt: next.createdAt, updatedAt: next.updatedAt }] };
    writeHomeConversation(localStorage, next); writeHomeChatIndex(localStorage, updated);
    current.current = { index: updated, conversation: next, issue: '' }; setIndex(updated); setConversation(next); setIssue(''); return true;
  }
  return { conversation, index, issue, setIssue, current, save, append, newConversation, select, exportConversation, recoverAndStart };
}
