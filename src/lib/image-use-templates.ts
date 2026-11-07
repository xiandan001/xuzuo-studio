import type { ImageUseTemplate, ImageUseTemplateDraft } from '../configuration-types';
import { ENGINEERING_IMAGE_PROMPT } from './engineering-image';
import { BEAD_PREPARATION_PROMPT } from './bead-image';

export const IMAGE_PRESETS = ['宣传图', '人物图', '卡通图', '试衣图', '头像', '表情包', '透明 PNG', '壁纸', '工程P图', '拼豆'] as const;
export type BuiltinImagePreset = typeof IMAGE_PRESETS[number];
export const IMAGE_SIZES = [
  { value: 'auto', label: '自动 · 由模型选择', description: 'GIF 使用自动帧尺寸' },
  { value: '1024x1024', label: '正方形 · 1:1', description: '1024 × 1024' },
  { value: '1536x1024', label: '横向 · 3:2', description: '1536 × 1024' },
  { value: '1024x1536', label: '竖向 · 2:3', description: '1024 × 1536' },
];
export const PRESET_PROMPTS: Record<BuiltinImagePreset, string> = {
  宣传图: '为我的产品制作一张宣传图。突出产品主体，构图清晰、留白充足。产品信息、文字和风格以我补充的内容为准。',
  人物图: '创作自然的人物半身图，光线柔和、背景简洁。人物外貌、服装与画面风格由我补充；有参考图时保留指定人物特征。',
  卡通图: '创作一个表情自然、轮廓清楚的卡通角色。请按我补充的主体、配色和风格制作。',
  试衣图: '使用人物与服装两张参考图，保留人物特征和姿态，展示参考服装的视觉穿搭效果，保持衣服细节与背景自然。',
  头像: '制作一张适合作为头像的图片。主体居中、背景简洁，缩小后仍清晰；主体与风格按我补充的内容制作。',
  表情包: '制作一张主体清楚、表情鲜明的表情包。保留指定角色特征；文字、动作和背景按我补充的内容制作。',
  '透明 PNG': '制作一张背景透明的独立图片素材。主体、风格和用途按我补充的内容制作，主体完整，边缘干净。',
  壁纸: '制作适合作为设备壁纸的完整画面。主体完整，构图协调，为时钟区域适当留白；不要绘制手机边框、时间、应用图标或系统界面。主题、色彩与风格按我补充的内容制作。',
  工程P图: ENGINEERING_IMAGE_PROMPT,
  拼豆: BEAD_PREPARATION_PROMPT,
};
// Existing names remain fixed built-in IDs so old project drafts and prompts still resolve.
export const BUILTIN_IMAGE_USE_TEMPLATES: ImageUseTemplate[] = IMAGE_PRESETS.map(name => ({ id: name, workspaceId: '', name, prompt: PRESET_PROMPTS[name], size: name === '壁纸' ? '1024x1536' : name === '工程P图' || name === '拼豆' ? 'auto' : '1024x1024', background: name === '透明 PNG' ? 'transparent' : name === '壁纸' ? 'opaque' : 'auto', minReferences: name === '试衣图' ? 2 : name === '工程P图' || name === '拼豆' ? 1 : 0, enabled: true, builtin: true }));
export type ImageUseTemplateSnapshot = Pick<ImageUseTemplate, 'id' | 'name' | 'prompt' | 'size' | 'background' | 'minReferences'>;

export function imageUseTemplateSnapshot(template: ImageUseTemplateSnapshot): ImageUseTemplateSnapshot {
  return { id: template.id, name: template.name, prompt: template.prompt, size: template.size, background: template.background, minReferences: template.minReferences };
}
export function availableImageUseTemplates(custom: ImageUseTemplate[] = [], workspaceId?: string, includeDisabled = false): ImageUseTemplate[] {
  return [...BUILTIN_IMAGE_USE_TEMPLATES, ...custom.filter(item => !item.builtin && (workspaceId === undefined || item.workspaceId === workspaceId) && (includeDisabled || item.enabled))];
}
export function useTemplateDraftError(draft: ImageUseTemplateDraft): string {
  if (typeof draft.name !== 'string' || !draft.name.trim() || draft.name.trim().length > 30) return '用途名称需要填写，最多 30 个字。';
  if (typeof draft.prompt !== 'string' || !draft.prompt.trim() || draft.prompt.length > 10000) return '请填写默认描述，最多 10000 个字。';
  if (!IMAGE_SIZES.some(item => item.value === draft.size)) return '请选择有效的图片尺寸。';
  if (!['auto', 'opaque', 'transparent'].includes(draft.background)) return '请选择有效的背景设置。';
  if (!Number.isInteger(draft.minReferences) || draft.minReferences < 0 || draft.minReferences > 12) return '最少参考图数量应为 0 到 12 的整数。';
  if (typeof draft.enabled !== 'boolean') return '用途启用状态无效。';
  return '';
}
export function useTemplateError(templates: ImageUseTemplate[], workspaceId: string, draft: ImageUseTemplateDraft, id?: string): string {
  const error = useTemplateDraftError(draft);
  if (error) return error;
  const local = templates.filter(item => item.workspaceId === workspaceId && !item.builtin);
  if (id && !local.some(item => item.id === id)) return '用途模板不属于当前工作区，内置用途请另存副本。';
  if (availableImageUseTemplates(local, workspaceId, true).some(item => item.id !== id && item.name.toLocaleLowerCase() === draft.name.trim().toLocaleLowerCase())) return '当前工作区已有这个用途名称，请换一个名称。';
  return '';
}
export function readImageUseTemplates(value: unknown): ImageUseTemplate[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.flatMap((item: Partial<ImageUseTemplate>) => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(item.id) || ids.has(item.id) || typeof item.workspaceId !== 'string' || !item.workspaceId || item.workspaceId.length > 160 || useTemplateDraftError(item as ImageUseTemplateDraft)) return [];
    ids.add(item.id);
    return [{ id: item.id, workspaceId: item.workspaceId, name: item.name!.trim(), prompt: item.prompt!, size: item.size!, background: item.background!, minReferences: item.minReferences!, enabled: item.enabled! }];
  });
}
