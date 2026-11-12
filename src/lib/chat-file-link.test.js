import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url), { chatExportsValid, checkedChatExport } = require('../../electron/chat-file-link.cjs');
function fixture() {
  const text = '完整回复\n\n已确认的正文与表格', sourceSha256 = createHash('sha256').update(text).digest('hex');
  const input = { workspaceId: 'workspace', conversationId: 'conversation', turnId: 'turn', runId: 'local-export-run', kind: 'word', sourceSha256 };
  const record = { id: input.conversationId, turns: [{ id: 'turn', status: 'complete', mode: 'chat', text }] };
  const run = { id: input.runId, projectId: 'project', workspaceId: input.workspaceId, mode: 'live', createdAt: new Date().toISOString(), snapshot: { outputKind: 'word', sourceChat: { conversationId: input.conversationId, turnId: input.turnId, sha256: input.sourceSha256 }, steps: [{ id: 'export', kind: 'export', enabled: true }] } };
  return { input, record, run };
}
describe('聊天文件来源元数据关联', () => {
  it('同run重试关联返回原记录，保存元数据不包含原文、Key和附件', () => {
    const f = fixture(), link = checkedChatExport(f.record, f.input, f.run), existing = { ...f.record, exports: [link] };
    expect(checkedChatExport(existing, f.input, f.run)).toBe(link); expect(chatExportsValid([link])).toBe(true);
    expect(Object.keys(link).sort()).toEqual(['createdAt', 'kind', 'projectId', 'runId', 'sourceSha256', 'turnId'].sort()); expect(JSON.stringify(link)).not.toContain(f.record.turns[0].text);
  });
  it('不同回复字节、对话、模型步骤、工作区均不能伪造本地0费用导出来源', () => {
    const f = fixture();
    expect(() => checkedChatExport({ ...f.record, turns: [{ ...f.record.turns[0], text: '已改正文' }] }, f.input, f.run)).toThrow('已变化');
    expect(() => checkedChatExport(f.record, { ...f.input, conversationId: 'other-conversation' }, f.run)).toThrow('绑定当前回复');
    expect(() => checkedChatExport(f.record, f.input, { ...f.run, workspaceId: 'other-workspace' })).toThrow('绑定当前回复');
    expect(() => checkedChatExport(f.record, f.input, { ...f.run, snapshot: { ...f.run.snapshot, steps: [{ kind: 'text', enabled: true }] } })).toThrow('绑定当前回复');
  });
  it('冲突run不会覆盖关联，未完成或回收站中的聊天不被导出链路写回', () => {
    const f = fixture(), link = checkedChatExport(f.record, f.input, f.run);
    expect(() => checkedChatExport({ ...f.record, exports: [{ ...link, projectId: 'different-project' }] }, f.input, f.run)).toThrow('不同的来源');
    expect(() => checkedChatExport({ ...f.record, turns: [{ ...f.record.turns[0], status: 'running' }] }, f.input, f.run)).toThrow('尚未完整保存');
    expect(() => checkedChatExport({ ...f.record, trashedAt: new Date().toISOString() }, f.input, f.run)).toThrow('恢复聊天');
    expect(chatExportsValid([link, link])).toBe(false); expect(chatExportsValid([{ ...link, apiKey: 'unexpected' }])).toBe(false);
  });
});
