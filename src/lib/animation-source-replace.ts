import type { AnimationDocument, AnimationFrame } from '../animation-types';
import { checkedAnimationDocument } from './animation-document';
export function replaceAnimationSource(input: AnimationDocument, options: { oldArtifactId: string; newArtifactId: string; projectId: string; width: number; height: number; entryId?: string; frameId?: string }): AnimationDocument {
  const document = checkedAnimationDocument(input);
  if (options.projectId !== document.projectId || !/^[A-Za-z0-9-]{1,160}$/.test(options.newArtifactId) || ![options.width, options.height].every(value => Number.isSafeInteger(value) && value > 0)) throw Error('请选择本项目中已核实尺寸的静态图片。');
  if (options.frameId && !options.entryId) throw Error('请先选择当前条目，再替换单个关键帧。');
  if (!options.frameId && options.newArtifactId === options.oldArtifactId) throw Error('这张图已是当前源图，无需重复替换。');
  if (document.entries.some(entry => entry.frames.some(frame => frame.templatePlaceholder && frame.atlasArtifactId === options.newArtifactId))) throw Error('所选图片仍是模板占位，请上传真实图集或关键帧。');
  let changed = 0; const entries = document.entries.map(entry => {
    if (options.entryId && entry.id !== options.entryId) return entry;
    const frames = entry.frames.map(frame => {
      if (frame.atlasArtifactId !== options.oldArtifactId || options.frameId && frame.id !== options.frameId) return frame;
      const next: AnimationFrame = options.frameId ? { ...frame, atlasArtifactId: options.newArtifactId, cell: [0, 0], grid: [1, 1], crop: undefined, templatePlaceholder: undefined } : { ...frame, atlasArtifactId: options.newArtifactId, templatePlaceholder: undefined };
      const box = next.crop || [Math.floor(next.cell[0] * options.width / next.grid[0]), Math.floor(next.cell[1] * options.height / next.grid[1]), Math.floor((next.cell[0] + 1) * options.width / next.grid[0]), Math.floor((next.cell[1] + 1) * options.height / next.grid[1])];
      if (box[2] > options.width || box[3] > options.height || box[2] <= box[0] || box[3] <= box[1]) throw Error('新图尺寸与原网格或裁切不兼容，请选择匹配图集，或逐帧替换完整画面。');
      changed++; return next;
    });
    if (frames.every((frame, index) => frame === entry.frames[index])) return entry;
    return { id: entry.id, caption: entry.caption, description: entry.description, motion: entry.motion, frames, status: 'stale' as const };
  });
  if (!changed) throw Error('当前选择已改变，没有可替换的源帧。');
  return checkedAnimationDocument({ ...document, entries, acceptedSampleId: undefined, referenceArtifactIds: options.frameId ? document.referenceArtifactIds : [...new Set(document.referenceArtifactIds.map(id => id === options.oldArtifactId ? options.newArtifactId : id))] });
}
