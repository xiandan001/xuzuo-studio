import type { EditorDocument } from '../editor-types';
import { editorMissingInputs } from './editor-generated';
import { wordTableText } from './word-table';
export interface DeliveryCheck { id: string; label: string; detail: string; status: 'passed' | 'failed' | 'unknown' | 'manual'; }
export interface ImageDeliveryMetadata { width?: number; height?: number; transparency?: 'present' | 'opaque' | 'unknown'; }
const check = (id: string, label: string, status: DeliveryCheck['status'], detail: string): DeliveryCheck => ({ id, label, status, detail });
const placeholder = /(?:\bTODO\b|\bXXX\b|lorem\s+ipsum|请(?:在此)?(?:填写|输入|补充)|示例数据|\[(?:待填写|待补充)[^\]]*\])/i;
export function editorDeliveryChecks(document: EditorDocument, options: { saved?: boolean; exported?: boolean; expectedPageCount?: number } = {}): DeliveryCheck[] {
  const texts = document.kind === 'ppt' ? document.slides.flatMap(slide => [slide.title, slide.body]) : document.blocks.filter(block => block.type !== 'image').map(block => block.type === 'table' && block.table ? wordTableText(block.table) : block.text);
  const empty = document.kind === 'ppt' ? document.slides.flatMap((slide, index) => !slide.title.trim() || !slide.body.trim() && !slide.imageId ? [index + 1] : []) : [];
  const hasContent = document.kind === 'ppt' ? document.slides.length > 0 && empty.length === 0 : texts.some(text => text.trim()) || document.blocks.some(block => block.type === 'image' && block.imageId);
  const checks = [check('saved', '当前编辑版本已保存', options.saved ? 'passed' : 'failed', options.saved ? '检查绑定当前保存版本；修改后需要重新验收。' : '先保存并导出当前版本，再验收成品。'), check('title', '标题与内容完整', document.title.trim() && hasContent ? 'passed' : 'failed', empty.length ? `第 ${empty.join('、')} 页缺少标题或正文/插图。` : hasContent ? '已有可编辑正文或图像内容。' : '正文为空，补充完整内容后再交付。'), check('placeholders', '明显占位文字已清理', placeholder.test([document.title, ...texts].join('\n')) ? 'failed' : 'passed', '检查 TODO、XXX、请填写、示例数据等明显占位；事实核验仍由人工完成。')];
  checks.push(check('exported', '当前版本已生成 Office 文件', options.saved && options.exported ? 'passed' : options.exported === undefined ? 'unknown' : 'failed', options.saved && options.exported ? '已匹配此保存版本的成功导出文件，实际排版仍需打开检查。' : options.exported === undefined ? '尚未确认当前版本的导出文件，请等待文件状态载入；未确认前不能标记可交付。' : '请保存并导出当前版本；仅保存编辑源或旧版本文件不能作为本次成品。'));
  if (document.kind === 'ppt') {
    if (options.expectedPageCount) checks.push(check('pages', '页数符合本次要求', document.slides.length === options.expectedPageCount ? 'passed' : 'failed', `当前 ${document.slides.length} 页，要求 ${options.expectedPageCount} 页。`));
    const crowded = document.slides.flatMap((slide, index) => slide.body.length > 700 || slide.body.split('\n').length > 10 ? [index + 1] : []);
    if (crowded.length) checks.push(check('crowded', '较长页面已检查', 'manual', `第 ${crowded.join('、')} 页内容较多，请检查字号、遮挡与溢出，必要时拆页。`));
  }
  const missing = editorMissingInputs(document).filter(line => line.startsWith('待补充'));
  if (missing.length) checks.push(check('missing-inputs', '关键资料已补齐', 'unknown', `仍有 ${missing.length} 项生成时标注的缺资料说明，请补齐或确认并更新资料附录：${missing.join('；')}`));
  return [...checks, check('facts', '事实、数字与客户要求已核对', 'manual', '核对名称、金额、日期、引用和未确认信息，确保没有虚构内容。'), check('layout', '实际导出文件已打开检查', 'manual', '检查分页、页序、文字溢出、图表/图片和公式，确认内容与编辑版本一致。'), check('rights', '素材来源与使用范围已核对', 'manual', '核对图片、字体、商标及人物素材是否适合本次交付用途。')];
}
export function imageDeliveryChecks(input: ImageDeliveryMetadata & { expectedSize?: string; requiresTransparency?: boolean; artifactAvailable?: boolean; mimeType?: string }): DeliveryCheck[] {
  const known = Number.isSafeInteger(input.width) && input.width! > 0 && Number.isSafeInteger(input.height) && input.height! > 0;
  const expected = input.expectedSize?.match(/^(\d+)x(\d+)$/);
  const matches = input.expectedSize === 'auto' || !!expected && input.width === Number(expected[1]) && input.height === Number(expected[2]);
  const checks = [check('file', '真实图片文件可用', input.artifactAvailable ? 'passed' : 'unknown', input.artifactAvailable ? '验收针对当前选中的实际产物。' : '先生成或选择实际图片。'), check('dimensions', '实际尺寸符合交付目标', !known || !expected && input.expectedSize !== 'auto' ? 'unknown' : matches ? 'passed' : 'failed', !known ? '图片尚未完成读取，实际像素未确认。' : `实际 ${input.width} × ${input.height}${expected ? `，目标 ${expected[1]} × ${expected[2]}` : input.expectedSize === 'auto' ? '，本次使用自动尺寸' : '，此产物的生成目标未记录，不能自动判断尺寸是否合格'}。`)];
  if (known && Math.min(input.width!, input.height!) < 512) checks.push(check('small', '小尺寸用途已确认', 'manual', '此图尺寸较小，请确认适用于头像、图标等实际用途，而不是放大后交付。'));
  if (input.requiresTransparency) checks.push(check('format', '透明素材为 PNG 文件', input.mimeType === 'image/png' ? 'passed' : input.mimeType ? 'failed' : 'unknown', input.mimeType ? `实际文件类型：${input.mimeType}。` : '文件类型尚未确认。'));
  if (input.requiresTransparency) checks.push(check('alpha', '透明 PNG 含真实透明像素', input.transparency === 'present' ? 'passed' : input.transparency === 'opaque' ? 'failed' : 'unknown', input.transparency === 'present' ? '已读取到 Alpha 透明像素；边缘质量仍需目视检查。' : input.transparency === 'opaque' ? '像素中未发现透明区域，棋盘格或白底不等于透明。' : '尚不能可靠检查透明通道，未自动判定通过。'));
  return [...checks, check('visual', '主体、文字和参考一致性已检查', 'manual', '核对错别字、人物肢体、商品结构、包装/标志、画面构图及参考图要求。'), check('edges', '画质、裁切与边缘已检查', 'manual', '按交付尺寸检查清晰度、安全边距、杂色、透明边缘和背景衔接。'), check('rights', '素材来源与使用范围已核对', 'manual', '确认人物、商标、参考素材及模型输出适合本次使用场景。')];
}
export function deliveryFingerprint(value: string): string {
  let first = 2166136261, second = 5381;
  for (let index = 0; index < value.length; index++) { const code = value.charCodeAt(index); first = Math.imul(first ^ code, 16777619); second = Math.imul(second, 33) ^ code; }
  return `${value.length}-${(first >>> 0).toString(16)}-${(second >>> 0).toString(16)}`;
}
export function inspectDeliveryImage(image: HTMLImageElement): ImageDeliveryMetadata {
  const width = image.naturalWidth, height = image.naturalHeight;
  if (!width || !height || width * height > 16_777_216) return { width, height, transparency: 'unknown' };
  try {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) return { width, height, transparency: 'unknown' };
    context.drawImage(image, 0, 0); const data = context.getImageData(0, 0, width, height).data;
    for (let index = 3; index < data.length; index += 4) if (data[index] < 255) return { width, height, transparency: 'present' };
    return { width, height, transparency: 'opaque' };
  } catch { return { width, height, transparency: 'unknown' }; }
}
