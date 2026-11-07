import type { WorkflowRun } from '../configuration-types';
import { isProductionRun } from './workflow-purpose';
import type { ArtifactMetadata, GeneratedAnimationReference } from '../live-types';
import { validImageQuantity } from './image-quantity';
import { effectiveImageOptions, readImageOutputOptions } from './image-output-options';
import type { ImageOutputOptions } from '../image-options-types';
import { BUILTIN_IMAGE_USE_TEMPLATES, IMAGE_PRESETS, IMAGE_SIZES, imageUseTemplateSnapshot, useTemplateDraftError } from './image-use-templates';
import type { ImageUseTemplateSnapshot } from './image-use-templates';
import type { WallpaperTarget } from '../wallpaper-types';
import { readWallpaperTarget, wallpaperGenerationSize, wallpaperPrompt } from './wallpaper-target';
import { engineeringImagePrompt } from './engineering-image';
export { IMAGE_PRESETS, IMAGE_SIZES, PRESET_PROMPTS } from './image-use-templates';

export type ImageMode = 'create' | 'refine';
export type ImageBackground = 'auto' | 'opaque' | 'transparent';
export const MAX_IMAGE_REFERENCES = 12;
export function imageCreationDescription(prompt: string): string {
  const markers = ['\n\n【用户本次要求】\n', '\n\n【本次用户编辑要求】\n'];
  const marker = markers.reduce((latest, candidate) => prompt.lastIndexOf(candidate) > prompt.lastIndexOf(latest) ? candidate : latest), position = prompt.lastIndexOf(marker);
  return (position >= 0 ? prompt.slice(position + marker.length) : prompt.split('\n\n【成品与交付要求】')[0]).trim();
}
export interface ImageReference { id: string; name: string; }
export interface AnimationReferenceBinding { sourceArtifactId: string; sourceSha256: string; referenceId: string; prompt: string; }
interface ImageReferenceDraft { references: ImageReference[]; galleryBaseId?: string; animationReference?: AnimationReferenceBinding; }
export interface ImageDraft {
  preset: string;
  presetSnapshot?: ImageUseTemplateSnapshot;
  prompt: string;
  refinePrompt: string;
  mode: ImageMode;
  size: string;
  quantity: number;
  background: ImageBackground;
  generationModelId: string;
  editingModelId: string;
  references: ImageReference[];
  referenceDrafts?: Partial<Record<ImageMode, ImageReferenceDraft>>;
  animationReference?: AnimationReferenceBinding;
  galleryBaseId?: string;
  imageOptions?: ImageOutputOptions;
  markupSourceId?: string;
  wallpaperEnabled?: boolean;
  wallpaperTarget?: WallpaperTarget;
}

export const imageDraftKey = (projectId: string) => `xuzuo-image-draft-v1-${projectId}`;

