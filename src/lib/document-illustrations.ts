import type { ModelConfiguration, StudioConfiguration, WorkflowStep } from '../configuration-types';
import { creationPrompt } from './creation-quality';
import { studioCredential, studioModel } from './studio-run';

export type DocumentImageMode = 'none' | 'references' | 'generate';
export const DOCUMENT_IMAGE_LIMIT = 20;
export const DOCUMENT_REFERENCE_IMAGE_LIMIT = 12;
export const validDocumentImageCount = (count: number) => Number.isInteger(count) && count >= 1 && count <= DOCUMENT_IMAGE_LIMIT;
export interface DocumentImageOptions { mode: Exclude<DocumentImageMode, 'none'>; modelConfigId?: string; credentialId?: string; count: number; }
export function documentImageModels(configuration: Pick<StudioConfiguration, 'models' | 'connections'>, capability: 'image-generation' | 'image-editing' = 'image-generation'): ModelConfiguration[] {
  return configuration.models.filter(model => model.enabled && !model.demo && model.capabilities.includes(capability) && configuration.connections.some(connection => connection.id === model.connectionId && connection.enabled && !connection.demo));
}
export function illustratedDocumentSteps(first: WorkflowStep, tail: WorkflowStep[], options: DocumentImageOptions, configuration: Pick<StudioConfiguration, 'models' | 'connections' | 'credentials'>, brief: string): WorkflowStep[] {
  if (!['references', 'generate'].includes(options.mode)) throw new Error('请选择有效的配图方式。');
  if (options.mode === 'generate' && !validDocumentImageCount(options.count)) throw new Error(`配图数量请填写 1–${DOCUMENT_IMAGE_LIMIT} 的整数。`);
  const text = { ...first, documentImageSource: options.mode === 'references' ? 'references' as const : 'previous' as const, inputSource: 'project' as const };
  if (options.mode === 'references') return [text, ...tail];
  const model = studioModel(documentImageModels(configuration), options.modelConfigId);
  if (!model) throw new Error('请先选择一个真实图片生成模型。');
  const credentialId = studioCredential(configuration.credentials, model.connectionId, options.credentialId);
  const pictures: WorkflowStep[] = Array.from({ length: options.count }, (_, index) => ({ id: crypto.randomUUID(), name: `制作文档插图 ${index + 1}/${options.count}`, kind: 'image-generation', inputSource: 'project', enabled: true, modelConfigId: model.id, credentialId, count: 1, imageSize: '1024x1024', imageBackground: 'opaque', prompt: creationPrompt('image', `为以下文档需求制作可独立使用的配图素材。本次制作第 ${index + 1} 张，共 ${options.count} 张；按需求中的不同内容角度组织本张画面，与同组插图保持风格统一。只生成插图，不要把整页文档、PPT、表格或正文渲染成图片，不添加文字、图标水印或虚构品牌。配图用于内容说明，保留自然留白。用户未提供真实商品或人物参考时，不假称图片是真实商品实拍或人物照片。\n\n文档需求：${brief}`, 'image-generation') }));
  return [...pictures, { ...text, documentImageStepIds: pictures.map(picture => picture.id) }, ...tail];
}
