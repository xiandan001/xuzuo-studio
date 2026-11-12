import type { ChatChangedEvent, ChatConversation, ChatTurn } from '../chat-types';

function newerTurn(old: ChatTurn | undefined, incoming: ChatTurn) {
  if (!old) return incoming;
  if (old.status === 'running' && incoming.status !== 'running') return incoming;
  if (old.status !== 'running' && incoming.status === 'running' || Date.parse(old.updatedAt) > Date.parse(incoming.updatedAt) || old.status === 'running' && incoming.status === 'running' && (old.streamSequence || 0) > (incoming.streamSequence || 0)) return old;
  return incoming;
}
export function applyChatChange(previous: ChatConversation | undefined, event: ChatChangedEvent): { value?: ChatConversation; needsRead: boolean } {
  if (!previous || previous.workspaceId !== event.workspaceId || previous.id !== event.conversationId) return { value: previous, needsRead: true };
  if (event.stream) {
    const delta = event.stream, old = previous.turns.find(turn => turn.id === delta.turnId);
    if (!old || !Number.isSafeInteger(delta.sequence) || delta.sequence < 1 || !Number.isSafeInteger(delta.textOffset) || delta.textOffset < 0 || typeof delta.textDelta !== 'string') return { value: previous, needsRead: true };
    if (old.status !== 'running' || delta.sequence <= (old.streamSequence || 0)) return { value: previous, needsRead: false };
    if (delta.sequence !== (old.streamSequence || 0) + 1 || delta.textOffset !== old.text.length || old.text.length + delta.textDelta.length > 2 * 1024 * 1024) return { value: previous, needsRead: true };
    const turn = { ...old, text: old.text + delta.textDelta, streamSequence: delta.sequence, updatedAt: event.updatedAt || old.updatedAt };
    return { value: { ...previous, turns: previous.turns.map(item => item.id === turn.id ? turn : item), updatedAt: turn.updatedAt, title: event.title || previous.title }, needsRead: false };
  }
  if (event.turn) {
    const turn = newerTurn(previous.turns.find(turn => turn.id === event.turn!.id), event.turn);
    const turns = previous.turns.some(item => item.id === turn.id) ? previous.turns.map(item => item.id === turn.id ? turn : item) : [...previous.turns, turn];
    return { value: { ...previous, turns, turnCount: turns.length, title: event.title || previous.title, updatedAt: event.updatedAt || turn.updatedAt, activeTurnId: turns.find(turn => turn.status === 'running')?.id }, needsRead: false };
  }
  return { value: previous, needsRead: true };
}
