import type { BatchCreate, BatchItem } from '../batch-types';
import type { ModelConfiguration } from '../configuration-types';
import type { PageProps, Project } from '../types';
import { creationPrompt } from './creation-quality';
import { effectiveImageOptions, imageOutputIssue } from './image-output-options';
import type { ImageOutputOptions } from '../image-options-types';
import type { WallpaperTarget } from '../wallpaper-types';
import { readWallpaperTarget, wallpaperGenerationSize, wallpaperPrompt, wallpaperTargetIssue } from './wallpaper-target';

export const IMAGE_GROUP_LIMIT = 500, IMAGE_GROUP_IMAGE_LIMIT = 20, IMAGE_GROUP_TOTAL_LIMIT = 500, IMAGE_GROUP_PAGE_SIZE = 20;
export interface ImageGroupRow { id: string; name: string; brief: string; count: string; }
export interface ImageGroupDraft { version: 1; name: string; groups: ImageGroupRow[]; revision: number; submitted?: { batchId: string; revision: number; settings: string }; }
export interface ImageGroupSettings { model?: ModelConfiguration; credentialId?: string; size: string; background: 'auto' | 'opaque' | 'transparent'; imageOptions?: ImageOutputOptions; wallpaperEnabled?: boolean; wallpaperTarget?: WallpaperTarget; }
export const imageGroupDraftKey = (workspaceId: string, projectId: string) => `xuzuo-image-group-draft-v1:${workspaceId}/${projectId}`;
export function imageGroupOutputSettings(settings: ImageGroupSettings, modelId = settings.model?.modelId || '') {
  const wallpaperTarget = settings.wallpaperEnabled ? readWallpaperTarget(settings.wallpaperTarget) : undefined;
  const raw: ImageOutputOptions = settings.wallpaperEnabled ? { imageOutputFormat: 'png', imageQuality: settings.imageOptions?.imageQuality, imageComplexity: settings.imageOptions?.imageComplexity } : settings.imageOptions || {};
  const imageOptions = effectiveImageOptions(raw, modelId, 'image-generation'), gif = imageOptions.imageOutputFormat === 'gif';
  return { imageOptions, ...(wallpaperTarget ? { wallpaperTarget } : {}), size: wallpaperTarget ? wallpaperGenerationSize(wallpaperTarget, modelId) : gif ? 'auto' : settings.size, background: settings.wallpaperEnabled ? 'opaque' as const : gif ? 'auto' as const : settings.background };
}
export function imageGroupSettingsKey(settings: ImageGroupSettings): string {
  const common = imageGroupOutputSettings(settings), options = { ...common.imageOptions };
  if (options.imageOutputFormat === 'png') delete options.imageOutputFormat;
  if (options.imageQuality === 'auto') delete options.imageQuality;
  if (options.imageComplexity === 'high') delete options.imageComplexity;
  const legacy = [settings.model?.id, settings.credentialId, common.size, common.background].join('|');
  const key = Object.keys(options).length ? legacy + '|' + JSON.stringify(options) : legacy;
  return settings.wallpaperEnabled ? key + '|wallpaper:' + JSON.stringify(common.wallpaperTarget || null) : key;
}
export function imageGroupOutputIssue(settings: ImageGroupSettings, modelId = settings.model?.modelId || ''): string | undefined {
  if (settings.wallpaperEnabled) { const issue = wallpaperTargetIssue(settings.wallpaperTarget); if (issue) return issue; }
  const common = imageGroupOutputSettings(settings, modelId);
  return imageOutputIssue(common.imageOptions, modelId, 'image-generation', common.background);
}
export const newImageGroup = (index: number): ImageGroupRow => ({ id: crypto.randomUUID(), name: `第${index + 1}组`, brief: '', count: '1' });
export function initialImageGroupDraft(project: Project): ImageGroupDraft { return { version: 1, name: project.name.slice(0, 90) + ' · 分组图片', groups: [newImageGroup(0), newImageGroup(1)], revision: 0 }; }
export function readImageGroupDraft(raw: string | null, fallback: ImageGroupDraft): ImageGroupDraft {
  if (!raw) return fallback;
  const value = JSON.parse(raw) as ImageGroupDraft;
  if (value.version !== 1 || typeof value.name !== 'string' || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.groups) || value.groups.length > IMAGE_GROUP_LIMIT || value.groups.some(row => !row || typeof row.id !== 'string' || typeof row.name !== 'string' || typeof row.brief !== 'string' || typeof row.count !== 'string') || new Set(value.groups.map(row => row.id)).size !== value.groups.length) throw Error('分组草稿暂时无法读取，原记录保留。');
  return value;
}
export function imageGroupRowIssue(row: ImageGroupRow): string {
  if (row.name.length > 100) return '组名最多100字。';
  if (!row.brief.trim() || row.brief.length > 10000) return '请填写1–10000字的独立描述。';
  const count = Number(row.count); return !row.count.trim() || !Number.isInteger(count) || count < 1 || count > IMAGE_GROUP_IMAGE_LIMIT ? '每组数量请填1–20的整数。' : '';
}
export const imageGroupImages = (item: BatchItem) => [...new Map(item.artifacts.filter(file => file.kind === 'image' && !file.trashedAt).map(file => [file.id, file])).values()];
export function createImageGroupBatch(draft: ImageGroupDraft, settings: ImageGroupSettings, props: Pick<PageProps, 'workspaceId' | 'configuration'>): BatchCreate {
  if (!draft.name.trim() || draft.name.length > 100 || !draft.groups.length || draft.groups.length > IMAGE_GROUP_LIMIT) throw Error('请填写批次名称和1–500组图片。');
  for (const [index, row] of draft.groups.entries()) { const issue = imageGroupRowIssue(row); if (issue) throw Error(`第${index + 1}组：${issue}`); }
  const counts = draft.groups.map(row => Number(row.count)); if (counts.reduce((sum, count) => sum + count, 0) > IMAGE_GROUP_TOTAL_LIMIT) throw Error('本批总计最多500张图片。');
  const model = props.configuration.models.find(item => item.id === settings.model?.id && item.enabled && !item.demo && item.capabilities.includes('image-generation'));
  const credential = props.configuration.credentials.find(item => item.id === settings.credentialId && item.enabled && item.connectionId === model?.connectionId);
  if (!model || !credential || !props.configuration.connections.some(item => item.id === model.connectionId && item.enabled && !item.demo)) throw Error('请先选择本次图片生成模型和该连接下启用的Key。');
  const common = imageGroupOutputSettings(settings, model.modelId), outputIssue = imageGroupOutputIssue(settings, model.modelId);
  if (outputIssue) throw Error(outputIssue);
  const template: Project = { id: 'group-template-' + crypto.randomUUID(), workspaceId: props.workspaceId, name: draft.name.trim(), kind: 'image', description: '', status: 'draft', version: 0, costCents: 0, updatedAt: '', accent: 'blue' };
  const first = { id: 'group-picture', name: common.wallpaperTarget ? '生成壁纸原图' : '生成独立图片', kind: 'image-generation' as const, inputSource: 'project' as const, enabled: true, modelConfigId: model.id, credentialId: credential.id, count: 1, imageSize: common.size, imageBackground: common.background, ...common.imageOptions, prompt: creationPrompt('image', common.wallpaperTarget ? `${wallpaperPrompt(common.wallpaperTarget)}\n\n【本组要求】\n{{需求}}` : '{{需求}}', 'image-generation', { imageSize: common.size, imageBackground: common.background, hasReferences: false }) };
  return { name: draft.name.trim(), imageGroupCounts: counts, projectNameTemplate: '{{组名}}', rows: draft.groups.map((row, index) => ({ 组名: row.name.trim() || `第${index + 1}组`, 需求: row.brief.trim() })), request: { project: template, workflow: { id: 'image-group-template-' + crypto.randomUUID(), workspaceId: props.workspaceId, name: common.wallpaperTarget ? '独立分组壁纸' : '独立分组图片', outputKind: 'image', description: '每组独立描述，逐张生成，完成后检查实际图片。', updatedAt: new Date().toISOString(), steps: [first, { id: 'group-export', kind: 'export', name: common.wallpaperTarget ? '适配设备壁纸' : '生成实际交付文件', prompt: '', inputSource: 'previous', enabled: true, ...(common.wallpaperTarget ? { wallpaperTarget: common.wallpaperTarget, contentSourceStepIds: [first.id] } : {}) }] }, models: props.configuration.models, connections: props.configuration.connections, input: '{{需求}}', variables: {}, attachmentIds: [], acknowledgePaidCalls: true, acknowledgeUnknownCost: true } };
}
