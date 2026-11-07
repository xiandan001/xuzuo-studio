const IMAGE26 = /^gpt-image-2\.6-(sunburst|flare)$/;
const IMAGE25 = /^gpt-image-2\.5-(sunburst|flare)$/;
const FORMATS = ['png', 'jpeg', 'webp', 'svg', 'gif'];
const QUALITIES = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'];
const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const IMAGE_KINDS = ['image-generation', 'image-editing'];
const advancedKeys = ['outputFormat', 'quality', 'complexity', 'frameCount', 'frameDurationMs', 'outputCompression', 'markupArtifactId', 'svgModel', 'svgReasoningEffort'];

function imageOptionsError(modelId, kind, options = {}) {
  if (!IMAGE_KINDS.includes(kind)) return advancedKeys.some(key => options[key] !== undefined) ? '图片高级设置仅用于图片生成或编辑步骤。' : undefined;
  const format = options.outputFormat ?? 'png';
  const modern = IMAGE26.test(modelId) || IMAGE25.test(modelId);
  if (!FORMATS.includes(format)) return '图片输出格式需要为PNG、JPEG、WebP、SVG或GIF。';
  if (options.quality !== undefined && (!modern || !QUALITIES.includes(options.quality))) return '所选型号不支持此图片质量设置；2.5/2.6可选auto、low、medium、high、xhigh或max。';
  if (options.complexity !== undefined && (!IMAGE26.test(modelId) || !['low', 'medium', 'high'].includes(options.complexity))) return '复杂度设置仅支持GPT Image 2.6，需为low、medium或high。';
  if (['svg', 'gif'].includes(format) && !IMAGE26.test(modelId)) return 'SVG和动画GIF仅支持GPT Image 2.6 Sunburst或Flare。';
  if (format === 'svg' && kind !== 'image-generation') return 'SVG仅支持图片生成；图片编辑请使用PNG、JPEG、WebP或GIF。';
  if (format === 'svg' && (options.count ?? 1) !== 1) return '单次SVG生成仅支持1张；多张请拆成独立步骤。';
  if (format === 'gif' && options.size !== undefined && options.size !== 'auto') return '动画GIF当前使用auto帧尺寸。';
  if ((options.frameCount !== undefined || options.frameDurationMs !== undefined) && format !== 'gif') return '动画帧数和时长仅用于GIF输出。';
  if (options.frameCount !== undefined && (!Number.isInteger(options.frameCount) || options.frameCount < 2 || options.frameCount > 16)) return 'GIF帧数需要是2到16的整数；账户还需具有GIF预览权限。';
  if (options.frameDurationMs !== undefined && (!Number.isInteger(options.frameDurationMs) || options.frameDurationMs < 20 || options.frameDurationMs > 2000 || options.frameDurationMs % 10 !== 0)) return 'GIF每帧时长需要是20到2000毫秒、10的整数倍。';
  if (options.outputCompression !== undefined && (!['jpeg', 'webp'].includes(format) || !Number.isInteger(options.outputCompression) || options.outputCompression < 0 || options.outputCompression > 100)) return '输出压缩质量仅用于JPEG/WebP，需要为0到100的整数。';
  if (options.markupArtifactId !== undefined && (!modern || kind !== 'image-editing' || typeof options.markupArtifactId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(options.markupArtifactId))) return '标注图仅支持GPT Image 2.5/2.6图片编辑，请选择有效的本项目PNG标注图。';
  if ((options.svgModel !== undefined || options.svgReasoningEffort !== undefined) && format !== 'svg') return 'SVG作者模型与推理设置仅用于SVG输出。';
  if (options.svgModel !== undefined && (typeof options.svgModel !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(options.svgModel))) return 'SVG作者模型ID无效；留空使用账户默认作者模型。';
  if (options.svgReasoningEffort !== undefined && (!options.svgModel || !EFFORTS.includes(options.svgReasoningEffort))) return 'SVG作者推理设置需要先指定作者模型，且该设置须由作者模型支持。';
  if (options.background === 'transparent' && format === 'jpeg') return 'JPEG不支持透明背景，请选择PNG或WebP。';
  return undefined;
}

function imageOutputFields(options = {}) {
  const fields = { output_format: options.outputFormat ?? 'png' };
  for (const [source, target] of [['quality', 'quality'], ['complexity', 'complexity'], ['outputCompression', 'output_compression'], ['frameCount', 'frame_count'], ['frameDurationMs', 'frame_duration_ms']]) if (options[source] !== undefined) fields[target] = options[source];
  if (fields.output_format === 'gif') fields.size = 'auto';
  if (options.svgModel !== undefined) fields.svg = { model: options.svgModel, ...(options.svgReasoningEffort !== undefined ? { reasoning: { effort: options.svgReasoningEffort } } : {}) };
  return fields;
}

module.exports = { imageOptionsError, imageOutputFields };
