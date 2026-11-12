import type { ProjectTemplateResult } from '../project-template-types';
import { IMAGE_SIZES, readImageDraft } from './image-studio';
export function projectTemplateImageDraft(result: ProjectTemplateResult, copy: boolean) {
  const draft = readImageDraft(null, ''), target = result.imageSettings;
  if (target) { const candidates = IMAGE_SIZES.map(item => item.value).map(value => ({ value, match: /^(\d+)x(\d+)$/.exec(value) })).filter(item => item.match); candidates.sort((a, b) => Math.abs(Math.log(Number(a.match![1]) / Number(a.match![2]) / (target.width / target.height))) - Math.abs(Math.log(Number(b.match![1]) / Number(b.match![2]) / (target.width / target.height)))); if (candidates[0]) draft.size = candidates[0].value; }
  const image = copy && result.artifacts.find(file => file.projectId === result.projectId && ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimeType));
  if (image) { draft.mode = 'refine'; draft.references = [{ id: image.id, name: image.name }]; draft.galleryBaseId = image.id; }
  return draft;
}
