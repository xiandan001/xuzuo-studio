const { createHash } = require('node:crypto');
const { imageType, validateLocalGif: validateGif, rasterDimensions } = require('./image-output-formats.cjs');

const MAX_PNG_BYTES = 20 * 1024 * 1024;
const MAX_GIF_BYTES = 32 * 1024 * 1024;
const MAX_PIXELS = 16777216;
const MAX_CONTEXT_CHARACTERS = 200000;
const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(value);
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function imageOptions(step, frames) {
  const options = { imageOutputFormat: 'gif', imageFrameCount: Number.isInteger(step.imageFrameCount) && step.imageFrameCount >= 2 && step.imageFrameCount <= 16 ? step.imageFrameCount : frames };
  if (Number.isInteger(step.imageFrameDurationMs) && step.imageFrameDurationMs >= 20 && step.imageFrameDurationMs <= 2000 && step.imageFrameDurationMs % 10 === 0) options.imageFrameDurationMs = step.imageFrameDurationMs;
  if (['auto', 'low', 'medium', 'high', 'xhigh', 'max'].includes(step.imageQuality)) options.imageQuality = step.imageQuality;
  if (['low', 'medium', 'high'].includes(step.imageComplexity)) options.imageComplexity = step.imageComplexity;
  return options;
}

function referencePrompt(attempt, run) {
  const parts = [attempt.prompt, attempt.input].filter(value => typeof value === 'string' && value);
  const prompt = parts.length ? parts.join('\n\n') : typeof run.input === 'string' ? run.input : '';
  if (prompt.length > MAX_CONTEXT_CHARACTERS) throw Error('动画原始制作上下文超过200000字符，请缩短上下文后重新制作。');
  return prompt;
}

function pngBuffer(value, dimensions, loadModule) {
  if (!(value instanceof Uint8Array) && !(value instanceof ArrayBuffer)) throw Error('动画参考图需要完整的PNG二进制内容。');
  if (!value.byteLength || value.byteLength > MAX_PNG_BYTES) throw Error('动画参考PNG为空或超过20MB。');
  const buffer = Buffer.from(value instanceof ArrayBuffer ? new Uint8Array(value) : value);
  let size, bitmap;
  try {
    if (imageType(buffer).mimeType !== 'image/png') throw Error('type');
    size = rasterDimensions(buffer);
  } catch { throw Error('动画参考图必须是真实的PNG文件。'); }
  if (size.width * size.height > MAX_PIXELS || size.width !== dimensions.width || size.height !== dimensions.height) throw Error('动画参考PNG必须保留GIF完整画布尺寸，不能使用缩略图。');
  try { bitmap = loadModule('pngjs').PNG.sync.read(buffer); }
  catch { throw Error('动画参考PNG无法完整解码，请重新提取参考帧。'); }
  if (bitmap.width !== size.width || bitmap.height !== size.height || bitmap.data.length !== size.width * size.height * 4) throw Error('动画参考PNG的实际画布尺寸不一致。');
  return buffer;
}

function createGeneratedAnimationReference({ artifactStore, liveEngine, loadModule = require }) {
  return async function prepare(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || !validId(input.projectId) || !validId(input.sourceArtifactId)) throw Error('请重新选择本项目生成的GIF动图。');
    const saving = input.pngBytes !== undefined;
    if ((saving || input.sourceSha256 !== undefined) && !validHash(input.sourceSha256)) throw Error('动画来源校验信息无效，请重新读取原动图。');
    const source = await artifactStore.read(input.sourceArtifactId);
    if (source.id !== input.sourceArtifactId || source.projectId !== input.projectId || source.mimeType !== 'image/gif' || source.trashedAt || source.unavailable || !validId(source.runId)) throw Error('只能继续修改本项目实际生成且仍可用的GIF动图，外部导入GIF不可直接精修。');
    if (source.buffer.byteLength > MAX_GIF_BYTES) throw Error('动画源GIF超过32MB，请缩小原动图后再继续修改。');
    const dimensions = validateGif(source.buffer);
    if (dimensions.width * dimensions.height > MAX_PIXELS) throw Error('动画源GIF画布超过16777216像素，请缩小原动图后再继续修改。');
    const sourceSha256 = createHash('sha256').update(source.buffer).digest('hex');
    if (input.sourceSha256 !== undefined && input.sourceSha256 !== sourceSha256) throw Error('原动图内容已变化，请重新读取后再提取参考帧。');
    const run = await liveEngine.runDetail(source.runId);
    if (!run || run.id !== source.runId || run.projectId !== input.projectId || run.mode !== 'live' || run.trashedAt) throw Error('无法核对这张动图的本项目实际生成记录。');
    const attempts = Array.isArray(run.attempts) ? run.attempts : [];
    const steps = Array.isArray(run.snapshot?.steps) ? run.snapshot.steps : [];
    const attempt = attempts.findLast(item => item.status === 'complete' && Array.isArray(item.artifacts) && item.artifacts.some(file => file.id === source.id) && steps.some(step => step.id === item.stepId && ['image-generation', 'image-editing'].includes(step.kind)));
    if (!attempt) throw Error('这张动图没有对应的已完成图片生成或编辑记录。');
    const step = steps.find(item => item.id === attempt.stepId);
    const prompt = referencePrompt(attempt, run);
    const context = { sourceArtifactId: source.id, sourceSha256, prompt, imageOptions: imageOptions(step, dimensions.frames), mimeType: 'image/gif', width: dimensions.width, height: dimensions.height };
    if (!saving) return { ...context, sourceBytes: Uint8Array.from(source.buffer) };
    const buffer = pngBuffer(input.pngBytes, dimensions, loadModule);
    const reference = await artifactStore.write({ projectId: input.projectId, name: '动画修改参考.png', mimeType: 'image/png', buffer });
    return { ...context, reference };
  };
}

module.exports = { createGeneratedAnimationReference };
