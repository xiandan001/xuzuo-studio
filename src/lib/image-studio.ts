import type { WorkflowRun } from '../configuration-types';
import { isProductionRun } from './workflow-purpose';
import type { ArtifactMetadata } from '../live-types';
import { validImageQuantity } from './image-quantity';
import { effectiveImageOptions, readImageOutputOptions } from './image-output-options';
import type { ImageOutputOptions } from '../image-options-types';
import { BUILTIN_IMAGE_USE_TEMPLATES, IMAGE_PRESETS, IMAGE_SIZES, imageUseTemplateSnapshot, useTemplateDraftError } from './image-use-templates';
import type { ImageUseTemplateSnapshot } from './image-use-templates';
export { IMAGE_PRESETS, IMAGE_SIZES, PRESET_PROMPTS } from './image-use-templates';

export type ImageMode = 'create' | 'refine';
export type ImageBackground = 'auto' | 'opaque' | 'transparent';
export const MAX_IMAGE_REFERENCES = 12;
export function imageCreationDescription(prompt: string): string {
  const marker = '\n\n【用户本次要求】\n', position = prompt.indexOf(marker);
  return (position >= 0 ? prompt.slice(position + marker.length) : prompt.split('\n\n【成品与交付要求】')[0]).trim();
}
export interface ImageReference { id: string; name: string; }
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
  galleryBaseId?: string;
  imageOptions?: ImageOutputOptions;
  markupSourceId?: string;
}

export const imageDraftKey = (projectId: string) => `xuzuo-image-draft-v1-${projectId}`;

export function readImageDraft(raw: string | null, description: string): ImageDraft {
  const defaults: ImageDraft = { preset: '宣传图', prompt: description, refinePrompt: '保留主体与整体构图，按我的要求调整细节。', mode: 'create', size: '1024x1024', quantity: 1, background: 'auto', generationModelId: '', editingModelId: '', references: [] };
  if (!raw) return defaults;
  try {
    const value = JSON.parse(raw) as Partial<ImageDraft>;
    const text = (input: unknown, fallback: string, maximum = 200000) => typeof input === 'string' && input.length <= maximum ? input : fallback;
    const references = Array.isArray(value.references) ? value.references.filter((item): item is ImageReference => Boolean(item && typeof item.id === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(item.id) && typeof item.name === 'string' && item.name.length <= 200)).slice(0, MAX_IMAGE_REFERENCES).map(({ id, name }) => ({ id, name })) : [];
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
      ...(value.imageOptions ? { imageOptions: readImageOutputOptions(value.imageOptions) } : {}),
      ...(typeof value.markupSourceId === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value.markupSourceId) ? { markupSourceId: value.markupSourceId } : {}),
      ...(typeof value.galleryBaseId === 'string' && references.length === 1 && references[0].id === value.galleryBaseId ? { galleryBaseId: value.galleryBaseId } : {}),
    };
  } catch { return defaults; }
}

export function isGalleryImageBase(draft: ImageDraft): boolean { return draft.mode === 'refine' && draft.references.length === 1 && draft.galleryBaseId === draft.references[0].id; }
export function followGalleryImage(draft: ImageDraft, image: ImageReference): ImageDraft {
  return isGalleryImageBase(draft) ? { ...draft, references: [{ id: image.id, name: image.name }], galleryBaseId: image.id } : draft;
}
export function updateImageDraft(draft: ImageDraft, changes: Partial<ImageDraft>): ImageDraft {
  return { ...draft, ...changes, ...(changes.mode === 'create' || 'references' in changes && !Object.hasOwn(changes, 'galleryBaseId') ? { galleryBaseId: undefined } : {}) };
}

export function imageArtifactTarget(runs: WorkflowRun[], projectId: string, artifact: ArtifactMetadata | undefined): { size?: string; background?: ImageBackground } {
  if (!artifact || artifact.projectId && artifact.projectId !== projectId) return {};
  const recent = runs.filter(run => run.projectId === projectId && run.mode === 'live').slice().sort((a, b) => Number(b.id === artifact.runId) - Number(a.id === artifact.runId) || (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
  for (const run of recent) for (const attempt of run.attempts) {
    if (attempt.status !== 'complete' || !attempt.artifacts?.some(item => item.id === artifact.id)) continue;
    const step = run.snapshot.steps.find(item => item.id === attempt.stepId && ['image-generation', 'image-editing'].includes(item.kind));
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
  return { ...draft, preset: template.id, presetSnapshot: imageUseTemplateSnapshot(template), size: template.size, background: template.background };
}
export function imageDraftPurpose(draft: ImageDraft): ImageUseTemplateSnapshot | undefined {
  return BUILTIN_IMAGE_USE_TEMPLATES.find(item => item.id === draft.preset) || draft.presetSnapshot;
}
export function imageMissingReferences(draft: ImageDraft, selectedImageId?: string): number {
  const minimum = draft.mode === 'refine' ? 1 : imageDraftPurpose(draft)?.minReferences || 0;
  return Math.max(0, minimum - imageReferenceIds(draft.mode, draft.references, selectedImageId).length);
}

export function imageTaskRequest(draft: ImageDraft, selectedImageId?: string, modelId?: string) {
  const attachmentIds = imageReferenceIds(draft.mode, draft.references, selectedImageId);
  const capability = imageCapability(draft.mode, attachmentIds);
  return {
    count: draft.quantity,
    parameters: { prompt: draft.mode === 'refine' ? draft.refinePrompt : draft.prompt, input: '', attachmentIds, imageSize: draft.imageOptions?.imageOutputFormat === 'gif' ? 'auto' : draft.size, imageBackground: ['svg', 'gif'].includes(draft.imageOptions?.imageOutputFormat || '') ? 'auto' : imageDraftPurpose(draft)?.background === 'transparent' ? 'transparent' : draft.background, capability, modelConfigId: capability === 'image-editing' ? draft.editingModelId : draft.generationModelId, ...effectiveImageOptions(draft.imageOptions, modelId, capability) },
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
