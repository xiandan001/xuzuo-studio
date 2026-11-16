import { describe, expect, it } from 'vitest';
import type { ChatAttachment, ChatTurn } from '../chat-types';
import { availableChatScenarios, findChatScenario } from './chat-scenarios';
import { recentChatReferences, scenarioChatReferences } from './chat-reference-selection';
const files: ChatAttachment[] = [{ id: 'image', name: '图.png', mimeType: 'image/png', bytes: 100, kind: 'image', sha256: 'a'.repeat(64), createdAt: '' }, { id: 'word', name: '资料.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: 100, kind: 'office', sha256: 'b'.repeat(64), createdAt: '' }];
describe('连续场景引用真实历史材料', () => {
  it('第三轮仍能找到第一轮图，并把满足场景的原图作为本轮明确材料校验', () => {
    const turns = [{ status: 'complete', attachments: [files[0]] }, { status: 'complete', attachments: [] }] as unknown as ChatTurn[];
    const scene = findChatScenario(availableChatScenarios('workspace'), 'chat-vision'); expect(scenarioChatReferences(scene, [], recentChatReferences(turns), true)).toEqual([files[0]]);
  });
  it('文字模型解读旧Word不会顺便带入不兼容旧图片，明确选择的新材料不静默丢弃', () => {
    const scene = findChatScenario(availableChatScenarios('workspace'), 'chat-reading'); expect(scenarioChatReferences(scene, [], files, false)).toEqual([files[1]]); expect(scenarioChatReferences(scene, [files[0]], files, false)).toEqual([files[0]]);
  });
});
