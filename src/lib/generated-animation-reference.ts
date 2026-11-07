import type { GeneratedAnimationReference } from '../live-types';
import type { WorkflowRunner } from '../configuration-types';

const MAX_BYTES = 20 * 1024 * 1024;
const cancelled = () => new DOMException('动画修改准备已取消。', 'AbortError');
function current(signal?: AbortSignal) { if (signal?.aborted) throw cancelled(); }

export async function animationReferencePng(source: GeneratedAnimationReference, signal?: AbortSignal): Promise<Uint8Array> {
  current(signal);
  if (!source.sourceBytes?.byteLength || source.mimeType !== 'image/gif' || !Number.isInteger(source.width) || !Number.isInteger(source.height) || source.width < 1 || source.height < 1 || source.width * source.height > 16777216) throw Error('动画画面超出可处理范围，原文件仍保留。');
  const url = URL.createObjectURL(new Blob([Uint8Array.from(source.sourceBytes)], { type: 'image/gif' }));
  const image = new Image(), canvas = document.createElement('canvas');
  let timer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined;
  try {
    const interrupted = new Promise<never>((_, reject) => {
      abort = () => reject(cancelled()); signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => reject(Error('动画画面读取超时，原文件未改变，请重试。')), 15000);
    });
    const encode = (async () => {
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(Error('这份动画暂时无法读取，原文件仍保留。')); image.src = url; });
      current(signal);
      if (image.naturalWidth !== source.width || image.naturalHeight !== source.height) throw Error('动画实际画布尺寸与记录不一致。');
      canvas.width = source.width; canvas.height = source.height;
      const context = canvas.getContext('2d'); if (!context) throw Error('当前环境无法准备动画修改。');
      context.drawImage(image, 0, 0, source.width, source.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(Error('动画画面未能保存，原文件仍保留。')), 'image/png'));
      current(signal); if (!blob.size || blob.size > MAX_BYTES) throw Error('动画修改参考超过20MB，请使用较小的画布。');
      const bytes = new Uint8Array(await blob.arrayBuffer()); current(signal);
      if (!bytes.length || bytes.length > MAX_BYTES) throw Error('动画修改参考超过允许大小。');
      return bytes;
    })();
    return await Promise.race([encode, interrupted]);
  } finally {
    if (timer) clearTimeout(timer); if (abort) signal?.removeEventListener('abort', abort);
    image.onload = null; image.onerror = null; image.src = ''; canvas.width = 0; canvas.height = 0; URL.revokeObjectURL(url);
  }
}

export async function prepareAnimationReference(runner: Pick<WorkflowRunner, 'prepareGeneratedAnimationReference' | 'listProjectArtifacts' | 'inspectImageArtifact'>, projectId: string, sourceArtifactId: string, signal?: AbortSignal, existing?: { sourceArtifactId: string; sourceSha256: string; referenceId: string }): Promise<GeneratedAnimationReference> {
  current(signal); const prepare = runner.prepareGeneratedAnimationReference;
  if (!prepare) throw Error('请使用支持继续修改动画的新版桌面应用。');
  const source = await prepare({ projectId, sourceArtifactId }); current(signal);
  if (source.sourceArtifactId !== sourceArtifactId || !/^[a-f0-9]{64}$/.test(source.sourceSha256) || source.mimeType !== 'image/gif' || !Number.isInteger(source.width) || !Number.isInteger(source.height) || source.width < 1 || source.height < 1 || source.width * source.height > 16777216) throw Error('动画来源检查不完整，请重新选择。');
  if (existing?.sourceArtifactId === sourceArtifactId && existing.sourceSha256 === source.sourceSha256 && runner.listProjectArtifacts && runner.inspectImageArtifact) {
    const files = await runner.listProjectArtifacts(projectId, { refresh: true }); current(signal);
    const reference = files.find(file => file.id === existing.referenceId && file.projectId === projectId && file.mimeType === 'image/png' && file.bytes > 0 && file.bytes <= MAX_BYTES && !file.trashedAt && !file.unavailable);
    if (reference) {
      let valid = false;
      try { const inspected = await runner.inspectImageArtifact(reference.id); valid = inspected.id === reference.id && inspected.mimeType === 'image/png' && inspected.bytes > 0 && inspected.bytes <= MAX_BYTES; }
      catch { /* A missing or changed local reference is rebuilt from the freshly verified GIF. */ }
      current(signal);
      if (valid) return { ...source, sourceBytes: undefined, reference };
    }
  }
  const pngBytes = await animationReferencePng(source, signal); current(signal);
  const saved = await prepare({ projectId, sourceArtifactId, sourceSha256: source.sourceSha256, pngBytes }); current(signal);
  if (saved.sourceArtifactId !== sourceArtifactId || saved.sourceSha256 !== source.sourceSha256 || !saved.reference || saved.reference.projectId !== projectId || saved.reference.mimeType !== 'image/png' || !saved.reference.bytes || saved.reference.bytes > MAX_BYTES) throw Error('动画修改参考未能可靠保存，原文件仍保留。');
  return saved;
}
