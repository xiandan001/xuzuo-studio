import { wallpaperGenerationSize } from './wallpaper-target';

export const WECHAT_RED_PACKET_COVER = '微信红包封面';
export const WECHAT_RED_PACKET_COVER_WIDTH = 957;
export const WECHAT_RED_PACKET_COVER_HEIGHT = 1278;
const target = { width: WECHAT_RED_PACKET_COVER_WIDTH, height: WECHAT_RED_PACKET_COVER_HEIGHT, fit: 'cover' } as const;

export function redPacketCoverGenerationSize(modelId?: string) {
  if (modelId === 'dall-e-3') return '1024x1792';
  return wallpaperGenerationSize(target, modelId);
}

export function redPacketCoverPrompt(description: string) {
  return [
    '【微信红包封面构图】',
    '生成单张接近 3:4 的竖向原创封面画面，画面延伸到边缘，保留居中裁切余量。关键主体和脸部集中在中部安全区域，顶部适当留白，底部避免放置重要细节。',
    '只制作可上传的独立画面，不绘制微信界面、头像、昵称、红包外框、按钮、金额、品牌标志、水印或样机。只有用户明确给出要绘制的文字时，才照原文排入画面。',
    '如提供参考图，保留指定人物、宠物或角色的可辨识特征，按本次要求调整风格与构图。',
    '',
    '【用户本次要求】',
    description.trim(),
  ].join('\n');
}
