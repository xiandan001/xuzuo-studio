import { expect, it } from 'vitest';
import type { ChatConversation } from '../chat-types';
import type { SearchTarget } from './global-search';
import { checkedChatSearchTarget, hasDocumentUnit } from './search-navigation';
const target = { token: 'token', kind: 'chat', id: 'conversation', conversationId: 'conversation', turnId: 'turn', name: '实际命中', workspaceId: 'workspace' } as SearchTarget;
const conversation = { workspaceId: 'workspace', id: 'conversation', turns: [{ id: 'turn' }] } as ChatConversation;
it('仅接受匹配工作区、真实会话和仍存在的消息，不导航到过期或其他工作区的同名ID', () => {
  expect(checkedChatSearchTarget(target, 'workspace', conversation)).toMatchObject({ turnId: 'turn' });
  expect(() => checkedChatSearchTarget(target, 'other', conversation)).toThrow(/不可用/);
  expect(() => checkedChatSearchTarget(target, 'workspace', { ...conversation, id: 'other' })).toThrow(/不可用/);
  expect(() => checkedChatSearchTarget(target, 'workspace', { ...conversation, turns: [] })).toThrow(/不可用/);
  expect(() => checkedChatSearchTarget(target, 'workspace', { ...conversation, trashedAt: '2026-11-17' })).toThrow(/不可用/);
});
it('文档定位只接受真实来源中的对应block或slide，兼容已有._:标识并拒绝其他类型与伪造位置', () => {
  const word = JSON.stringify({ kind: 'word', blocks: [{ id: 'block.one:2_media' }] });
  expect(hasDocumentUnit(word, 'word', 'block.one:2_media')).toBe(true);
  expect(hasDocumentUnit(word, 'ppt', 'block.one:2_media')).toBe(false); expect(hasDocumentUnit(word, 'word', 'missing')).toBe(false);
  expect(hasDocumentUnit('<div>not a saved source</div>', 'word', 'unit')).toBe(false);
  expect(hasDocumentUnit(JSON.stringify({ kind: 'ppt', slides: [{ id: 'slide-2' }] }), 'ppt', 'slide-2')).toBe(true);
});
