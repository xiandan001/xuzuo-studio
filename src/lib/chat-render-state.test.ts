import { describe, expect, it } from 'vitest';
import type { ChatTurn } from '../chat-types';
import { stableChatTurns } from '../hooks/useWorkspaceChat';

const turn = (patch: Partial<ChatTurn> = {}): ChatTurn => ({ id: 'turn', userText: '问题', text: '', status: 'running', createdAt: '2026-11-09T00:00:00.000Z', updatedAt: '2026-11-09T00:00:00.000Z', modelName: 'model', modelId: 'model', modelConfigId: 'config', credentialId: 'key', costCents: 0, costState: 'unknown', ...patch });
describe('聊天事件与确认返回乱序', () => {
  it('快速回答先结束时，迟到的发送确认不能把界面重新锁成处理中', () => {
    const complete = turn({ status: 'complete', text: '已完成', updatedAt: '2026-11-09T00:00:01.000Z' });
    expect(stableChatTurns([complete], [turn()])[0]).toBe(complete);
  });
  it('保留流式较新的文字，避免迟到快照使正文跳回空白', () => {
    const partial = turn({ text: '已经返回的文字' }); expect(stableChatTurns([partial], [turn()])[0]).toBe(partial);
  });
  it('未变化的历史行保持引用，新终态和费用仍可更新', () => {
    const old = turn({ status: 'complete', text: '正文' }); expect(stableChatTurns([old], [{ ...old }])[0]).toBe(old);
    const newer = { ...old, costState: 'manual' as const, costCents: 2, updatedAt: '2026-11-09T00:00:02.000Z' }; expect(stableChatTurns([old], [newer])[0]).toBe(newer);
  });
  it('免费重试保存清除警告，即使回复文本和时间没有改变', () => {
    const old = turn({ status: 'complete', text: '正文', saveIssue: '尚未保存' });
    const saved = { ...old, saveIssue: undefined }; expect(stableChatTurns([old], [saved])[0]).toBe(saved);
  });
});
