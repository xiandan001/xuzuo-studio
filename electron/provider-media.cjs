const { ModelRuntimeError, endpoint, failure, checkedUrl, ensureActive, progress, request: httpRequest, jsonRequest, readLimited, normalizedUsage } = require('./provider-http.cjs');
const { combinedText } = require('./provider-text.cjs');
const { imageType, validateGif } = require('./image-output-formats.cjs');
const { imageOptionsError, imageOutputFields } = require('./image-output-options.cjs');

const MAX_MEDIA_BYTES = 32 * 1024 * 1024;

const RASTER_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function decodeImage(value, context) {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_MEDIA_BYTES * 4 / 3) + 100 || !/^[A-Za-z0-9+/\r\n]+={0,2}$/.test(value)) throw failure('INVALID_IMAGE', '供应商返回的图片编码无效或文件过大。', context);
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.length || bytes.length > MAX_MEDIA_BYTES) throw failure('INVALID_IMAGE', '供应商返回的图片为空或超过文件大小上限。', context);
  return bytes;
}

async function imageBytes(item, context, fetchImpl) {
  if (typeof item?.b64_json === 'string') return decodeImage(item.b64_json, context);
  if (typeof item?.url !== 'string') throw failure('INVALID_IMAGE', '供应商没有返回图片数据或下载地址。', context);
  const url = checkedUrl(item.url);
  const response = await httpRequest(fetchImpl, url.toString(), { method: 'GET', headers: { accept: 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml' } }, context, false);
  return readLimited(response, MAX_MEDIA_BYTES, context);
}

function mediaFields(request, files, context) {
  const invalid = imageOptionsError(request.model.modelId, request.kind, request.options);
  if (invalid) throw failure('INVALID_OPTIONS', invalid, context);
  if (request.kind === 'image-editing' && files.some(file => ['image/gif', 'image/svg+xml'].includes(file.mimeType))) throw failure('INVALID_IMAGE_INPUT', '图片编辑只支持PNG、JPEG或WebP参考图片，请先转换SVG或GIF。', context);
  const images = files.filter(file => RASTER_TYPES.has(file.mimeType));
  if (request.kind === 'image-editing') for (const image of images) {
    let actual;
    try { actual = imageType(image.buffer); } catch (error) { throw failure('INVALID_IMAGE_INPUT', error.message, context); }
    if (!RASTER_TYPES.has(actual.mimeType) || actual.mimeType !== image.mimeType) throw failure('INVALID_IMAGE_INPUT', '参考图实际格式与登记类型不一致，请重新导入PNG、JPEG或WebP。', context);
  }
  const prompt = combinedText(request, files);
  if (!prompt) throw failure('EMPTY_INPUT', '图片步骤需要填写画面描述或修改要求。', context);
  const count = request.options.count || 1;
  const fields = { model: request.model.modelId, prompt, n: count, ...imageOutputFields(request.options) };
  if (request.options.size) fields.size = request.options.size;
  if (request.options.background) fields.background = request.options.background;
  if (request.kind === 'image-editing' && !images.length) throw failure('MISSING_IMAGE', '图片编辑步骤需要至少一张本机参考图片。', context);
  return { fields, images };
}

function completeImageUsage(usage, request) {
  if (request.kind !== 'image-generation') return;
  let completed = false;
  if (usage.inputTokens !== undefined && usage.inputTextTokens === undefined && usage.inputImageTokens === undefined) {
    usage.inputTextTokens = usage.inputTokens;
    usage.inputImageTokens = 0;
    completed = true;
  }
  if (usage.outputTokens !== undefined && usage.outputImageTokens === undefined && usage.outputTextTokens === undefined) {
    usage.outputImageTokens = usage.outputTokens;
    usage.outputTextTokens = 0;
    completed = true;
  }
  if (completed) usage.usageSource = 'provider-reported+request-shape';
}

async function executeImages(request, files, context, fetchImpl, saveArtifact, markup) {
  if (request.options.markupArtifactId && !markup) throw failure('INVALID_MARKUP', '尚未加载所选PNG标注层，未发送图片编辑请求。', context);
  const { fields, images } = mediaFields(request, files, context);
  const headers = { authorization: `Bearer ${context.secret}` };
  let body;
  let route;
  if (request.kind === 'image-editing') {
    route = 'images/edits'; body = new FormData();
    for (const [key, value] of Object.entries(fields)) body.append(key, String(value));
    for (const image of images) body.append('image[]', new Blob([image.buffer], { type: image.mimeType }), image.name);
    if (markup) body.append('markup', new Blob([markup.buffer], { type: markup.mimeType }), markup.name);
  } else { route = 'images/generations'; headers['content-type'] = 'application/json'; body = JSON.stringify(fields); }
  const data = await jsonRequest(fetchImpl, endpoint(request.connection.baseUrl, route), { method: 'POST', headers, body }, context);
  const usage = normalizedUsage(data, context);
  usage.imageOutputFormat = fields.output_format;
  completeImageUsage(usage, request);
  if (!Array.isArray(data.data) || !data.data.length || data.data.length > 4) throw failure('EMPTY_OUTPUT', '图片接口没有返回有效图片列表。', context, { usage });
  const artifacts = [];
  const animationNotes = [];
  usage.images = data.data.length;
  try {
    for (let index = 0; index < data.data.length; index++) {
      ensureActive(context);
      const bytes = await imageBytes(data.data[index], context, fetchImpl);
      let type;
      try { type = imageType(bytes); if (type.mimeType === 'image/gif') validateGif(bytes); } catch (error) { throw failure('INVALID_IMAGE', error.message, context); }
      const expected = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', gif: 'image/gif' }[fields.output_format];
      if (type.mimeType !== expected) throw failure('IMAGE_FORMAT_MISMATCH', '供应商返回的实际图片格式与请求不一致，未伪装为所选格式保存；请核对本次用量。', context);
      if (fields.output_format === 'gif' && type.frames !== (fields.frame_count ?? 9)) animationNotes.push(`第${index + 1}份GIF请求${fields.frame_count ?? 9}帧，返回${type.frames}帧；已保留实际动画，未自动重发。`);
      progress(context, 'saving', `正在保存第 ${index + 1} 张真实图片。`);
      artifacts.push(await saveArtifact({ name: `image-${index + 1}.${type.extension}`, mimeType: type.mimeType, buffer: bytes }));
    }
  } catch (error) {
    const retained = error instanceof ModelRuntimeError ? error : failure('RESULT_SAVE_FAILED', '图片结果下载或保存未完成，已保存文件保留，未自动补做；请核对账单。', context);
    retained.requestStarted = context.requestStarted;
    retained.providerRequestId ||= context.providerRequestId;
    retained.usage = { ...usage, ...retained.usage };
    retained.artifacts = [...artifacts];
    throw retained;
  }
  const requested = request.options.count || 1;
  const text = artifacts.length < requested ? `请求 ${requested} 张，实际保存 ${artifacts.length} 张。数量不足，需人工决定是否补做；补做另计费用。` : artifacts.length > requested ? `请求 ${requested} 张，实际保存 ${artifacts.length} 张。返回数量与请求不同，请人工核对成品与费用。` : `已生成并保存 ${artifacts.length} 张图片。`;
  return { text: [text, ...animationNotes].join('\n'), artifacts, usage };
}

function audioType(response, bytes, context) {
  if (response.headers.get('content-type')?.includes('json')) throw failure('INVALID_AUDIO', '语音接口返回 JSON 错误内容，没有生成音频文件。', context);
  if (bytes.length >= 16 && bytes.toString('ascii', 0, 3) === 'ID3') return { mimeType: 'audio/mpeg', extension: 'mp3' };
  if (bytes.length >= 16 && bytes[0] === 255 && (bytes[1] & 224) === 224) return (bytes[1] & 6) === 0 ? { mimeType: 'audio/aac', extension: 'aac' } : { mimeType: 'audio/mpeg', extension: 'mp3' };
  if (bytes.length >= 44 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE') return { mimeType: 'audio/wav', extension: 'wav' };
  if (bytes.length >= 28 && bytes.toString('ascii', 0, 4) === 'OggS') return { mimeType: 'audio/ogg', extension: 'ogg' };
  if (bytes.length >= 38 && bytes.toString('ascii', 0, 4) === 'fLaC') return { mimeType: 'audio/flac', extension: 'flac' };
  throw failure('INVALID_AUDIO', '语音接口没有返回可识别的音频文件。', context);
}

async function executeAudio(request, files, context, fetchImpl, saveArtifact) {
  const headers = { authorization: `Bearer ${context.secret}` };
  if (request.kind === 'speech') {
    const input = request.input?.trim() || request.prompt?.trim();
    if (!input || input.length > 4096) throw failure('INVALID_SPEECH_INPUT', '语音合成需要 1 到 4096 个字符，请将长文分成多个明确步骤。', context);
    headers['content-type'] = 'application/json';
    const response = await httpRequest(fetchImpl, endpoint(request.connection.baseUrl, 'audio/speech'), { method: 'POST', headers, body: JSON.stringify({ model: request.model.modelId, input, voice: request.options.voice || 'alloy', response_format: 'mp3' }) }, context);
    const bytes = await readLimited(response, MAX_MEDIA_BYTES, context);
    const type = audioType(response, bytes, context);
    progress(context, 'saving', '正在保存真实语音文件。');
    const artifact = await saveArtifact({ name: `speech.${type.extension}`, mimeType: type.mimeType, buffer: bytes });
    return { text: '语音文件已生成并保存。', artifacts: [artifact], usage: normalizedUsage({}, context) };
  }
  const audioFiles = files.filter(file => file.mimeType.startsWith('audio/') || file.mimeType === 'video/mp4');
  if (audioFiles.length !== 1) throw failure('MISSING_AUDIO', '语音识别步骤需要且仅需要一份音频文件。', context);
  if (audioFiles[0].buffer.length > 25 * 1024 * 1024) throw failure('AUDIO_TOO_LARGE', '单次语音识别音频不能超过 25 MB，请先拆分音频。', context);
  const body = new FormData();
  body.append('file', new Blob([audioFiles[0].buffer], { type: audioFiles[0].mimeType }), audioFiles[0].name);
  body.append('model', request.model.modelId);
  body.append('response_format', 'json');
  const data = await jsonRequest(fetchImpl, endpoint(request.connection.baseUrl, 'audio/transcriptions'), { method: 'POST', headers, body }, context);
  const usage = normalizedUsage(data, context);
  if (typeof data.text !== 'string' || !data.text.trim()) throw failure('EMPTY_OUTPUT', '语音识别没有返回有效文字，未将调用标记为成功。', context, { usage });
  progress(context, 'saving', '正在保存真实转写文字。');
  const text = data.text.split(context.secret).join('[已隐藏凭证]');
  const artifact = await saveArtifact({ name: 'transcription.txt', mimeType: 'text/plain', text });
  return { text, artifacts: [artifact], usage };
}

module.exports = { executeImages, executeAudio, imageType };
