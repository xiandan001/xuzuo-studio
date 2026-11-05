export type ImageOutputFormat = 'png' | 'jpeg' | 'webp' | 'svg' | 'gif';
export type ImageQuality = 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type ImageComplexity = 'low' | 'medium' | 'high';
export type SvgReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export interface ImageOutputOptions {
  imageOutputFormat?: ImageOutputFormat;
  imageQuality?: ImageQuality;
  imageComplexity?: ImageComplexity;
  imageFrameCount?: number;
  imageFrameDurationMs?: number;
  imageCompression?: number;
  imageMarkupId?: string;
  imageSvgModel?: string;
  imageSvgReasoningEffort?: SvgReasoningEffort;
}
