import { describe, expect, it } from 'vitest';
import type { ImageUseTemplate } from '../configuration-types';
import { availableChatScenarios, chatScenarioAttachmentIssue, chatScenarioInput, filterChatScenarios, findChatScenario } from './chat-scenarios';

const scenarios = availableChatScenarios('workspace');
describe('聊天使用场景', () => {
  it.each([9, 12])('合法的%d图用途进入工作台补齐，聊天入口不要求突破8份附件限制', count => {
    const template: ImageUseTemplate = { id: `many-${count}`, workspaceId: 'workspace', name: `${count}图细节`, prompt: '保留所有已确认商品细节', minReferences: count, size: '1024x1024', background: 'auto', enabled: true };
    const scenario = findChatScenario(availableChatScenarios('workspace', [template]), `purpose-${template.id}`);
    expect(scenario).toMatchObject({ entry: 'image-workbench', requiresWorkbenchReferences: true, minImageReferences: count, imagePreset: template.id }); expect(scenario.description).toContain(`补齐${count}份`); expect(scenario.placeholder).toContain(`工作台后补齐${count}张`);
    expect(chatScenarioAttachmentIssue(scenario, [])).toBeUndefined(); expect(chatScenarioAttachmentIssue(scenario, Array.from({ length: 8 }, () => ({ mimeType: 'image/png' })))).toBeUndefined();
  });
  it('复用图片内置用途和专用入口，不把专用工作台当普通生图', () => {
    for (const [id, imagePreset] of [['image-wallpaper', '壁纸'], ['image-engineering', '工程P图'], ['image-beads', '拼豆'], ['image-atlas', '角色图集'], ['image-gif', 'GIF动画工坊']]) {
      expect(findChatScenario(scenarios, id)).toMatchObject({ imagePreset, entry: 'image-workbench', mode: 'plan', outputKind: 'image' });
    }
    expect(findChatScenario(scenarios, 'image-poster').entry).toBeUndefined(); expect(findChatScenario(scenarios, 'document-ppt')).toMatchObject({ mode: 'plan', outputKind: 'ppt' });
    expect(new Set(scenarios.map(scenario => scenario.id)).size).toBe(scenarios.length);
  });
  it('工程和拼豆必须有原图，试衣两张，资料解读允许文档', () => {
    const pdf = { mimeType: 'application/pdf' }, png = { mimeType: 'image/png' };
    expect(chatScenarioAttachmentIssue(findChatScenario(scenarios, 'image-engineering'), [pdf])).toContain('1 张参考图片');
    expect(chatScenarioAttachmentIssue(findChatScenario(scenarios, 'image-engineering'), [{ mimeType: 'image/gif' }])).toContain('1 张参考图片');
    expect(chatScenarioAttachmentIssue(findChatScenario(scenarios, 'image-beads'), [])).toContain('1 张参考图片');
    expect(chatScenarioAttachmentIssue(findChatScenario(scenarios, 'image-try-on'), [png])).toContain('2 张参考图片');
    expect(chatScenarioAttachmentIssue(findChatScenario(scenarios, 'image-try-on'), [png, png])).toBeUndefined();
    expect(chatScenarioAttachmentIssue(findChatScenario(scenarios, 'chat-reading'), [pdf])).toBeUndefined();
    expect(chatScenarioAttachmentIssue(findChatScenario(scenarios, 'chat-vision'), [pdf])).toContain('参考图片');
    expect(chatScenarioAttachmentIssue(findChatScenario(scenarios, 'chat-default'), [])).toBeUndefined();
  });
  it('仅列当前工作区启用的自定义用途，保留原有参数与参考图要求', () => {
    const own: ImageUseTemplate = { id: 'purpose-id', workspaceId: 'workspace', name: '我的商品细节图', prompt: '以真实商品细节为准', minReferences: 2, size: '1024x1024', background: 'auto', enabled: true };
    const all = availableChatScenarios('workspace', [own, { ...own, id: 'other-id', workspaceId: 'other' }, { ...own, id: 'disabled-id', enabled: false }]);
    expect(all.filter(scenario => scenario.group === 'custom')).toEqual([expect.objectContaining({ id: 'purpose-purpose-id', name: own.name, imagePreset: own.id, prompt: own.prompt, minImageReferences: 2 })]);
  });
  it('按类型和名字描述搜索，场景失效时回到自由聊天', () => {
    expect(filterChatScenarios(scenarios, 'images', '4K').map(scenario => scenario.name)).toEqual(['壁纸']);
    expect(filterChatScenarios(scenarios, 'documents', 'PPT').map(scenario => scenario.id)).toEqual(['document-ppt']);
    expect(filterChatScenarios(scenarios, 'chat', '宣传图')).toEqual([]);
    expect(findChatScenario(scenarios, 'deleted-custom-purpose').id).toBe('chat-default');
  });
  it('保留用户输入，基础指令只在发送时组合，不重复相同默认内容', () => {
    const poster = findChatScenario(scenarios, 'image-poster');
    const value = chatScenarioInput(poster, '  保留我的品牌和价格，不添加促销  ');
    expect(value).toBe(`${poster.prompt}\n\n本次具体要求：\n保留我的品牌和价格，不添加促销`);
    expect(chatScenarioInput(poster, poster.prompt)).toBe(poster.prompt);
    expect(chatScenarioInput(findChatScenario(scenarios, 'chat-default'), '你好')).toBe('你好');
    expect(chatScenarioInput(findChatScenario(scenarios, 'chat-vision'), '')).toContain('实际附图');
  });
});
