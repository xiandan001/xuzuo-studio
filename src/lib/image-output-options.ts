import type { ImageOutputOptions, ImageOutputFormat } from '../image-options-types';
export const isImage26 = (id = '') => /^gpt-image-2\.6-(sunburst|flare)$/.test(id);
export const isModernImage = (id = '') => /^gpt-image-2\.[56]-(sunburst|flare)$/.test(id);
export const RASTER_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
export function imageFormatModelDisabled(format: ImageOutputFormat | undefined, modelId: string): boolean {
  return (format === 'svg' || format === 'gif') && !isImage26(modelId);
}
export function imageFormatOptions(modelId: string, capability: string) {
  const special = isImage26(modelId) && capability === 'image-generation';
  const animation = isImage26(modelId) && ['image-generation', 'image-editing'].includes(capability);
  const reason = !isImage26(modelId) ? '仅 GPT Image 2.6 Sunburst／Flare 支持' : '仅文字生成可用，精修及参考图生成不支持';
  return [
    { value: 'png', label: 'PNG 图片', description: '默认，支持透明背景' },
    { value: 'jpeg', label: 'JPEG 图片', description: '文件较小，不支持透明背景' },
    { value: 'webp', label: 'WebP 图片', description: '支持透明背景与压缩' },
    { value: 'svg', label: 'SVG 矢量图 · 仅 2.6', disabled: !special, description: special ? '静态矢量，仅生成；费用含图像及作者模型' : reason },
    { value: 'gif', label: 'GIF 动图 · 仅 2.6', disabled: !animation, description: animation ? '支持文字或静态参考图制作，账户需开通 GIF 预览权限' : !isImage26(modelId) ? reason : '仅图片生成或编辑步骤可用' },
  ];
}
export function effectiveImageOptions(options: ImageOutputOptions = {}, modelId = '', capability = 'image-generation'): ImageOutputOptions {
  const format = options.imageOutputFormat || 'png', result: ImageOutputOptions = {};
  if (options.imageOutputFormat) result.imageOutputFormat = options.imageOutputFormat;
  if (isModernImage(modelId) && options.imageQuality) result.imageQuality = options.imageQuality;
  if (isImage26(modelId) && options.imageComplexity) result.imageComplexity = options.imageComplexity;
  if (format === 'gif') { result.imageFrameCount = options.imageFrameCount ?? 9; result.imageFrameDurationMs = Number.isFinite(options.imageFrameDurationMs) ? Math.round(options.imageFrameDurationMs! / 10) * 10 : options.imageFrameDurationMs ?? 200; }
  if (['jpeg', 'webp'].includes(format) && options.imageCompression !== undefined) result.imageCompression = options.imageCompression;
  if (format === 'svg' && options.imageSvgModel) { result.imageSvgModel = options.imageSvgModel; if (options.imageSvgReasoningEffort) result.imageSvgReasoningEffort = options.imageSvgReasoningEffort; }
  if (capability === 'image-editing' && isModernImage(modelId) && options.imageMarkupId) result.imageMarkupId = options.imageMarkupId;
  return result;
}
export function imageOutputIssue(options: ImageOutputOptions = {}, modelId = '', capability = 'image-generation', background = 'auto'): string | undefined {
  const format = options.imageOutputFormat || 'png';
  if (['svg', 'gif'].includes(format) && !isImage26(modelId)) return 'SVG、GIF 仅支持 GPT Image 2.6 Sunburst／Flare，请选择对应模型或其他输出格式。';
  if (format === 'svg' && capability !== 'image-generation') return 'SVG 仅支持文字生成，精修和带参考图生成请改用 PNG、JPEG、WebP 或 GIF。';
  if (format === 'gif' && !['image-generation', 'image-editing'].includes(capability)) return 'GIF 仅支持图片生成或编辑步骤。';
  if (format === 'gif' && (!Number.isInteger(options.imageFrameCount ?? 9) || options.imageFrameCount! < 2 || options.imageFrameCount! > 16)) return 'GIF 帧数请输入 2–16 的整数。';
  if (format === 'gif' && (!Number.isInteger(options.imageFrameDurationMs ?? 200) || (options.imageFrameDurationMs ?? 200) < 20 || (options.imageFrameDurationMs ?? 200) > 2000)) return '每帧时长请输入 20–2000 毫秒，按10毫秒取整。';
  if (['jpeg', 'webp'].includes(format) && options.imageCompression !== undefined && (!Number.isInteger(options.imageCompression) || options.imageCompression < 0 || options.imageCompression > 100)) return '压缩质量请输入 0–100 的整数，或留空使用默认值。';
  if (format === 'jpeg' && background === 'transparent') return 'JPEG 不支持透明背景，请改用 PNG 或 WebP。';
}
export const imageOutputFields: (keyof ImageOutputOptions)[] = ['imageOutputFormat', 'imageQuality', 'imageComplexity', 'imageFrameCount', 'imageFrameDurationMs', 'imageCompression', 'imageMarkupId', 'imageSvgModel', 'imageSvgReasoningEffort'];
export function pickImageOutputOptions(value?: ImageOutputOptions): ImageOutputOptions { return value ? Object.fromEntries(imageOutputFields.filter(key => value[key] !== undefined).map(key => [key, value[key]])) : {}; }
export function readImageOutputOptions(value: unknown): ImageOutputOptions {
  if (!value || typeof value !== 'object') return {};
  const input = value as ImageOutputOptions, result: ImageOutputOptions = {};
  if (['png', 'jpeg', 'webp', 'svg', 'gif'].includes(input.imageOutputFormat || '')) result.imageOutputFormat = input.imageOutputFormat as ImageOutputFormat;
  if (['auto', 'low', 'medium', 'high', 'xhigh', 'max'].includes(input.imageQuality || '')) result.imageQuality = input.imageQuality;
  if (['low', 'medium', 'high'].includes(input.imageComplexity || '')) result.imageComplexity = input.imageComplexity;
  for (const key of ['imageFrameCount', 'imageFrameDurationMs', 'imageCompression'] as const) if (Number.isFinite(input[key])) result[key] = input[key];
  if (typeof input.imageMarkupId === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(input.imageMarkupId)) result.imageMarkupId = input.imageMarkupId;
  if (typeof input.imageSvgModel === 'string' && /^[A-Za-z0-9._:-]{1,200}$/.test(input.imageSvgModel)) result.imageSvgModel = input.imageSvgModel;
  if (['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(input.imageSvgReasoningEffort || '')) result.imageSvgReasoningEffort = input.imageSvgReasoningEffort;
  return result;
}