function readReferences(value: unknown): ImageReference[] {
  return Array.isArray(value) ? value.filter((item): item is ImageReference => Boolean(item && typeof item.id === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(item.id) && typeof item.name === 'string' && item.name.length <= 200)).slice(0, MAX_IMAGE_REFERENCES).map(({ id, name }) => ({ id, name })) : [];
}
function readReferenceDraft(value: ImageReferenceDraft | undefined): ImageReferenceDraft {
  const references = readReferences(value?.references);
  const animationReference = readAnimationReference(value?.animationReference, references);
  return { references, ...(animationReference ? { animationReference } : {}), ...(typeof value?.galleryBaseId === 'string' && references.length > 0 && references[0].id === value.galleryBaseId ? { galleryBaseId: value.galleryBaseId } : {}) };
}
function readAnimationReference(value: AnimationReferenceBinding | undefined, references: ImageReference[]): AnimationReferenceBinding | undefined {
  if (!value || !/^[A-Za-z0-9-]{1,100}$/.test(value.sourceArtifactId || '') || !/^[a-f0-9]{64}$/.test(value.sourceSha256 || '') || references[0]?.id !== value.referenceId || typeof value.prompt !== 'string' || value.prompt.length > 200000) return;
  return { sourceArtifactId: value.sourceArtifactId, sourceSha256: value.sourceSha256, referenceId: value.referenceId, prompt: value.prompt };
}
export function readImageDraft(raw: string | null, description: string): ImageDraft {
  const defaults: ImageDraft = { preset: '宣传图', prompt: description, refinePrompt: '保留主体与整体构图，按我的要求调整细节。', mode: 'create', size: '1024x1024', quantity: 1, background: 'auto', generationModelId: '', editingModelId: '', references: [] };
  if (!raw) return defaults;
  try {
    const value = JSON.parse(raw) as Partial<ImageDraft>;
    const text = (input: unknown, fallback: string, maximum = 200000) => typeof input === 'string' && input.length <= maximum ? input : fallback;
    const references = readReferences(value.references);
    return {
      preset: typeof value.preset === 'string' && ((IMAGE_PRESETS as readonly string[]).includes(value.preset) || /^[A-Za-z0-9-]{1,100}$/.test(value.preset)) ? value.preset : defaults.preset,
      ...(value.presetSnapshot && value.presetSnapshot.id === value.preset && !useTemplateDraftError({ ...value.presetSnapshot, enabled: true }) ? { presetSnapshot: imageUseTemplateSnapshot(value.presetSnapshot) } : {}),
      prompt: text(value.prompt, description), refinePrompt: text(value.refinePrompt, defaults.refinePrompt),
      mode: value.mode === 'refine' ? 'refine' : 'create',
      size: IMAGE_SIZES.some(item => item.value === value.size) ? value.size! : defaults.size,
      quantity: validImageQuantity(value.quantity) ? value.quantity : 1,
      background: ['auto', 'opaque', 'transparent'].includes(value.background!) ? value.background! : 'auto',
      generationModelId: text(value.generationModelId, '', 240), editingModelId: text(value.editingModelId, '', 240),
      references,
      ...(readAnimationReference(value.animationReference, references) ? { animationReference: readAnimationReference(value.animationReference, references) } : {}),
      ...(value.referenceDrafts ? { referenceDrafts: { create: { references: readReferences(value.referenceDrafts.create?.references) }, refine: readReferenceDraft(value.referenceDrafts.refine) } } : {}),
      ...(value.imageOptions ? { imageOptions: readImageOutputOptions(value.imageOptions) } : {}),
      ...(typeof value.wallpaperEnabled === 'boolean' ? { wallpaperEnabled: value.wallpaperEnabled } : value.preset === '壁纸' ? { wallpaperEnabled: true } : {}),
      ...(readWallpaperTarget(value.wallpaperTarget) ? { wallpaperTarget: readWallpaperTarget(value.wallpaperTarget) } : {}),
      ...(typeof value.markupSourceId === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value.markupSourceId) ? { markupSourceId: value.markupSourceId } : {}),
      ...(typeof value.galleryBaseId === 'string' && references.length > 0 && references[0].id === value.galleryBaseId ? { galleryBaseId: value.galleryBaseId } : {}),
    };
  } catch { return defaults; }
}

