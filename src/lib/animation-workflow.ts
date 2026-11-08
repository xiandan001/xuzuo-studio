import type { AnimationDocument, AnimationMode, AnimationMotion, AnimationStyle } from '../animation-types';
import type { StudioConfiguration, WorkflowDraft, WorkflowStep } from '../configuration-types';
import { animationGenerationPrompt, animationSourceBackground, animationStyle, checkedAnimationDocument, newAnimationDocument } from './animation-document';

export interface AnimationWorkflowSettings {
  mode: AnimationMode; style: AnimationStyle; columns: number; rows: number; width: number; height: number; fps: number; loopMs: number; background: 'transparent' | 'opaque';
  entries?: { caption: string; description?: string; motion?: AnimationMotion }[];
}
const fields = ['mode','style','columns','rows','width','height','fps','loopMs','background','entries'];
export function checkedAnimationWorkflowSettings(input: unknown): AnimationWorkflowSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !fields.includes(key))) throw Error('本地动画参数无效，仅支持角色与GIF合成设置。');
  const value = input as Record<string, unknown>, rawEntries = value.entries === undefined ? [{ caption: '你好' }] : value.entries;
  if (!Array.isArray(rawEntries) || !rawEntries.length || rawEntries.length > 16 || rawEntries.some(entry => !entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).some(key => !['caption','description','motion'].includes(key)))) throw Error('单张PNG图集最多16个条目；更多角色请在工坊分组批量制作。');
  const entries = rawEntries.map((entry, index) => ({ id: `entry-${index + 1}`, caption: entry.caption, description: entry.description ?? '', motion: entry.motion ?? 'sway', frames: [], status: 'draft' }));
  const document = checkedAnimationDocument({ ...newAnimationDocument('animation-workflow'), ...value, entries });
  const style = animationStyle(document.style);
  if ((document.mode === 'atlas' || style.route === 'light') && entries.length > document.columns * document.rows || document.mode === 'gif' && style.route !== 'light' && (entries.length !== 1 || document.columns * document.rows < style.framesPerEntry)) throw Error('本地图集格数不足或连续动作混入多个角色条目，请调整来源图集。');
  if (document.mode === 'gif' && style.route !== 'light' && document.loopMs < style.framesPerEntry * 10) throw Error('每个连续动作关键姿态至少需要10毫秒，请增加循环时长。');
  return { mode: document.mode, style: document.style, columns: document.columns, rows: document.rows, width: document.width, height: document.height, fps: document.fps, loopMs: document.loopMs, background: document.background, ...(value.entries !== undefined ? { entries: document.entries.map(entry => ({ caption: entry.caption, description: entry.description, motion: entry.motion })) } : {}) };
}

