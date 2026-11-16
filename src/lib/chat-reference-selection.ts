import type { ChatAttachment, ChatTurn } from '../chat-types';
import type { ChatScenario } from './chat-scenarios';

export function recentChatReferences(turns: ChatTurn[]): ChatAttachment[] {
  const files = new Map<string, ChatAttachment>();
  for (const turn of turns.filter(turn => turn.status === 'complete').slice(-24).reverse()) {
    for (const file of [...(turn.contextAttachments?.length ? turn.contextAttachments : turn.attachments || [])].reverse()) if (!files.has(file.id)) files.set(file.id, file);
  }
  return [...files.values()].slice(0, 8);
}
export function scenarioChatReferences(scenario: ChatScenario, current: ChatAttachment[], history: ChatAttachment[], vision: boolean): ChatAttachment[] {
  const selected = new Map(current.map(file => [file.id, file]));
  const image = (file: ChatAttachment) => /^image\/(png|jpeg|webp)$/.test(file.mimeType);
  let images = current.filter(image).length;
  for (const file of history) {
    if (selected.has(file.id) || selected.size >= 8) continue;
    if (!vision && (image(file) || file.mimeType === 'application/pdf')) continue;
    if (images < scenario.minImageReferences && image(file) || selected.size < scenario.minAttachments && scenario.minImageReferences === 0) { selected.set(file.id, file); if (image(file)) images++; }
  }
  return [...selected.values()];
}
