const { imageType, rasterDimensions } = require('./image-output-formats.cjs');

const MAX_PIXELS = 16000000;
const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
const fitsPixelLimit = ({ width, height }) => [width, height].every(side => Number.isSafeInteger(side) && side > 0 && side <= 8192) && width * height <= MAX_PIXELS;

function imageExportSizeError(size) {
  if (!size || typeof size !== 'object' || Array.isArray(size) || Object.keys(size).some(key => !['width', 'height'].includes(key)) || !fitsPixelLimit(size) || size.width < 64 || size.height < 64) {
    return '请填写导出的宽度和高度，每边需要64–8192整数像素，合计不超过1600万像素。';
  }
}

function singleImageExportSourceStepId(step) {
  if (step.contentSourceStepIds === undefined) return step.contentSourceStepId;
  if (step.contentSourceStepId === undefined && Array.isArray(step.contentSourceStepIds) && step.contentSourceStepIds.length === 1) return step.contentSourceStepIds[0];
}

function singleProducedPng(run, step, beforeIndex) {
  const id = singleImageExportSourceStepId(step);
  const producer = run.snapshot.steps.slice(0, beforeIndex).find(candidate => candidate.id === id);
  if (!producer?.enabled || !['image-generation', 'image-editing'].includes(producer.kind) || ['planner', 'reviewer'].includes(producer.role) || (producer.count ?? 1) !== 1 || (producer.imageOutputFormat ?? 'png') !== 'png') return;
  const attempt = run.attempts.findLast(item => item.stepId === id && item.status === 'complete');
  const images = (attempt?.artifacts || []).filter(file => file.kind === 'image');
  if (images.length === 1 && isRunPng(images[0], run.projectId, run.id)) return images[0];
}

function isRunPng(file, projectId, runId) {
  return Boolean(file?.id && file.projectId === projectId && file.runId === runId && file.kind === 'image' && file.mimeType === 'image/png' && !file.trashedAt && !file.unavailable);
}

async function readResizeSource(readArtifact, id, projectId, runId) {
  const file = await readArtifact(id);
  if (!isRunPng(file, projectId, runId) || file.id !== id || !Buffer.isBuffer(file.buffer) || !file.buffer.length || file.buffer.length > MAX_SOURCE_BYTES || imageType(file.buffer).mimeType !== 'image/png' || !fitsPixelLimit(rasterDimensions(file.buffer))) {
    throw Error('尺寸适配需要本项目、本次制作实际生成的单张静态PNG，原图与费用保留。');
  }
  return file;
}

function createResizedImageExporter({ writeArtifact, readArtifact, fitEngineering }) {
  return async input => {
    const size = input.imageExportSize, issue = imageExportSizeError(size);
    if (issue) throw Error(issue);
    if (input.kind !== 'image' || input.wallpaperTarget !== undefined || input.engineeringReferenceId !== undefined || input.assets?.length !== 1) throw Error('尺寸适配需要单张实际生成的图片，不能同时设置壁纸或工程适配。');
    if (typeof fitEngineering !== 'function') throw Error('当前环境不支持本地图片尺寸适配，原图与费用保留。');
    const source = await readResizeSource(readArtifact, input.assets[0].id, input.projectId, input.runId);
    const result = await fitEngineering({ buffer: source.buffer, target: { ...size, fit: 'contain' } }, { signal: input.signal });
    const current = await readResizeSource(readArtifact, source.id, input.projectId, input.runId);
    if (current.sha256 !== source.sha256) throw Error('来源图已发生变化，请恢复原图后继续本地适配。');
    const buffer = Buffer.from(result);
    const dimensions = rasterDimensions(buffer);
    if (imageType(buffer).mimeType !== 'image/png' || dimensions.width !== size.width || dimensions.height !== size.height) throw Error('实际PNG像素与指定尺寸不一致，原图与费用保留。');
    return [await writeArtifact({ projectId: input.projectId, runId: input.runId, name: `${input.title || '图片'}-本地适配-${size.width}x${size.height}.png`, mimeType: 'image/png', buffer, signal: input.signal })];
  };
}

module.exports = { imageExportSizeError, singleImageExportSourceStepId, singleProducedPng, isRunPng, readResizeSource, createResizedImageExporter };