export function makeAnimationWorkflow(input: AnimationDocument, configuration: Pick<StudioConfiguration, 'models' | 'connections' | 'credentials'>): WorkflowDraft {
  const document = checkedAnimationDocument(input), style = animationStyle(document.style), single = document.mode === 'atlas' || style.route === 'light', grid: [number, number] = single ? [1, 1] : style.grid;
  const sample = checkedAnimationDocument({ ...document, columns: grid[0], rows: grid[1], entries: [document.entries[0]], acceptedSampleId: undefined });
  const kind = document.referenceArtifactIds.length ? 'image-editing' : 'image-generation';
  const models = configuration.models.filter(model => model.enabled && !model.demo && model.capabilities.includes(kind) && configuration.connections.some(connection => connection.id === model.connectionId && connection.enabled && !connection.demo && ['image','openai-chat','openai-responses'].includes(connection.protocol)));
  const model = models.find(row => row.id === document.modelConfigId) || (!document.modelConfigId && models.length === 1 ? models[0] : undefined), keys = configuration.credentials.filter(key => key.enabled && key.connectionId === model?.connectionId), key = keys.find(row => row.id === document.credentialId) || (!document.credentialId && keys.length === 1 ? keys[0] : undefined);
  const source: WorkflowStep = { id: 'animation-source', name: '生成PNG角色样片图集', kind, role: 'producer', prompt: animationGenerationPrompt(sample, sample.entries), modelConfigId: model?.id, credentialId: key?.id, inputSource: 'project', enabled: true, referenceArtifactIds: [...document.referenceArtifactIds], count: 1, imageOutputFormat: 'png', imageBackground: animationSourceBackground(document), imageSize: grid[0] > grid[1] ? '1536x1024' : grid[1] > grid[0] ? '1024x1536' : '1024x1024' };
  const animation = checkedAnimationWorkflowSettings({ mode: document.mode, style: document.style, columns: grid[0], rows: grid[1], width: document.width, height: document.height, fps: document.fps, loopMs: document.loopMs, background: document.background, entries: sample.entries.map(entry => ({ caption: entry.caption, description: entry.description, motion: entry.motion })) });
  return { name: `${document.title} · ${document.mode === 'atlas' ? '图集' : 'GIF'}样片`, description: '生成一个角色样片，随后在本地分帧与合成，人工检查后再在工坊扩展批量。图片步骤按真实调用计费；本地合成不调用模型。', outputKind: 'image', steps: [source, { id: 'animation-compose', name: document.mode === 'atlas' ? '本地拆分角色PNG' : '本地合成GIF动画', kind: 'animation-compose', role: 'producer', prompt: '', inputSource: 'previous', imageSourceStepId: source.id, referenceArtifactIds: [], animation, enabled: true }, { id: 'animation-review', name: '播放并检查实际样片', kind: 'manual-review', prompt: '', inputSource: 'previous', enabled: true }] };
}

export function defaultAnimationWorkflowSettings(): AnimationWorkflowSettings {
  const document = newAnimationDocument('animation-workflow');
  return checkedAnimationWorkflowSettings({ mode: document.mode, style: document.style, columns: document.columns, rows: document.rows, width: document.width, height: document.height, fps: document.fps, loopMs: document.loopMs, background: document.background });
}

export function animationRequestMode(input: string): AnimationMode | undefined {
  const negativeGif = /(?:不需要|不用|不制作|不生成|不要|不做|无需|不是)[^，,。；;\n]{0,5}(?:GIF|动图|动画)/i.test(input), negativeAtlas = /(?:不需要|不用|不制作|不生成|不要|不做|无需|不是)[^，,。；;\n]{0,5}(?:角色图集|精灵图)/i.test(input);
  if (!negativeGif && /\bGIF\b|动图|动态(?:表情包|贴纸|(?:宣传|活动|品牌)?海报)|表情包动画|电子光栅|双状态(?:光栅|变画)|(?:制作|生成|让).{0,16}(?:动起来|循环动画)/i.test(input)) return 'gif';
  if (!negativeAtlas && /角色图集|姿态图集|精灵图|sprite\s*(?:sheet|atlas)/i.test(input)) return 'atlas';
  return undefined;
}
export function animationStyleForRequest(input: string): AnimationStyle {
  if (/光栅|变画|双状态/i.test(input)) return 'lenticular';
  if (/人物与字体|字体联动|文字.*动|字.*一起动/i.test(input)) return 'type-linked';
  if (/漫画印刷|整体融合|限定色|网点/i.test(input)) return 'comic-fusion';
  if (/动态.{0,6}海报/i.test(input)) return 'type-linked';
  if (/粘土|黏土/i.test(input)) return 'clay-mascot';
  if (/像素/i.test(input)) return /完整|连续|展开|关键帧/.test(input) ? 'pixel-actions' : 'pixel-light';
  if (/真人|照片人物|人像/i.test(input)) return 'photo-people';
  if (/宠物|猫咪|小狗|柯基/i.test(input)) return 'photo-pets';
  return 'illustrated-actions';
}
