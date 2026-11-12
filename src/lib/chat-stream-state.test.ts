import { describe, expect, it } from 'vitest';
import type { ChatConversation, ChatTurn } from '../chat-types';
import { applyChatChange } from './chat-stream-state';
const turn = { id: 'turn', userText: '问题', text: '甲', status: 'running', streamSequence: 1, updatedAt: '2026-11-12T00:00:00Z' } as ChatTurn;
const conversation = { version: 1, id: 'conversation', workspaceId: 'workspace', turns: [turn], turnCount: 1, title: '标题', updatedAt: turn.updatedAt, createdAt: turn.updatedAt } as ChatConversation;
const event = { workspaceId: 'workspace', conversationId: 'conversation', ledgerChanged: false, stream: { turnId: 'turn', sequence: 2, textOffset: 1, textDelta: '乙' } };
describe('可恢复聊天文本增量', () => {
  it('拼接精确偏移，重复和迟到包不造成重复文字', () => {
    const result = applyChatChange(conversation, event); expect(result.needsRead).toBe(false); expect(result.value!.turns[0].text).toBe('甲乙'); expect(applyChatChange(result.value, event).value).toBe(result.value);
  });
  it('丢包和未知轮次只要求免费重新读取，不猜测补字或调用模型', () => {
    expect(applyChatChange(conversation, { ...event, stream: { ...event.stream, sequence: 4 } }).needsRead).toBe(true); expect(applyChatChange(conversation, { ...event, stream: { ...event.stream, textOffset: 5 } }).needsRead).toBe(true);
    expect(applyChatChange(conversation, { ...event, stream: { ...event.stream, turnId: 'unknown' } }).needsRead).toBe(true);
  });
  it('完整终态恢复最后未发出的文字，之后旧流式包不使状态倒退', () => {
    const complete = { ...turn, status: 'complete' as const, text: '甲乙丙', streamSequence: 2 };
    const result = applyChatChange(conversation, { ...event, stream: undefined, turn: complete, ledgerChanged: true }); expect(result.value!.turns[0]).toBe(complete); expect(applyChatChange(result.value, event).value).toBe(result.value);
    const clockAdjusted = { ...complete, updatedAt: '2026-11-11T23:59:59Z' }; expect(applyChatChange(conversation, { ...event, stream: undefined, turn: clockAdjusted, ledgerChanged: true }).value!.turns[0]).toBe(clockAdjusted);
  });
});
