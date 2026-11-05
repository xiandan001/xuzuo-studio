import { describe, expect, it } from 'vitest';
import { homeFolderSendMatches, type HomeFolderSendIntent } from './home-folder-send';
const intent: HomeFolderSendIntent = { token: 'once', workspaceId: 'workspace', conversationId: 'conversation', inputVersion: 1, text: '制作产品宣传图', modelConfigId: 'planner', credentialId: 'metadata-key' };
const current = { ...intent };
describe('首页先选目录后发送原需求', () => {
  it('只接受同一工作区、对话、原输入和明确模型账户的回调', () => { expect(homeFolderSendMatches(intent, current)).toBe(true); expect(homeFolderSendMatches(intent, { ...current, text: ` ${intent.text} ` })).toBe(true); });
  it.each([{ workspaceId: 'other' }, { conversationId: 'other' }, { text: '换一个任务' }, { inputVersion: 2 }, { modelConfigId: 'another-model' }, { credentialId: 'another-key' }, { credentialId: undefined }])('上下文变化 %j 后不会自动发送已捕获请求', change => { expect(homeFolderSendMatches(intent, { ...current, ...change })).toBe(false); });
  it('取消意图后恢复原文或原账户也不能重新激活自动发送', () => { expect(homeFolderSendMatches({ ...intent, cancelled: true }, current)).toBe(false); });
});