export function isGalleryImageBase(draft: ImageDraft): boolean { return draft.mode === 'refine' && draft.references.length > 0 && draft.galleryBaseId === draft.references[0].id; }
export function followGalleryImage(draft: ImageDraft, image: ImageReference): ImageDraft {
  if (!isGalleryImageBase(draft) || draft.galleryBaseId === image.id) return draft;
  const extra = [...new Map(draft.references.slice(1).filter(reference => reference.id !== image.id).map(reference => [reference.id, reference])).values()];
  return updateImageDraft(draft, { references: [{ id: image.id, name: image.name }, ...extra], galleryBaseId: image.id });
}
export function updateImageDraft(draft: ImageDraft, changes: Partial<ImageDraft>): ImageDraft {
  const mode = changes.mode ?? draft.mode;
  const previous = { references: draft.references, ...(draft.mode === 'refine' && draft.galleryBaseId ? { galleryBaseId: draft.galleryBaseId } : {}), ...(draft.mode === 'refine' && draft.animationReference ? { animationReference: draft.animationReference } : {}) };
  const referenceDrafts = { ...draft.referenceDrafts, [draft.mode]: previous };
  const target: ImageReferenceDraft = mode === draft.mode ? previous : referenceDrafts[mode] || { references: [] };
  const references = 'references' in changes ? changes.references || [] : target.references;
  let galleryBaseId = target.galleryBaseId;
  if (mode === 'create') galleryBaseId = undefined;
  else if (Object.hasOwn(changes, 'galleryBaseId')) galleryBaseId = changes.galleryBaseId;
  else if ('references' in changes && references[0]?.id !== galleryBaseId) galleryBaseId = undefined;
  let animationReference = mode === 'refine' ? target.animationReference : undefined;
  if (Object.hasOwn(changes, 'animationReference')) animationReference = changes.animationReference;
  if (animationReference && (references[0]?.id !== animationReference.referenceId || galleryBaseId)) animationReference = undefined;
  return { ...draft, ...changes, mode, references, galleryBaseId, animationReference, referenceDrafts: { ...referenceDrafts, [mode]: { references, ...(galleryBaseId ? { galleryBaseId } : {}), ...(animationReference ? { animationReference } : {}) } } };
}
export function withAnimationReference(draft: ImageDraft, prepared: GeneratedAnimationReference): ImageDraft {
  if (!prepared.reference) throw Error('动画修改参考尚未保存。');
  const extra = draft.mode === 'refine' && draft.animationReference ? draft.references.slice(1) : [];
  const sameReference = draft.animationReference?.referenceId === prepared.reference.id && draft.markupSourceId === prepared.reference.id;
  const imageOptions: ImageOutputOptions = { ...prepared.imageOptions, ...draft.imageOptions, imageOutputFormat: 'gif', imageCompression: undefined, imageMarkupId: sameReference ? draft.imageOptions?.imageMarkupId : undefined, imageSvgModel: undefined, imageSvgReasoningEffort: undefined };
  if (draft.imageOptions?.imageOutputFormat !== 'gif') { imageOptions.imageFrameCount = prepared.imageOptions.imageFrameCount; imageOptions.imageFrameDurationMs = prepared.imageOptions.imageFrameDurationMs; }
  return updateImageDraft(draft, { mode: 'refine', references: [{ id: prepared.reference.id, name: prepared.reference.name }, ...extra.filter(item => item.id !== prepared.reference!.id)], galleryBaseId: undefined, animationReference: { sourceArtifactId: prepared.sourceArtifactId, sourceSha256: prepared.sourceSha256, referenceId: prepared.reference.id, prompt: prepared.prompt }, imageOptions });
}
export function importImageReferences(draft: ImageDraft, added: ImageReference[], selectedImage?: ImageReference): ImageDraft {
  const base = draft.mode === 'refine' ? draft.references.length ? draft.references : selectedImage ? [selectedImage] : [] : [];
  const references = [...new Map([...base, ...added].map(reference => [reference.id, reference])).values()];
  if (references.length > MAX_IMAGE_REFERENCES) throw new Error(`原图与参考图合计最多 ${MAX_IMAGE_REFERENCES} 张，请先移除不需要的参考图。`);
  const galleryBaseId = draft.mode === 'refine' ? isGalleryImageBase(draft) ? draft.galleryBaseId : !draft.references.length ? selectedImage?.id : undefined : undefined;
  return updateImageDraft(draft, { references, galleryBaseId });
}

