export interface ImageDimensions { width: number; height: number; }
export type DocumentImageSize = 'auto' | '1024x1024' | '1536x1024' | '1024x1536';
export const DOCUMENT_IMAGE_SIZES = [
  { value: 'auto', label: '跟随原图比例（推荐）' },
  { value: '1024x1024', label: '正方形 · 1024 × 1024' },
  { value: '1536x1024', label: '横向 · 1536 × 1024' },
  { value: '1024x1536', label: '纵向 · 1024 × 1536' },
];
export function documentImageSizePrompt(size: string, original?: ImageDimensions): string {
  if (size !== 'auto') return `输出尺寸为 ${size}。保持主体完整，避免拉伸；比例不同时扩展留白而不是裁去主体。`;
  return original ? `保留原图 ${original.width}×${original.height} 的宽高比例、完整主体与裁切范围，不改成正方形。` : '保留参考原图的宽高比例、完整主体与裁切范围，不擅自改成正方形。';
}
