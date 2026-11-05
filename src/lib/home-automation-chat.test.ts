import { describe, expect, it } from 'vitest';
import { homeChatCommand, homeChatSendIssue, homeChatKey, homeFirstRetryInput, homeFollowupInput, homeRefinementCommand, homeSuggestedProjectKind, newHomeConversation, normalizeHomeInitialContext, readHomeConversation, upsertHomeMessage, writeHomeConversation } from './home-automation-chat';

describe('首页对话记录与明确本地指令', () => {
  it('只有明确创建/运行短命令才本地执行，不把普通需求或否定句当操作', () => {
    expect(homeChatCommand('就按这个创建。')).toBe('create'); expect(homeChatCommand('运行一次')).toBe('run');
    expect(homeChatCommand('不要创建')).toBeUndefined(); expect(homeChatCommand('创建一个产品宣传图流程')).toBeUndefined(); expect(homeChatCommand('先别创建，换成暖色')).toBeUndefined();
  });
  it('同一真实规划消息重复到达只更新一次，保留原请求和费用引用', () => {
    const conversation = newHomeConversation('workspace', 'conversation');
    const message = { id: 'assistant-one', role: 'assistant' as const, kind: 'plan' as const, text: '产品海报方案', requestId: 'request-one', runId: 'run-one', createdAt: '2026-11-03T00:00:00Z' };
    const first = upsertHomeMessage(conversation, message), second = upsertHomeMessage(first, { ...message, text: '完整方案就绪' });
    expect(second.messages).toHaveLength(1); expect(second.messages[0]).toMatchObject({ requestId: 'request-one', runId: 'run-one', text: '完整方案就绪' }); expect(conversation.messages).toHaveLength(0);
  });
  it('明确的精修次数短指令可本地调整，复合需求继续交给AI理解', () => {
    expect(homeRefinementCommand('取消精修')).toBe(0); expect(homeRefinementCommand('改成精修二轮。')).toBe(2);
    expect(homeRefinementCommand('3轮精修')).toBe(3); expect(homeRefinementCommand('不要精修，再换成国风')).toBeUndefined(); expect(homeRefinementCommand('精修10轮')).toBeUndefined();
  });
  it('工作区不匹配或坏消息引用拒绝读取，不覆盖存储', () => {
    const conversation = newHomeConversation('workspace-a', 'conversation');
    const storage = { getItem: () => JSON.stringify(conversation) };
    expect(() => readHomeConversation(storage, 'workspace-b', 'conversation')).toThrow();
    expect(() => readHomeConversation({ getItem: () => JSON.stringify({ ...conversation, messages: [{ id: 'message', role: 'assistant', kind: 'plan', text: '方案', steps: 'bad-shape', createdAt: '2026-11-03T00:00:00Z' }] }) }, 'workspace-a', 'conversation')).toThrow('方案引用');
  });
  it('新对话只继承模型Key引用和目标，不继承旧方案计费项目，坏配置不采用', () => {
    const conversation = { ...newHomeConversation('workspace', 'conversation'), initialContext: { projectId: 'project-one', planner: { modelConfigId: 'model-two', credentialId: 'credential-two' } } };
    const stored = readHomeConversation({ getItem: () => JSON.stringify(conversation) }, 'workspace', 'conversation');
    expect(stored.initialContext).toEqual(conversation.initialContext); expect(stored.billingProjectId).toBeUndefined(); expect(stored.messages).toEqual([]);
    expect(() => readHomeConversation({ getItem: () => JSON.stringify({ ...conversation, initialContext: { planner: { modelConfigId: {} } } }) }, 'workspace', 'conversation')).toThrow('初始配置');
  });
  it('新对话的四类制作模型独立继承且复制，空编号清理，不混入真实Key或不支持的用途', () => {
    const input = { projectId: 'project-one', planner: { modelConfigId: 'planner-one', credentialId: '' }, bindings: { text: { modelConfigId: 'text-model', credentialId: 'text-key' }, vision: { modelConfigId: 'vision-model' }, 'image-generation': { modelConfigId: 'gen-model' }, 'image-editing': { modelConfigId: '', credentialId: '' } } };
    const normalized = normalizeHomeInitialContext(input);
    expect(normalized.planner).toEqual({ modelConfigId: 'planner-one' }); expect(normalized.bindings).toEqual({ text: input.bindings.text, vision: input.bindings.vision, 'image-generation': input.bindings['image-generation'] });
    normalized.bindings!.text!.modelConfigId = 'changed'; expect(input.bindings.text.modelConfigId).toBe('text-model');
    for (const bindings of [{ speech: { modelConfigId: 'speech-model' } }, { text: { modelConfigId: 'bad/id' } }, { text: { credentialId: 'sk-never-store-plaintext' } }, { text: { modelConfigId: 'text-model', secret: 'never-store' } }]) {
      const conversation = { ...newHomeConversation('workspace', 'conversation'), initialContext: { ...input, bindings } };
      expect(() => readHomeConversation({ getItem: () => JSON.stringify(conversation) }, 'workspace', 'conversation')).toThrow('初始配置');
    }
  });
  it('还没有有效方案时的再试一次保留原任务，明确新任务不混入旧目标', () => {
    const messages = [{ id: 'first', role: 'user' as const, kind: 'request' as const, text: '制作一张产品宣传图', createdAt: '2026-11-03T00:00:00Z' }];
    expect(homeFirstRetryInput('再来一次', messages)).toBe('制作一张产品宣传图');
    expect(homeFirstRetryInput('换成国风', messages)).toContain('制作一张产品宣传图\n\n用户本轮补充要求');
    expect(homeFirstRetryInput('帮我写一份PPT', messages)).toBe('帮我写一份PPT');
  });
  it('续改失败后再试一次保留失败那轮的具体意图，而非只重复成功的旧版', () => {
    const messages = [{ id: 'first', role: 'user' as const, kind: 'request' as const, text: '蓝色产品图', requestId: 'plan-a', createdAt: '2026-11-03T00:00:00Z' }, { id: 'reply', role: 'assistant' as const, kind: 'plan' as const, text: '蓝色方案', requestId: 'plan-a', createdAt: '2026-11-03T00:00:01Z' }, { id: 'second', role: 'user' as const, kind: 'request' as const, text: '换成国风', requestId: 'plan-b', createdAt: '2026-11-03T00:00:02Z' }];
    expect(homeFollowupInput('再来一次', messages, true)).toBe('换成国风');
    expect(homeFollowupInput('改为白底', messages, true)).toBe('改为白底');
    expect(homeFollowupInput('再来一版', messages.slice(0, 2), true)).toBe('再来一版');
  });
  it('消息写入错误明确失败；过长会话不会静默删消息或继续写', () => {
    const conversation = newHomeConversation('workspace', 'conversation'), writes: string[] = [];
    writeHomeConversation({ setItem: key => { writes.push(key); } }, conversation); expect(writes).toEqual([homeChatKey('workspace', 'conversation')]);
    expect(() => writeHomeConversation({ setItem: () => { throw Error('quota'); } }, conversation)).toThrow('未能保存');
    expect(() => writeHomeConversation({ setItem: key => { writes.push(key); } }, { ...conversation, messages: Array.from({ length: 301 }, (_, index) => ({ id: `message-${index}`, role: 'user', kind: 'request', text: '需求', createdAt: '2026-11-03T00:00:00Z' })) })).toThrow('较长');
    expect(writes).toHaveLength(1);
  });
  it('只为新建项目提供明确的默认类型，不替用户执行多目标选择', () => {
    expect(homeSuggestedProjectKind('帮我做一张宣传图')).toBe('image'); expect(homeSuggestedProjectKind('做一份带图PPT')).toBe('ppt');
    expect(homeSuggestedProjectKind('生成Word文档与Excel表格')).toBeUndefined(); expect(homeSuggestedProjectKind('先讨论一下想法')).toBeUndefined();
  });
  it('付费前给回复和错误提示预留消息及字节空间，满对话不继续收费', () => {
    const conversation = newHomeConversation('workspace', 'conversation'), message = { id: 'message', role: 'user' as const, kind: 'request' as const, text: '需求', createdAt: '2026-11-03T00:00:00Z' };
    expect(homeChatSendIssue({ ...conversation, messages: Array(296).fill(message) })).toBeUndefined();
    expect(homeChatSendIssue({ ...conversation, messages: Array(299).fill(message) })).toContain('没有调用 AI');
    expect(homeChatSendIssue({ ...conversation, messages: Array(100).fill({ ...message, text: '文'.repeat(14000) }) })).toContain('新开对话');
  });
});
