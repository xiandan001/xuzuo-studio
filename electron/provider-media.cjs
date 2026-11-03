const { ModelRuntimeError, endpoint, failure, checkedUrl, ensureActive, progress, request: httpRequest, jsonRequest, readLimited, normalizedUsage } = require('./provider-http.cjs');
const { combinedText, IMAGE_TYPES } = require('./provider-text.cjs');

const MAX_MEDIA_BYTES = 32 * 1024 * 1024;

function imageType(bytes) {
  if (bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR' && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0 && bytes.toString('ascii', bytes.length - 8, bytes.length - 4) === 'IEND') return { mimeType: 'image/png', extension: 'png' };
  if (bytes.length >= 8 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217) return { mimeType: 'image/jpeg', extension: 'jpg' };
  if (bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.readUInt32LE(4) + 8 === bytes.length) return { mimeType: 'image/webp', extension: 'webp' };
  throw failure('INVALID_IMAGE', '供应商返回的内容不是可识别的 PNG、JPEG 或 WebP 图片。');
}

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
  const response = await httpRequest(fetchImpl, url.toString(), { method: 'GET', headers: { accept: 'image/png,image/jpeg,image/webp' } }, context, false);
  return readLimited(response, MAX_MEDIA_BYTES, context);
}

function mediaFields(request, files, context) {
  const images = files.filter(file => IMAGE_TYPES.has(file.mimeType));
  const prompt = combinedText(request, files);
  if (!prompt) throw failure('EMPTY_INPUT', '图片步骤需要填写画面描述或修改要求。', context);
  const count = request.options.count || 1;
  const fields = { model: request.model.modelId, prompt, n: count, output_format: 'png' };
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

async function executeImages(request, files, context, fetchImpl, saveArtifact) {
  const { fields, images } = mediaFields(request, files, context);
  const headers = { authorization: `Bearer ${context.secret}` };
  let body;
  let route;
  if (request.kind === 'image-editing') {
    route = 'images/edits'; body = new FormData();
    for (const [key, value] of Object.entries(fields)) body.append(key, String(value));
    for (const image of images) body.append('image[]', new Blob([image.buffer], { type: image.mimeType }), image.name);
  } else { route = 'images/generations'; headers['content-type'] = 'application/json'; body = JSON.stringify(fields); }
  const data = await jsonRequest(fetchImpl, endpoint(request.connection.baseUrl, route), { method: 'POST', headers, body }, context);
  const usage = normalizedUsage(data, context);
  completeImageUsage(usage, request);
  if (!Array.isArray(data.data) || !data.data.length || data.data.length > 4) throw failure('EMPTY_OUTPUT', '图片接口没有返回有效图片列表。', context, { usage });
  const artifacts = [];
  usage.images = data.data.length;
  try {
    for (let index = 0; index < data.data.length; index++) {
      ensureActive(context);
      const bytes = await imageBytes(data.data[index], context, fetchImpl);
      const type = imageType(bytes);
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
  return { text, artifacts, usage };
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
