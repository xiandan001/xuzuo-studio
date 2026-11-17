import { expect, it } from 'vitest';
import type { ChatExportLink, ChatProductionLink, ChatTurn } from '../chat-types';
import { chatTimeline } from './chat-timeline';
const turn = (id: string, day: number) => ({ id, userText: id, text: id, createdAt: '2026-11-' + day + 'T00:00:00.000Z' }) as ChatTurn;
const target = { projectId: 'project', artifactId: 'artifact', sha256: 'a'.repeat(64), kind: 'image' as const };
it('两轮沟通和多次保存按来源轮次组织，不把第一轮产物追加到第二轮之后', () => {
  const turns = [turn('first', 10), turn('second', 12)];
  const exports = [{ runId: 'word-save', projectId: 'word', turnId: 'first', kind: 'word', sourceSha256: 'b'.repeat(64), createdAt: '2026-11-13T00:00:00.000Z' }] as ChatExportLink[];
  const productions = [{ runId: 'refinement', target, instruction: '第一轮局部修改', sourceTurnId: 'first', createdAt: '2026-11-14T00:00:00.000Z' }] as ChatProductionLink[];
  const value = chatTimeline(turns, exports, productions);
  expect(value.map(item => item.key)).toEqual(['turn:first', 'turn:second']); expect(value[0].kind).toBe('turn');
  if (value[0].kind === 'turn') expect(value[0].outputs.map(item => item.link.runId)).toEqual(['word-save', 'refinement']);
  expect(turns[0]).not.toHaveProperty('outputs');
});
it('旧记录缺少轮次或指向不存在的轮次时，保留实际发生位置且不猜测关联到别的消息', () => {
  const links = [{ runId: 'old', target, instruction: '旧修订', createdAt: '2026-11-11T00:00:00.000Z' }, { runId: 'missing', target, instruction: '来源已移除', sourceTurnId: 'absent', createdAt: '2026-11-13T00:00:00.000Z' }] as ChatProductionLink[];
  const value = chatTimeline([turn('first', 10), turn('second', 12)], [], links);
  expect(value.map(item => [item.kind, item.key])).toEqual([['turn', 'turn:first'], ['legacy', 'production:old'], ['turn', 'turn:second'], ['legacy', 'production:missing']]);
  expect(value.filter(item => item.kind === 'turn').every(item => !item.outputs.length)).toBe(true);
});
