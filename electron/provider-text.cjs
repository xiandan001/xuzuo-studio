const { endpoint, failure, jsonRequest, normalizedUsage } = require('./provider-http.cjs');
const { createBillingRequestSnapshot } = require('./billing-request-shape.cjs');
const { reasoningRequestFields } = require('./reasoning-options.cjs');
const { PDF, pdfInputIssue } = require('./production-pdf.cjs');

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const TEXT_TYPES = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/xml']);
const RESPONSE_FILE_TYPES = new Set(['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);

function combinedText(request, attachments) {
  const sections = [request.prompt, request.input].filter(value => typeof value === 'string' && value.trim()).map(value => value.trim());
  for (const file of attachments.filter(item => TEXT_TYPES.has(item.mimeType) || item.mimeType.startsWith('text/'))) sections.push(`参考文件 ${file.name}：\n${file.buffer.toString('utf8')}`);
  return sections.join('\n\n');
}

function dataUrl(file) { return `data:${file.mimeType};base64,${file.buffer.toString('base64')}`; }

function ensureFilesSupported(attachments, protocol, context, kind) {
  for (const file of attachments) {
    if (IMAGE_TYPES.has(file.mimeType) || TEXT_TYPES.has(file.mimeType) || file.mimeType.startsWith('text/')) continue;
    if (protocol === 'openai-responses' && RESPONSE_FILE_TYPES.has(file.mimeType)) continue;
    if (file.mimeType === 'application/pdf' && ['openai-chat', 'anthropic', 'gemini'].includes(protocol)) continue;
    if (file.mimeType === 'video/mp4' && protocol === 'gemini' && kind === 'video-understanding') continue;
    throw failure('UNSUPPORTED_ATTACHMENT', '此文字接口暂不支持所选附件格式，请先转换为文字、图片或 PDF。', context);
  }
}

function contentFor(protocol, text, files) {
  const images = files.filter(file => IMAGE_TYPES.has(file.mimeType));
  const documents = files.filter(file => RESPONSE_FILE_TYPES.has(file.mimeType));
  const videos = protocol === 'gemini' ? files.filter(file => file.mimeType === 'video/mp4') : [];
  if (protocol === 'openai-chat') return [{ type: 'text', text }, ...images.map(file => ({ type: 'image_url', image_url: { url: dataUrl(file) } })), ...documents.map(file => ({ type: 'file', file: { filename: file.name, file_data: dataUrl(file) } }))];
  if (protocol === 'openai-responses') return [{ type: 'input_text', text }, ...images.map(file => ({ type: 'input_image', image_url: dataUrl(file) })), ...documents.map(file => ({ type: 'input_file', filename: file.name, file_data: dataUrl(file) }))];
  if (protocol === 'anthropic') return [...images.map(file => ({ type: 'image', source: { type: 'base64', media_type: file.mimeType, data: file.buffer.toString('base64') } })), ...documents.map(file => ({ type: 'document', source: { type: 'base64', media_type: file.mimeType, data: file.buffer.toString('base64') } })), { type: 'text', text }];
  return [{ text }, ...[...images, ...documents, ...videos].map(file => ({ inlineData: { mimeType: file.mimeType, data: file.buffer.toString('base64') } }))];
}

function textRequest(request, files, context) {
  const protocol = request.connection.protocol;
  const pdfIssue = pdfInputIssue(request.connection, request.model, files);
  if (pdfIssue) throw failure('UNSUPPORTED_ATTACHMENT', pdfIssue, context);
  if (request.kind === 'text') files = files.filter(file => file.mimeType === PDF || TEXT_TYPES.has(file.mimeType) || file.mimeType.startsWith('text/'));
  if (request.kind === 'vision') {
    const hadVideo = files.some(file => file.mimeType.startsWith('video/'));
    files = files.filter(file => !file.mimeType.startsWith('video/'));
    if (hadVideo && !files.some(file => IMAGE_TYPES.has(file.mimeType) || RESPONSE_FILE_TYPES.has(file.mimeType))) throw failure('VIDEO_REQUIRES_VIDEO_STEP', '视频附件需要选择 Gemini 原生的视频理解步骤；图像理解只发送图片或文档。', context);
  }
  if (request.kind === 'video-understanding') {
    const videos = files.filter(file => file.mimeType === 'video/mp4');
    if (protocol !== 'gemini' || videos.length !== 1) throw failure('MISSING_VIDEO', 'Gemini 视频理解需要且仅需要一份本机 MP4 文件。', context);
    require('./provider-video.cjs').inspectMp4(videos[0].buffer, context);
    files = files.filter(file => file.mimeType === 'video/mp4' || TEXT_TYPES.has(file.mimeType) || file.mimeType.startsWith('text/'));
  }
  ensureFilesSupported(files, protocol, context, request.kind);
  const text = combinedText(request, files);
  if (!text) throw failure('EMPTY_INPUT', '请提供提示词、输入文字或可读取的参考文件。', context);
  if (text.length > 200_000) throw failure('INVALID_INPUT', '合并参考文件后的文字超过 200000 字符，请先缩小输入范围。', context);
  const content = contentFor(protocol, text, files);
  const maxTokens = request.options.maxOutputTokens || 4096;
  const headers = { 'content-type': 'application/json' };
  let url;
  let body;
  if (protocol === 'openai-chat') {
    url = endpoint(request.connection.baseUrl, 'chat/completions');
    headers.authorization = `Bearer ${context.secret}`;
    const messageContent = content.length === 1 && content[0].type === 'text' ? text : content;
    body = { model: request.model.modelId, messages: [{ role: 'user', content: messageContent }], stream: false, [request.connection.providerId === 'openai' ? 'max_completion_tokens' : 'max_tokens']: maxTokens };
    if (request.connection.providerId === 'openai') body.store = false;
    if (request.connection.providerId === 'minimax') body.reasoning_split = true;
  } else if (protocol === 'openai-responses') {
    url = endpoint(request.connection.baseUrl, 'responses');
    headers.authorization = `Bearer ${context.secret}`;
    body = { model: request.model.modelId, input: [{ role: 'user', content }], max_output_tokens: maxTokens, store: false, stream: false };
  } else if (protocol === 'anthropic') {
    url = endpoint(request.connection.baseUrl, /\/v1\/?$/.test(request.connection.baseUrl) ? 'messages' : 'v1/messages');
    headers['x-api-key'] = context.secret;
    headers['anthropic-version'] = '2023-06-01';
    body = { model: request.model.modelId, max_tokens: maxTokens, messages: [{ role: 'user', content }], stream: false };
  } else if (protocol === 'gemini') {
    const modelId = request.model.modelId.replace(/^models\//, '');
    url = endpoint(request.connection.baseUrl, `models/${encodeURIComponent(modelId)}:generateContent`);
    headers['x-goog-api-key'] = context.secret;
    body = { contents: [{ role: 'user', parts: content }], generationConfig: { maxOutputTokens: maxTokens } };
  } else throw failure('UNSUPPORTED_PROTOCOL', '此协议没有可执行的文字适配器。', context);
  const effortFields = reasoningRequestFields(request.connection, request.model, request.options.reasoningEffort);
  body = { ...body, ...effortFields, ...(body.generationConfig ? { generationConfig: { ...body.generationConfig, ...(effortFields.generationConfig || {}) } } : {}) };
  const serialized = JSON.stringify(body);
  if (Buffer.byteLength(serialized, 'utf8') > 112 * 1024 * 1024) throw failure('ATTACHMENT_TOO_LARGE', '编码后的文档请求过大，请拆分资料后制作。', context);
  if (request.kind === 'video-understanding' && Buffer.byteLength(serialized, 'utf8') >= 20 * 1024 * 1024) throw failure('VIDEO_TOO_LARGE', 'Gemini 内联视频的完整请求需要小于 20 MB，请先压缩或裁剪 MP4。', context);
  return { url, options: { method: 'POST', headers, body: serialized }, billingRequestSnapshot: createBillingRequestSnapshot(request, body) };
}

function outputText(data, protocol, context) {
  let text = '';
  let incomplete = false;
  let refused = false;
  if (protocol === 'openai-chat') {
    const message = data.choices?.[0]?.message;
    text = typeof message?.content === 'string' ? message.content : (message?.content || []).filter(part => part.type === 'text').map(part => part.text || '').join('\n');
    const reason = data.choices?.[0]?.finish_reason;
    refused = Boolean(message?.refusal) || reason === 'content_filter';
    incomplete = reason !== 'stop';
  } else if (protocol === 'openai-responses') {
    if (typeof data.output_text === 'string') text = data.output_text;
    else text = (data.output || []).filter(item => item.type === 'message').flatMap(item => item.content || []).filter(part => part.type === 'output_text').map(part => part.text || '').join('\n');
    refused = (data.output || []).some(item => (item.content || []).some(part => part.type === 'refusal')) || data.incomplete_details?.reason === 'content_filter';
    incomplete = data.status !== 'completed' || (data.output || []).some(item => item.type === 'function_call' || item.type === 'computer_call' || item.type === 'message' && item.status && item.status !== 'completed');
  } else if (protocol === 'anthropic') {
    text = (data.content || []).filter(part => part.type === 'text').map(part => part.text || '').join('\n');
    refused = data.stop_reason === 'refusal';
    incomplete = !['end_turn', 'stop_sequence'].includes(data.stop_reason);
  } else if (protocol === 'gemini') {
    const candidate = data.candidates?.[0];
    text = (candidate?.content?.parts || []).filter(part => typeof part.text === 'string' && !part.thought).map(part => part.text).join('\n');
    refused = Boolean(data.promptFeedback?.blockReason) || ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY', 'IMAGE_PROHIBITED_CONTENT', 'IMAGE_RECITATION'].includes(candidate?.finishReason);
    incomplete = candidate?.finishReason !== 'STOP';
  }
  const usage = normalizedUsage(data, context);
  const partialText = context.secret ? text.trim().split(context.secret).join('[已隐藏凭证]') : text.trim();
  if (refused) throw failure('PROVIDER_REFUSAL', '模型拒绝或过滤了本次结果，未作为完整成品，未自动重试。', context, { usage, partialText });
  if (incomplete) throw failure('INCOMPLETE_OUTPUT', '模型未完整生成结果，可能达到上限或仍需继续处理；已保留返回片段与用量，未自动重试。', context, { usage, partialText });
  if (!text.trim()) throw failure('EMPTY_OUTPUT', '模型未返回可用文字，未将本次调用标记为成功；请检查返回状态和模型能力。', context, { usage });
  return { text: partialText, usage };
}

async function executeText(request, files, context, fetchImpl) {
  const prepared = textRequest(request, files, context);
  const billingRequestSnapshot = prepared.billingRequestSnapshot;
  try {
    const data = await jsonRequest(fetchImpl, prepared.url, prepared.options, context);
    return { ...outputText(data, request.connection.protocol, context), ...(billingRequestSnapshot ? { billingRequestSnapshot } : {}) };
  } catch (error) {
    if (billingRequestSnapshot) error.billingRequestSnapshot = billingRequestSnapshot;
    throw error;
  }
}

module.exports = { executeText, combinedText, IMAGE_TYPES, TEXT_TYPES };