export function imageArtifactTarget(runs: WorkflowRun[], projectId: string, artifact: ArtifactMetadata | undefined): { size?: string; background?: ImageBackground; wallpaperTarget?: WallpaperTarget; engineeringReferenceId?: string } {
  if (!artifact || artifact.projectId && artifact.projectId !== projectId) return {};
  const recent = runs.filter(run => run.projectId === projectId && run.mode === 'live').slice().sort((a, b) => Number(b.id === artifact.runId) - Number(a.id === artifact.runId) || (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
  for (const run of recent) for (const attempt of run.attempts) {
    if (attempt.status !== 'complete' || !attempt.artifacts?.some(item => item.id === artifact.id)) continue;
    const owner = run.snapshot.steps.find(item => item.id === attempt.stepId);
    if (owner?.kind === 'export' && owner.engineeringReferenceId && attempt.engineeringSource?.referenceId === owner.engineeringReferenceId && artifact.mimeType === 'image/png') {
      const source = attempt.engineeringSource;
      if (Number.isInteger(source.width) && Number.isInteger(source.height) && source.width >= 64 && source.height >= 64 && source.width <= 8192 && source.height <= 8192 && source.width * source.height <= 16000000) return { engineeringReferenceId: source.referenceId, size: `${source.width}x${source.height}`, background: 'auto' };
    }
    const wallpaperTarget = owner?.kind === 'export' ? readWallpaperTarget(owner.wallpaperTarget) : undefined;
    if (wallpaperTarget && artifact.mimeType === 'image/png') return { wallpaperTarget, size: `${wallpaperTarget.width}x${wallpaperTarget.height}`, background: 'opaque' };
    const step = owner && ['image-generation', 'image-editing'].includes(owner.kind) ? owner : undefined;
    if (step) return { ...(typeof step.imageSize === 'string' && /^(?:auto|\d{2,5}x\d{2,5})$/.test(step.imageSize) ? { size: step.imageSize } : {}), ...(['auto', 'opaque', 'transparent'].includes(step.imageBackground || '') ? { background: step.imageBackground as ImageBackground } : {}) };
  }
  return {};
}

export function imageReferenceIds(mode: ImageMode, references: ImageReference[], selectedImageId?: string): string[] {
  if (references.length) return references.map(item => item.id);
  return mode === 'refine' && selectedImageId ? [selectedImageId] : [];
}

export const imageCapability = (mode: ImageMode, referenceIds: string[]) => mode === 'refine' || referenceIds.length ? 'image-editing' as const : 'image-generation' as const;

export function selectImageUseTemplate(draft: ImageDraft, template: ImageUseTemplateSnapshot): ImageDraft {
  const wallpaper = template.id === '壁纸', engineering = template.id === '工程P图';
  return { ...draft, preset: template.id, presetSnapshot: imageUseTemplateSnapshot(template), size: template.size, background: template.background, ...((wallpaper || draft.wallpaperEnabled !== undefined) ? { wallpaperEnabled: wallpaper } : {}), ...(engineering ? { galleryBaseId: undefined } : {}), ...((wallpaper || engineering) ? { imageOptions: { imageOutputFormat: 'png' as const, imageQuality: draft.imageOptions?.imageQuality || 'high' as const }, animationReference: undefined } : {}) };
}
export function imageDraftPurpose(draft: ImageDraft): ImageUseTemplateSnapshot | undefined {
  return BUILTIN_IMAGE_USE_TEMPLATES.find(item => item.id === draft.preset) || draft.presetSnapshot;
}
export function imageMissingReferences(draft: ImageDraft, selectedImageId?: string): number {
  if (!draft.wallpaperEnabled && draft.preset === '工程P图') return Math.max(0, 1 - draft.references.length);
  const minimum = draft.mode === 'refine' ? 1 : imageDraftPurpose(draft)?.minReferences || 0;
  return Math.max(0, minimum - imageReferenceIds(draft.mode, draft.references, selectedImageId).length);
}

export function imageTaskRequest(draft: ImageDraft, selectedImageId?: string, modelId?: string) {
  const target = draft.wallpaperEnabled ? readWallpaperTarget(draft.wallpaperTarget) : undefined;
  const engineering = !draft.wallpaperEnabled && draft.preset === '工程P图';
  const animation = draft.mode === 'refine' && !draft.wallpaperEnabled && !engineering ? draft.animationReference : undefined;
  const matchesAnimation = animation && animation.sourceArtifactId === selectedImageId && animation.referenceId === draft.references[0]?.id;
  const attachmentIds = engineering ? draft.references.map(reference => reference.id) : animation && !matchesAnimation ? [] : imageReferenceIds(draft.mode, draft.references, selectedImageId);
  const capability = engineering ? 'image-editing' as const : imageCapability(draft.mode, attachmentIds);
  const inputPrompt = draft.mode === 'refine' ? matchesAnimation ? `【原动画描述，仅供延续参考】\n${animation.prompt}\n\n【本次修改，优先执行】\n${draft.refinePrompt}` : draft.refinePrompt : draft.prompt;
  const prompt = engineering && inputPrompt.trim() ? engineeringImagePrompt(inputPrompt) : target ? `【壁纸目标】\n${wallpaperPrompt(target)}\n\n【用户本次要求】\n${inputPrompt}` : inputPrompt;
  const options: ImageOutputOptions = draft.wallpaperEnabled || engineering ? { imageOutputFormat: 'png', imageQuality: draft.imageOptions?.imageQuality, imageComplexity: draft.imageOptions?.imageComplexity, imageMarkupId: draft.imageOptions?.imageMarkupId } : draft.imageOptions || {};
  return {
    count: draft.quantity,
    parameters: { prompt, input: '', attachmentIds, ...(target ? { wallpaperTarget: target } : {}), ...(engineering ? { engineeringEnabled: true, engineeringReferenceId: attachmentIds[0] } : {}), imageSize: target ? wallpaperGenerationSize(target, modelId) : engineering ? /^gpt-image-/i.test(modelId || '') ? 'auto' : draft.size === 'auto' ? '1024x1024' : draft.size : options.imageOutputFormat === 'gif' ? 'auto' : draft.size, imageBackground: draft.wallpaperEnabled ? 'opaque' as const : engineering ? 'auto' as const : ['svg', 'gif'].includes(options.imageOutputFormat || '') ? 'auto' : imageDraftPurpose(draft)?.background === 'transparent' ? 'transparent' : draft.background, capability, modelConfigId: capability === 'image-editing' ? draft.editingModelId : draft.generationModelId, ...effectiveImageOptions(options, modelId, capability) },
  };
}

export function projectImageContent(runs: WorkflowRun[], projectId: string, trashedArtifacts?: ArtifactMetadata[]) {
  const deleted = trashedArtifacts ? new Set(trashedArtifacts.map(item => item.id)) : undefined;
  const files = new Map<string, ArtifactMetadata>();
  const generated = new Set<string>();
  let optimizedPrompt: ArtifactMetadata | undefined;
  const recent = runs.filter(run => run.mode === 'live' && isProductionRun(run) && run.projectId === projectId).sort((first, second) => (Date.parse(second.updatedAt) || 0) - (Date.parse(first.updatedAt) || 0));
  for (const run of recent) {
    for (const attempt of [...run.attempts].reverse()) {
      for (const artifact of attempt.artifacts || []) {
        if (artifact.projectId && artifact.projectId !== projectId || (deleted ? deleted.has(artifact.id) : Boolean(artifact.trashedAt))) continue;
        const current = deleted ? { ...artifact, trashedAt: undefined } : artifact;
        if (!files.has(current.id)) files.set(current.id, current);
        if (current.kind === 'image') {
          const step = run.snapshot.steps.find(step => step.id === attempt.stepId);
          if (step && ['image-generation', 'image-editing'].includes(step.kind) || (!step || step.kind === 'export') && current.runId === run.id) generated.add(current.id);
        }
        if (!optimizedPrompt && run.workflowId === `quick-${projectId}-text-refine` && attempt.status === 'complete' && current.kind === 'text' && current.mimeType === 'text/plain' && run.snapshot.steps.some(step => step.id === attempt.stepId && step.kind === 'text')) optimizedPrompt = current;
      }
    }
  }
  const artifacts = [...files.values()];
  return { images: artifacts.filter(item => item.kind === 'image' && generated.has(item.id)), reports: artifacts.filter(item => item.kind !== 'image'), artifacts, optimizedPrompt };
}
