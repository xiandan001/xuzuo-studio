const { editorFromText } = require('./editor-generated.cjs');
const { validateEditorDocument } = require('./editor-document.cjs');

const SUPPORTED = new Set(['image/png', 'image/jpeg', 'image/webp']);
const DOCUMENT_IMAGE_LIMIT = 20;
const DOCUMENT_REFERENCE_IMAGE_LIMIT = 12;
function precedingIllustrations(record, step, previous) {
  if (step.documentImageStepIds === undefined) return previous?.artifacts || [];
  const ids = step.documentImageStepIds, steps = record.run.snapshot.steps, position = steps.findIndex(item => item.id === step.id);
  if (!Array.isArray(ids) || !ids.length || ids.length > DOCUMENT_IMAGE_LIMIT || new Set(ids).size !== ids.length) throw new Error('配图步骤来源无效，原图与费用保留。');
  return ids.flatMap(id => {
    const sourceIndex = steps.findIndex(item => item.id === id && item.enabled && ['image-generation', 'image-editing'].includes(item.kind));
    if (sourceIndex < 0 || sourceIndex >= position) throw new Error('配图来源必须是本步骤前已启用的图片步骤。');
    const source = steps[sourceIndex], result = record.run.attempts.filter(item => item.stepId === id && item.status === 'complete').at(-1);
    const pictures = result?.artifacts?.filter(item => item.kind === 'image') || [];
    if (pictures.length !== (source.count || 1)) throw new Error('有配图步骤未返回约定数量的实际图片，请在任务中心检查；现有图片与费用保留。');
    return pictures;
  });
}
function illustrationAssets(record, step, previous, attachments) {
  if (!step.documentImageSource) return [];
  const files = step.documentImageSource === 'references' ? attachments : precedingIllustrations(record, step, previous);
  const images = [...new Map(files.filter(item => item.kind === 'image').map(item => [item.id, item])).values()];
  const limit = step.documentImageSource === 'references' ? DOCUMENT_REFERENCE_IMAGE_LIMIT : DOCUMENT_IMAGE_LIMIT;
  if (!images.length || images.length > limit) throw new Error(`图文生成需要 1–${limit} 张实际图片，请选择参考图或先完成配图步骤。`);
  if (images.some(item => item.projectId !== record.run.projectId || item.trashedAt || item.unavailable || !SUPPORTED.has(item.mimeType))) throw new Error('图文配图需要当前项目中可读取的 PNG、JPEG 或 WebP，原正文和文件保留。');
  return images;
}

function composeDocumentImages(kind, title, raw, images) {
  if (!['word', 'ppt'].includes(kind)) throw new Error('自动图文排版仅支持 Word 和 PPT。');
  if (!Array.isArray(images) || !images.length || images.length > DOCUMENT_IMAGE_LIMIT) throw new Error(`请选择 1–${DOCUMENT_IMAGE_LIMIT} 张真实插图。`);
  const document = editorFromText(kind, title, raw), allowed = new Set(images.map(image => image.id));
  const items = kind === 'word' ? document.blocks : document.slides;
  if (items.some(item => item.imageId && !allowed.has(item.imageId))) throw new Error('正文引用了本次未选择的图片，未导出错误插图；请保留原稿并重新选择图片。');
  const placed = new Set(items.map(item => item.imageId).filter(Boolean));
  const remaining = images.filter(image => !placed.has(image.id));
  if (kind === 'ppt') {
    const available = document.slides.map((slide, index) => ({ slide, index })).filter(({ slide }) => !slide.imageId);
    if (available.length < remaining.length) throw new Error(`本次有 ${images.length} 张配图，但文稿只有 ${document.slides.length} 页；请减少配图或增加页面后重试排版。原正文和图片保留。`);
    const positions = new Map(remaining.map((image, index) => [available[Math.floor(index * available.length / remaining.length)].index, image.id]));
    return validateEditorDocument({ ...document, slides: document.slides.map((slide, index) => {
      const imageId = positions.get(index) || slide.imageId;
      return imageId ? { ...slide, imageId, layout: ['image-right', 'image-full'].includes(slide.layout) ? slide.layout : 'image-right' } : slide;
    }) });
  }
  const appendix = document.blocks.findIndex(item => item.type === 'heading' && item.text === '待补充资料说明（非正文）');
  const end = appendix < 0 ? document.blocks.length : appendix;
  const anchors = document.blocks.slice(0, end).map((item, index) => ({ item, index })).filter(({ item }) => item.type !== 'heading' && item.type !== 'image');
  if (!anchors.length) throw new Error('正文没有可放置配图的完整内容段落，请先补全正文。原图片保留。');
  const positions = new Map();
  remaining.forEach((image, index) => {
    const position = anchors[Math.min(anchors.length - 1, Math.floor((index + 0.5) * anchors.length / remaining.length))].index;
    const block = { id: crypto.randomUUID(), type: 'image', text: '', imageId: image.id, fontSize: 11, align: 'center', bold: false, italic: false };
    positions.set(position, [...positions.get(position) || [], block]);
  });
  return validateEditorDocument({ ...document, blocks: document.blocks.flatMap((block, index) => [block, ...positions.get(index) || []]) });
}

module.exports = { illustrationAssets, composeDocumentImages };
