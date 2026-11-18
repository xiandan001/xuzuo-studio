import type { ChatConversation } from '../chat-types';
import type { SearchTarget } from './global-search';

const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value);
export function checkedChatSearchTarget(target: SearchTarget, workspaceId: string, conversation: ChatConversation) {
  const id = target.conversationId || target.id;
  if (target.kind !== 'chat' || target.workspaceId !== workspaceId || !validId(id) || conversation.workspaceId !== workspaceId || conversation.id !== id || conversation.trashedAt || conversation.unavailableReason || target.turnId !== undefined && (!validId(target.turnId) || !conversation.turns.some(turn => turn.id === target.turnId))) throw Error('这条聊天或消息已不可用，请重新搜索；原记录与费用保留。');
  return { ...target, id, conversationId: id, workspaceId };
}
export function hasDocumentUnit(text: string | undefined, kind: 'word' | 'ppt' | 'excel', unitId: string) {
  if (typeof text !== 'string' || text.length > 8 * 1024 * 1024 || !(typeof unitId === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(unitId))) return false;
  try {
    const document = JSON.parse(text);
    if (document.kind !== kind) return false;
    const units = kind === 'word' ? document.blocks : kind === 'ppt' ? document.slides : document.sheets;
    return Array.isArray(units) && units.some(item => item?.id === unitId);
  } catch { return false; }
}
