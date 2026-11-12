const { imageType, rasterDimensions, validateSvg, validateLocalGif } = require('./image-output-formats.cjs');

function proofImagePreview(nativeImage, file) {
  const buffer = Buffer.from(file.buffer), type = imageType(buffer);
  if (type.mimeType !== file.mimeType || buffer.length > 20 * 1024 * 1024) throw Error('校样图片格式不符或超过20MB，请先检查原文件。');
  if (type.extension === 'svg') { validateSvg(buffer); return { mimeType: type.mimeType, buffer }; }
  if (type.extension === 'gif') { validateLocalGif(buffer); return { mimeType: type.mimeType, buffer }; }
  const dimensions = rasterDimensions(buffer);
  if (dimensions.width * dimensions.height > 16777216) throw Error('校样图片超过1600万像素，请先导出较小预览；原文件保留。');
  const image = nativeImage.createFromBuffer(buffer);
  if (image.isEmpty()) throw Error('校样图片无法解码，请先检查原文件。');
  const size = image.getSize(), scale = Math.min(1, 1400 / Math.max(size.width, size.height));
  return { mimeType: 'image/png', buffer: (scale < 1 ? image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), quality: 'good' }) : image).toPNG() };
}

function copiedDocumentExport({ liveEngine, editorStore, spreadsheetStore }) {
  return async input => {
    // Image copies remain real imported files, without masquerading as generated or validated exports.
    if (input.kind === 'image') return;
    const store = input.kind === 'excel' ? spreadsheetStore : editorStore;
    const saved = await store.load({ projectId: input.projectId, ...(input.kind !== 'excel' ? { kind: input.kind } : {}) });
    if (!saved || !Number.isSafeInteger(saved.revision)) throw Error('文件已复制，但编辑版本暂未读取，请重试完成登记。');
    return liveEngine.recordLocalExport({ ...input, sourceRevision: saved.revision });
  };
}

module.exports = { proofImagePreview, copiedDocumentExport };
