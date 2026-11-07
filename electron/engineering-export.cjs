const { createHash } = require('node:crypto');
const { readRasterReferenceSize } = require('./image-reference-normalization.cjs');
const { imageType, rasterDimensions } = require('./image-output-formats.cjs');
const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value);
const validDimensions = value => [value?.width, value?.height].every(side => Number.isInteger(side) && side >= 64 && side <= 8192) && value.width * value.height <= 16000000;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function ensureActive(input) { if (input.signal?.aborted) throw Object.assign(new Error('工程图片适配已取消，原图与费用保留。'), { name: 'AbortError' }); }
function engineeringSourceError(source) {
  return source && typeof source === 'object' && !Array.isArray(source) && validId(source.referenceId) && validDimensions(source) && /^[a-f0-9]{64}$/.test(source.sha256 || '') ? undefined : '工程主画布的来源、原尺寸或校验信息无效，请重新选择主原图。';
}
async function readEngineeringSource(readArtifact, input) {
  if (!input || !validId(input.projectId) || !validId(input.referenceId) || !Array.isArray(input.attachmentIds) || !input.attachmentIds.length || input.attachmentIds.length > 16 || input.attachmentIds[0] !== input.referenceId || input.attachmentIds.some(id => !validId(id))) throw Error('工程主原图必须是本次明确提交的第一张参考图。');
  const source = await readArtifact(input.referenceId);
  if (!source || source.id !== input.referenceId || source.projectId !== input.projectId || source.kind !== 'image' || !['image/png', 'image/jpeg', 'image/webp'].includes(source.mimeType) || source.trashedAt || source.unavailable) throw Error('工程主原图必须是本项目可读取的静态PNG、JPEG或WebP。');
  const dimensions = readRasterReferenceSize(source.buffer);
  if (!validDimensions(dimensions)) throw Error('工程主原图每边需要64–8192像素，合计不超过1600万像素；请先缩小或重新选择。');
  return { referenceId: source.id, width: dimensions.width, height: dimensions.height, sha256: hash(source.buffer) };
}
function checkedEditedImage(file, input) {
  if (!file || file.projectId !== input.projectId || file.runId !== input.runId || file.kind !== 'image' || file.mimeType !== 'image/png' || file.trashedAt || file.unavailable || !Buffer.isBuffer(file.buffer) || !file.buffer.length || file.buffer.length > 32 * 1024 * 1024) throw Error('工程适配需要本项目、本轮图片编辑成功生成的PNG，不能把主原图或其他项目文件当作编辑结果。');
  const dimensions = rasterDimensions(file.buffer);
  if (imageType(file.buffer).mimeType !== 'image/png' || !dimensions.width || !dimensions.height || dimensions.width > 8192 || dimensions.height > 8192 || dimensions.width * dimensions.height > 16000000) throw Error('工程编辑结果的PNG格式或尺寸无效，原文件与已发生费用保留。');
  return file;
}
function sameSource(before, after) { return ['referenceId', 'width', 'height', 'sha256'].every(key => before[key] === after[key]); }
function createEngineeringExporter({ writeArtifact, readArtifact, fitEngineering }) {
  return async input => {
    if (!input || input.kind !== 'image' || !validId(input.projectId) || !validId(input.runId) || input.wallpaperTarget !== undefined) throw Error('工程图片适配仅用于图片项目的独立本地导出，不能同时设为壁纸。');
    if (typeof fitEngineering !== 'function') throw Error('当前环境不支持工程图片原尺寸适配，请使用新版桌面应用；原图与费用保留。');
    ensureActive(input);
    const referenceRequest = { projectId: input.projectId, referenceId: input.engineeringReferenceId, attachmentIds: input.attachmentIds };
    const source = await readEngineeringSource(readArtifact, referenceRequest);
    if (input.engineeringSource !== undefined && (engineeringSourceError(input.engineeringSource) || !sameSource(input.engineeringSource, source))) throw Error('工程主原图已变化，请恢复原图后继续本地适配；没有重新调用模型。');
    const ids = Array.isArray(input.assets) ? input.assets.map(asset => typeof asset === 'string' ? asset : asset?.id) : [];
    if (!ids.length || ids.length > 20 || ids.some(id => !validId(id) || id === source.referenceId) || new Set(ids).size !== ids.length) throw Error('工程适配需要1–20份不重复的本轮编辑结果，主原图不能代替结果。');
    for (const id of ids) { ensureActive(input); checkedEditedImage(await readArtifact(id), input); }
    const artifacts = [], target = { width: source.width, height: source.height, fit: 'contain' };
    try {
      for (const [index, id] of ids.entries()) {
        ensureActive(input); const edited = checkedEditedImage(await readArtifact(id), input); ensureActive(input);
        const result = await fitEngineering({ buffer: edited.buffer, target }, { signal: input.signal }); ensureActive(input);
        if (!sameSource(source, await readEngineeringSource(readArtifact, referenceRequest))) throw Error('工程主原图已变化，未写入迟到的工程图片；请恢复原图后继续。');
        ensureActive(input);
        if (!(result instanceof Uint8Array) || !result.length || result.length > 100 * 1024 * 1024) throw Error('工程适配未返回有效PNG，原图与费用保留。');
        const buffer = Buffer.from(result), dimensions = rasterDimensions(buffer);
        if (imageType(buffer).mimeType !== 'image/png' || dimensions.width !== target.width || dimensions.height !== target.height) throw Error('工程成品实际像素与主原图不一致，未作为本次成品交付。');
        artifacts.push(await writeArtifact({ projectId: input.projectId, runId: input.runId, name: `${input.title || '工程图片'}-原尺寸-${target.width}x${target.height}-${index + 1}.png`, mimeType: 'image/png', buffer }));
      }
      return artifacts;
    } catch (error) { error.artifacts = artifacts; throw error; }
  };
}
module.exports = { readEngineeringSource, engineeringSourceError, createEngineeringExporter };
