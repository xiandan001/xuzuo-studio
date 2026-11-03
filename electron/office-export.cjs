const { parseContent, normalizeOfficeDocument, officeMissingInputs, imageDimensions } = require('./office-content.cjs');
const { renderOffice: defaultRenderOffice } = require('./office-render.cjs');

const OFFICE_MIME = {
  ppt: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  word: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

async function collectAssets(assets, readArtifact, convertImage) {
  if (!Array.isArray(assets) || assets.length > 20) throw new Error('单次导出最多附加 20 份产物。');
  const ids = [...new Set(assets.map(asset => typeof asset === 'string' ? asset : asset?.id))];
  if (ids.some(id => typeof id !== 'string')) throw new Error('附加产物需要有效编号。');
  const sources = [], images = [];
  let imageBytes = 0;
  for (const id of ids) {
    const source = await readArtifact(id);
    sources.push(source);
    if (!source.mimeType.startsWith('image/')) continue;
    let image = source;
    if (source.mimeType === 'image/webp' && convertImage) image = { ...source, buffer: Buffer.from(await convertImage(source.buffer)), mimeType: 'image/png', convertedFrom: 'image/webp' };
    if (!['image/png', 'image/jpeg'].includes(image.mimeType)) throw new Error('Office 暂仅嵌入 PNG/JPEG；请先将 WebP 转成 PNG，原始图片仍已保留。');
    imageBytes += image.buffer.length;
    if (image.buffer.length > 20 * 1024 * 1024 || imageBytes > 60 * 1024 * 1024) throw new Error('Office 嵌入图片单张最多 20 MB、合计最多 60 MB，请压缩图片或拆分导出。');
    const dimensions = imageDimensions(image.buffer, image.mimeType);
    images.push({ ...image, ...dimensions });
  }
  return { sources, images };
}

function usedImageIds(document) {
  const positions = document.kind === 'word' ? document.blocks.filter(block => block.type === 'image') : document.kind === 'ppt' ? document.slides.filter(slide => ['image-right', 'image-full'].includes(slide.layout)) : [];
  return [...new Set(positions.map(item => item.imageId).filter(Boolean))];
}
function createOfficeExporter({ writeArtifact, readArtifact, loadModule = require, convertImage, renderOffice }) {
  return async input => {
    if (!input || !['ppt', 'word', 'excel', 'image'].includes(input.kind)) throw new Error('请选择受支持的实际导出格式。');
    if (input.kind === 'image') {
      const content = parseContent(input.text ?? '', input.title), assets = input.assets ?? [];
      if (!Array.isArray(assets) || assets.length > 20) throw new Error('图像导出最多支持 20 份产物。');
      const ids = [...new Set(assets.map(asset => typeof asset === 'string' ? asset : asset?.id))];
      const sources = await Promise.all(ids.map(id => readArtifact(id)));
      const images = sources.filter(source => ['image/png', 'image/jpeg', 'image/webp'].includes(source.mimeType));
      if (!images.length) throw new Error('还没有真实图像产物，不能导出图像成品。');
      const note = await writeArtifact({ name: `${content.title}-内容说明.md`, mimeType: 'text/markdown', text: `# ${content.title}\n\n${content.raw || '图像由工作流生成，请人工检查内容、文字与边缘。'}\n\n## 图像文件\n${images.map(image => `- ${image.name}`).join('\n')}\n\n以上为实际图像文件，不是 Office 文件；未执行人物一致性、文字或透明边缘的自动验收。\n`, runId: input.runId, projectId: input.projectId });
      return [...images.map(({ buffer: _buffer, ...metadata }) => metadata), note];
    }
    const raw = input.text ?? '';
    if (typeof raw !== 'string' || !raw.trim()) throw new Error('没有可导出的正文或明确编辑源，请先完成内容并指定插图位置。');
    const document = normalizeOfficeDocument(input.kind, raw, input.title);
    const collected = await collectAssets(input.assets ?? [], readArtifact, convertImage), referencedImages = usedImageIds(document);
    const unplacedImages = collected.images.filter(image => !referencedImages.includes(image.id));
    const report = { type: 'xuzuo-office-export-check', version: 2, title: document.title, format: input.kind, generatedAt: new Date().toISOString(), status: 'requires-human-review', contentEditable: true, sourceStructure: document.kind === 'excel' ? 'canonical-workbook' : 'canonical-editor', normalizedWithWorkbench: true, embeddedImages: collected.images.filter(image => referencedImages.includes(image.id)).length, unplacedImageIds: unplacedImages.map(image => image.id), sources: collected.sources.map(source => ({ id: source.id, name: source.name, mimeType: source.mimeType })), warnings: [], missingInputs: officeMissingInputs(document), formulas: { count: 0, cells: [], recalculated: false, resultsVerified: false }, rendered: false, originalLayoutPreserved: false, manualChecks: ['逐页检查文字、版式、分页和图片比例。', '核对事实、数字、人物与商品一致性。', '同一编辑结构导出不等于已经完成视觉验收，不承诺输入原稿动画、宏或特殊图表无损保留。'] };
    if (unplacedImages.length) report.warnings.push(`有 ${unplacedImages.length} 份图片没有在编辑内容中指定位置，未擅自追加页面、段落或工作表；原始图片仍保留在项目产物中。`);
    if (collected.sources.some(source => !source.mimeType.startsWith('image/'))) report.warnings.push('非图像参考文件未自动混入正文或嵌入 Office，原附件仍保留在产物库中。');
    if (report.missingInputs.length) report.warnings.push('仍有待补充资料，已保留独立资料说明；请补全并人工检查后再交付。');
    const rendered = await (renderOffice ? renderOffice({ document, images: collected.images, report }) : defaultRenderOffice({ document, images: collected.images, report }, loadModule));
    const buffer = Buffer.from(rendered.buffer); Object.assign(report, rendered.report);
    const scope = { runId: input.runId, projectId: input.projectId }, extensions = { ppt: 'pptx', word: 'docx', excel: 'xlsx' };
    const file = await writeArtifact({ ...scope, name: `${document.title}.${extensions[input.kind]}`, mimeType: OFFICE_MIME[input.kind], buffer });
    const check = await writeArtifact({ ...scope, name: `${document.title}-检查报告.json`, mimeType: 'application/json', text: `${JSON.stringify(report, null, 2)}\n` });
    return [file, check];
  };
}
module.exports = { createOfficeExporter };
