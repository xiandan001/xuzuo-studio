import type { ImageUseTemplate } from '../configuration-types';
import type { ProjectKind } from '../types';
import type { ChatTurn } from '../chat-types';
import { availableImageUseTemplates } from './image-use-templates';
import { WECHAT_RED_PACKET_COVER, isCoverTopicOnly, isRedPacketCoverDiscussion } from './wechat-red-packet-cover';

export type ChatScenarioGroup = 'chat' | 'images' | 'documents' | 'custom';
export interface ChatScenario {
  id: string;
  name: string;
  description: string;
  group: ChatScenarioGroup;
  mode: 'chat' | 'plan';
  outputKind?: ProjectKind;
  imagePreset?: string;
  prompt: string;
  placeholder: string;
  minAttachments: number;
  minImageReferences: number;
  entry?: 'image-workbench';
  requiresWorkbenchReferences?: boolean;
}
export const CHAT_SCENARIO_GROUPS: { id: 'all' | ChatScenarioGroup; label: string }[] = [
  { id: 'all', label: '全部' }, { id: 'chat', label: '聊天' }, { id: 'images', label: '图片' }, { id: 'documents', label: '文档' }, { id: 'custom', label: '我的用途' },
];
const chats: ChatScenario[] = [
  { id: 'chat-default', name: '自由聊天', description: '直接提问，接着讨论，不创建项目。', group: 'chat', mode: 'chat', prompt: '', placeholder: '直接提问，也可以接着讨论上一条回复…', minAttachments: 0, minImageReferences: 0 },
  { id: 'chat-vision', name: '看图问答', description: '看图片、截图，解释内容或给出修改建议。', group: 'chat', mode: 'chat', prompt: '根据本轮实际附图和对话回答问题。区分图中可见的事实与推断，文字看不清时明确说明，不猜测不可见细节。', placeholder: '添加图片，再告诉我你想看什么，例如：这张宣传图有哪些地方可以改进？', minAttachments: 1, minImageReferences: 1 },
  { id: 'chat-reading', name: '资料解读', description: '理解附件，提取要点、对比和回答问题。', group: 'chat', mode: 'chat', prompt: '依据本轮附件与上文解读资料，优先回答用户的问题。保留关键数字、单位和适用条件；区分原文结论与建议，不补造附件没有提供的事实或来源。附件解析不完整时明确说明范围。', placeholder: '添加资料，再描述问题，例如：帮我提取关键要求，并列出需要补充的信息。', minAttachments: 1, minImageReferences: 0 },
  { id: 'chat-copywriting', name: '文案讨论', description: '先讨论表达、受众和风格，再决定是否制作。', group: 'chat', mode: 'chat', prompt: '协助讨论和改写文案，保留已确认的事实。结合受众与用途给出可直接使用的表达，信息不足时只提出关键问题；不自行添加价格、销量、认证或夸大承诺。', placeholder: '贴上原文或说明用途，例如：把这句产品介绍改得简短、自然一些。', minAttachments: 0, minImageReferences: 0 },
];
const documentScenarios: ChatScenario[] = [
  { id: 'document-word', name: 'Word 文档', description: '把需求与资料整理为可编辑的正式文稿。', group: 'documents', mode: 'plan', outputKind: 'word', prompt: '规划一份完整、可编辑的 Word 文档。根据用途组织正文、原生表格及必要配图，使用清晰层级与可执行内容；只使用已提供的事实，不把待确认内容伪装成结论。', placeholder: '描述用途、读者和需要的内容，也可以直接添加资料…', minAttachments: 0, minImageReferences: 0 },
  { id: 'document-ppt', name: 'PPT 演示', description: '先梳理叙事与逐页重点，再生成图文演示。', group: 'documents', mode: 'plan', outputKind: 'ppt', prompt: '规划一份可编辑的图文 PPT。先明确受众和核心结论，安排逐页内容、图表与配图，控制每页信息量，避免只有标题和空泛提纲；未提供的数据和案例不得编造。', placeholder: '说明演示主题、受众和大约页数，可添加现有资料或参考图片…', minAttachments: 0, minImageReferences: 0 },
  { id: 'document-excel', name: 'Excel 表格', description: '设计实际可用的表格、公式和检查规则。', group: 'documents', mode: 'plan', outputKind: 'excel', prompt: '规划一份可编辑的 Excel 工作簿。根据实际业务设计工作表、清晰表头、必要公式和校验，区分输入与计算结果；有数据时据实使用，没有数据时明确示例与待填字段。', placeholder: '说明表格要管理什么、需要哪些计算，也可添加现有表格…', minAttachments: 0, minImageReferences: 0 },
];
const imageIds: Record<string, string> = { 宣传图: 'poster', 人物图: 'portrait', 卡通图: 'cartoon', 试衣图: 'try-on', 头像: 'avatar', 表情包: 'stickers', '透明 PNG': 'transparent', 壁纸: 'wallpaper', 工程P图: 'engineering', 拼豆: 'beads', 角色图集: 'atlas', GIF动画工坊: 'gif' };
const specialized = new Set(['壁纸', '工程P图', '拼豆', '角色图集', 'GIF动画工坊']);
const imageDescriptions: Record<string, string> = {
  [WECHAT_RED_PACKET_COVER]: '制作微信红包封面，导出 957 × 1278 像素的 JPEG。',
  宣传图: '突出真实产品与信息，制作宣传海报。', 人物图: '根据描述或参考图创作人物画面。', 卡通图: '设计卡通角色、插画与可爱形象。', 试衣图: '以人物和服装参考图制作穿搭效果。', 头像: '制作小尺寸也清晰的个人或品牌头像。', 表情包: '制作表情、动作与文字清楚的表情包。', '透明 PNG': '生成可继续排版使用的透明背景素材。', 壁纸: '打开专用尺寸选择，支持机型与 4K 导出。', 工程P图: '按工程原图精修，保留原尺寸与未修改区域。', 拼豆: '用真实网格、标准色卡和用量清单制作图纸。', 角色图集: '统一角色形象，制作不同表情与姿态。', GIF动画工坊: '先制作可播放样片，再调整动作与批量扩展。',
};
export function availableChatScenarios(workspaceId: string, useTemplates: ImageUseTemplate[] = []): ChatScenario[] {
  const images = availableImageUseTemplates(useTemplates, workspaceId).map(template => ({
    id: template.builtin ? `image-${imageIds[template.id] || template.id}` : `purpose-${template.id}`,
    name: template.name,
    description: template.minReferences > 8 ? `聊天最多8份，进入图片工作台补齐${template.minReferences}份参考图。` : template.builtin ? imageDescriptions[template.id] || '使用已有图片用途和制作参数。' : '使用当前工作区保存的自定义图片用途。',
    group: template.builtin ? 'images' as const : 'custom' as const,
    mode: 'plan' as const,
    outputKind: 'image' as const,
    imagePreset: template.id,
    prompt: template.prompt,
    placeholder: template.minReferences > 8 ? `可先带入最多8份材料，进入图片工作台后补齐${template.minReferences}张参考图…` : template.minReferences ? `先添加至少 ${template.minReferences} 张参考图，再说明这次的具体要求…` : `描述你想制作的${template.name}，也可以添加参考图片…`,
    minAttachments: template.minReferences,
    minImageReferences: template.minReferences,
    ...(specialized.has(template.id) || template.minReferences > 8 ? { entry: 'image-workbench' as const } : {}),
    ...(template.minReferences > 8 ? { requiresWorkbenchReferences: true } : {}),
  }));
  return [...chats, ...images, ...documentScenarios];
}
export function findChatScenario(scenarios: ChatScenario[], id: string | undefined): ChatScenario {
  // Earlier macOS builds stored image:<preset> and format:<kind> IDs.
  const legacy = id?.startsWith('image:') ? scenarios.find(scenario => scenario.imagePreset === id.slice(6)) : id?.startsWith('format:') ? scenarios.find(scenario => scenario.id === `document-${id.slice(7)}`) : undefined;
  return scenarios.find(scenario => scenario.id === id) || legacy || scenarios.find(scenario => scenario.id === 'chat-default') || chats[0];
}
const productionAliases: Record<string, RegExp> = {
  宣传图: /海报|宣传画|\bposter\b/i, 壁纸: /墙纸|\bwallpaper\b/i,
  试衣图: /试衣|虚拟试穿/, '透明 PNG': /透明(?:背景|底)?\s*png/i,
  工程P图: /工程\s*p\s*图/i, 角色图集: /角色(?:动作|表情)图集/,
  GIF动画工坊: /\bgif\b|动图/i,
  'document-ppt': /\b(?:pptx?|powerpoint)\b|幻灯片|演示文稿/i,
  'document-word': /\b(?:word|docx?)\b|文档|说明书/i,
  'document-excel': /\b(?:excel|xlsx?)\b|工作簿|表格/i,
};
export function replyProductionScenario(scenarios: ChatScenario[], turn: ChatTurn, turns: ChatTurn[]) {
  function matches(text: string) {
    const positive = text.normalize('NFKC').toLowerCase().split(/[，,。；;！？!?\n]|而是|改为|改做/)
      .map(part => part.split(/不要|不想|不需要|不做|别做|无需/, 1)[0]).join('\n');
    return scenarios.filter(item => item.mode === 'plan' && (item.imagePreset === WECHAT_RED_PACKET_COVER
      ? !isCoverTopicOnly(turn.userText) && isRedPacketCoverDiscussion(text)
      : positive.includes(item.name.toLowerCase()) || productionAliases[item.imagePreset || item.id]?.test(positive)));
  }
  const requested = matches(turn.userText);
  if (requested.length === 1) return requested[0];
  const described = matches(turn.text.slice(0, 10000));
  const agreed = requested.length ? described.filter(item => requested.includes(item)) : described;
  if (agreed.length === 1) return agreed[0];
  if (requested.length || described.length || !/^(?:好|可以|就|按|改|换|再|继续|用这|颜色|配色|风格)/.test(turn.userText.trim())) return;
  // A follow-up such as “改成橘猫” can refer back, but never look past the clicked reply.
  const index = turns.findIndex(item => item.id === turn.id);
  for (let i = index - 1; i >= Math.max(0, index - 8); i--) {
    const earlier = matches(turns[i].userText);
    if (earlier.length) return earlier.length === 1 ? earlier[0] : undefined;
  }
}
export function filterChatScenarios(scenarios: ChatScenario[], group: 'all' | ChatScenarioGroup, query: string): ChatScenario[] {
  const term = query.trim().toLocaleLowerCase();
  return scenarios.filter(scenario => (group === 'all' || scenario.group === group) && (!term || `${scenario.name} ${scenario.description}`.toLocaleLowerCase().includes(term)));
}
export function chatScenarioInput(scenario: ChatScenario, userText: string): string {
  const text = userText.trim();
  if (!text) return scenario.prompt.trim();
  if (!scenario.prompt || text === scenario.prompt.trim()) return text;
  return `${scenario.prompt.trim()}\n\n本次具体要求：\n${text}`;
}
export function chatScenarioAttachmentIssue(scenario: ChatScenario, attachments: { mimeType: string }[]): string | undefined {
  if (scenario.entry === 'image-workbench' && scenario.requiresWorkbenchReferences) return undefined;
  const images = attachments.filter(file => /^image\/(?:png|jpeg|webp)$/.test(file.mimeType)).length;
  if (images < scenario.minImageReferences) return `“${scenario.name}”需要至少 ${scenario.minImageReferences} 张参考图片，请先添加。`;
  if (attachments.length < scenario.minAttachments) return `“${scenario.name}”需要先添加参考资料。`;
  return undefined;
}
