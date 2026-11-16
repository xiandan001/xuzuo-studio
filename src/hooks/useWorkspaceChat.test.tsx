// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatChangedEvent, ChatConversation, ChatTurn } from '../chat-types';
import { useWorkspaceChat } from './useWorkspaceChat';

let root: Root | undefined, host: HTMLDivElement | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host?.remove(); vi.unstubAllGlobals(); });
function Harness() { const chat = useWorkspaceChat('workspace', 'conversation'); return <output>{chat.conversation?.turns[0]?.text}|{chat.running ? 'running' : 'complete'}</output>; }
describe('流式聊天低开销同步', () => {
  it('正常增量不重新读整段，丢包免费读恢复，终态保留完整文字', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    let listener: (event: ChatChangedEvent) => void = () => undefined;
    const turn = { id: 'turn', text: '', userText: '问题', status: 'running', streamSequence: 0, updatedAt: '2026-11-12T00:00:00Z' } as ChatTurn;
    let value = { version: 1, id: 'conversation', workspaceId: 'workspace', title: '标题', turnCount: 1, turns: [turn] } as ChatConversation;
    const read = vi.fn(async () => structuredClone(value)), search = vi.fn(async () => ({ items: [], total: 0, scanned: 0 })), start = vi.fn();
    Object.defineProperty(window, 'desktop', { configurable: true, value: { chat: { read, search, start, onChanged: (callback: typeof listener) => { listener = callback; return () => undefined; } } } });
    host = document.createElement('div'); document.body.append(host); await act(async () => { root = createRoot(host!); root.render(<Harness />); });
    const base = { workspaceId: 'workspace', conversationId: 'conversation', ledgerChanged: false };
    await act(async () => { listener({ ...base, stream: { turnId: 'turn', sequence: 1, textOffset: 0, textDelta: '甲' } }); listener({ ...base, stream: { turnId: 'turn', sequence: 2, textOffset: 1, textDelta: '乙' } }); }); expect(host.textContent).toBe('甲乙|running'); expect(read).toHaveBeenCalledOnce();
    value = { ...value, turns: [{ ...turn, text: '甲乙丙丁', streamSequence: 4 }] };
    await act(async () => listener({ ...base, stream: { turnId: 'turn', sequence: 4, textOffset: 3, textDelta: '丁' } })); expect(read).toHaveBeenCalledTimes(2); expect(host.textContent).toBe('甲乙丙丁|running');
    await act(async () => listener({ ...base, ledgerChanged: true, turn: { ...value.turns[0], text: '甲乙丙丁戊', status: 'complete' } })); expect(host.textContent).toBe('甲乙丙丁戊|complete'); expect(read).toHaveBeenCalledTimes(2); expect(start).not.toHaveBeenCalled();
  });
});
