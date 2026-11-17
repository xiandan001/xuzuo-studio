import { expect, it } from 'vitest';
import type { LedgerEntry } from '../types';
import { recentNotificationItems } from './notification-items';
const entry = (id: string, time: string, extra: Partial<LedgerEntry> = {}) => ({ id, projectId: 'project', workspaceId: 'workspace', projectName: '登记项目', time, status: 'complete', ...extra }) as LedgerEntry;
it('合并项目账本与聊天账本后按实际时间选最近动态，同任务多个步骤只占一行', () => {
  const rows = [entry('step1', '2026-11-10', { workflowRunId: 'run' }), entry('step2', '2026-11-12', { workflowRunId: 'run', status: 'failed' }), entry('second-run', '2026-11-11', { workflowRunId: 'run-b' }), entry('chat-newest', '2026-11-17', { scope: 'chat', conversationId: 'conversation', projectId: 'chat-conversation' })];
  const value = recentNotificationItems(rows, 'workspace', new Set(['project']));
  expect(value.map(item => item.entry.id)).toEqual(['chat-newest', 'step2', 'second-run']); expect(value[1].key).toBe('run:run');
});
it('最多四个独立事件，不展示外工作区或无明确当前项目归属的旧记录', () => {
  const rows = Array.from({ length: 8 }, (_, n) => entry('row-' + n, '2026-11-' + (10 + n)));
  rows.push(entry('foreign', '2026-11-19', { workspaceId: 'foreign' }), entry('unowned-legacy', '2026-11-20', { workspaceId: undefined, projectId: 'unknown' }));
  const value = recentNotificationItems(rows, 'workspace', new Set(['project']));
  expect(value.map(item => item.entry.id)).toEqual(['row-7', 'row-6', 'row-5', 'row-4']);
});
