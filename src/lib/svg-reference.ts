import type { SvgReference } from '../live-types';
import type { WorkflowRunner } from '../configuration-types';

const MAX_BYTES = 20 * 1024 * 1024;
const cancelled = () => new DOMException('SVG参考转换已取消，原文件仍保留。', 'AbortError');
function current(signal?: AbortSignal) { if (signal?.aborted) throw cancelled(); }
function validSource(source: SvgReference) {
  return source.mimeType === 'image/svg+xml' && /^[a-f0-9]{64}$/.test(source.sourceSha256) && Number.isFinite(source.sourceWidth) && Number.isFinite(source.sourceHeight) && source.sourceWidth > 0 && source.sourceHeight > 0 && source.sourceWidth <= 16384 && source.sourceHeight <= 16384 && source.sourceWidth * source.sourceHeight <= 16777216 && Number.isInteger(source.width) && Number.isInteger(source.height) && source.width > 0 && source.height > 0 && source.width <= 2048 && source.height <= 2048;
}

function svgRenderingCopy(source: SvgReference): Blob {
  const document = new DOMParser().parseFromString(new TextDecoder().decode(source.sourceBytes), 'image/svg+xml');
  const root = document.documentElement;
  if (document.getElementsByTagName('parsererror').length || root.localName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg') throw Error('SVG格式无效，原文件仍保留。');
  if (!root.hasAttribute('viewBox')) root.setAttribute('viewBox', `0 0 ${source.sourceWidth} ${source.sourceHeight}`);
  root.setAttribute('width', String(source.width)); root.setAttribute('height', String(source.height));
  const style = (root as unknown as SVGSVGElement).style;
  style.setProperty('width', `${source.width}px`, 'important'); style.setProperty('height', `${source.height}px`, 'important');
  style.setProperty('min-width', '0', 'important'); style.setProperty('min-height', '0', 'important'); style.setProperty('max-width', `${source.width}px`, 'important'); style.setProperty('max-height', `${source.height}px`, 'important');
  return new Blob([new XMLSerializer().serializeToString(document)], { type: 'image/svg+xml' });
}

export async function svgReferencePng(source: SvgReference, signal?: AbortSignal): Promise<Uint8Array> {
  current(signal);
  if (!validSource(source) || !source.sourceBytes?.byteLength || source.sourceBytes.byteLength > 4 * 1024 * 1024) throw Error('SVG来源或目标画布无效，原文件仍保留。');
  const url = URL.createObjectURL(svgRenderingCopy(source));
  const image = new Image(), canvas = document.createElement('canvas');
  let timer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined;
  try {
    const interrupted = new Promise<never>((_, reject) => {
      abort = () => reject(cancelled()); signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => reject(Error('SVG转换超时，原文件未改变，请重试。')), 15000);
    });
    const encode = (async () => {
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(Error('这份SVG暂时无法读取，原文件仍保留。')); image.src = url; });
      current(signal);
      canvas.width = source.width; canvas.height = source.height;
      const context = canvas.getContext('2d'); if (!context) throw Error('当前环境无法转换SVG参考图。');
      context.drawImage(image, 0, 0, source.width, source.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(Error('SVG参考PNG未能保存，原文件仍保留。')), 'image/png'));
      current(signal); if (!blob.size || blob.size > MAX_BYTES) throw Error('SVG参考PNG为空或超过20MB。');
      const bytes = new Uint8Array(await blob.arrayBuffer()); current(signal);
      return bytes;
    })();
    return await Promise.race([encode, interrupted]);
  } finally {
    if (timer) clearTimeout(timer); if (abort) signal?.removeEventListener('abort', abort);
    image.onload = null; image.onerror = null; image.src = ''; canvas.width = 0; canvas.height = 0; URL.revokeObjectURL(url);
  }
}

export async function prepareSvgReference(runner: Pick<WorkflowRunner, 'prepareSvgReference'>, projectId: string, sourceArtifactId: string, signal?: AbortSignal): Promise<SvgReference> {
  current(signal); const prepare = runner.prepareSvgReference;
  if (!prepare) throw Error('请使用支持SVG转PNG参考的新版桌面应用。');
  const source = await prepare({ projectId, sourceArtifactId }); current(signal);
  if (!validSource(source) || source.sourceArtifactId !== sourceArtifactId) throw Error('SVG来源检查不完整，请重新选择。');
  const pngBytes = await svgReferencePng(source, signal); current(signal);
  const saved = await prepare({ projectId, sourceArtifactId, sourceSha256: source.sourceSha256, pngBytes }); current(signal);
  if (!validSource(saved) || saved.sourceArtifactId !== sourceArtifactId || saved.sourceSha256 !== source.sourceSha256 || saved.sourceWidth !== source.sourceWidth || saved.sourceHeight !== source.sourceHeight || saved.width !== source.width || saved.height !== source.height || !saved.reference || saved.reference.projectId !== projectId || saved.reference.mimeType !== 'image/png' || !saved.reference.bytes || saved.reference.bytes > MAX_BYTES) throw Error('SVG参考PNG未能可靠保存，原文件仍保留。');
  return saved;
}
