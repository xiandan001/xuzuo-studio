import type { WorkflowRunner } from '../configuration-types';
import type { ArtifactPreview } from '../live-types';
import type { ImageReference } from './image-studio';
import { RASTER_IMAGE_TYPES } from './image-output-options';

type ImageReferenceReader = Pick<WorkflowRunner, 'previewArtifact' | 'inspectImageArtifact'>;
function requireRasterPreview(preview: ArtifactPreview) {
  if (!RASTER_IMAGE_TYPES.has(preview.mimeType) || !preview.dataUrl || !/^data:image\/(?:png|jpeg|webp|gif|svg\+xml);base64,/.test(preview.dataUrl)) throw new Error('参考图片暂不能读取，请检查项目文件。');
}

export async function inspectImageReference(id: string, runner: ImageReferenceReader): Promise<void> {
  if (runner.inspectImageArtifact) {
    const inspected = await runner.inspectImageArtifact(id);
    if (inspected.id !== id || !RASTER_IMAGE_TYPES.has(inspected.mimeType) || !Number.isSafeInteger(inspected.bytes) || inspected.bytes <= 0 || inspected.bytes > 20 * 1024 * 1024) throw new Error('参考图片检查结果不完整，请重新选择。');
    return;
  }
  requireRasterPreview(await runner.previewArtifact(id));
}

export async function readImageReferencePreviews(references: ImageReference[], runner: ImageReferenceReader, isCurrent: () => boolean): Promise<string | undefined> {
  let firstPreview: string | undefined;
  for (const [index, reference] of references.entries()) {
    if (!isCurrent()) return;
    if (index) {
      await inspectImageReference(reference.id, runner);
      if (!isCurrent()) return;
    } else {
      const preview = await runner.previewArtifact(reference.id);
      if (!isCurrent()) return;
      requireRasterPreview(preview); firstPreview = preview.dataUrl;
    }
  }
  return firstPreview;
}
