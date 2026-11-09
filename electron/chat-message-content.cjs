const { failure } = require('./provider-http.cjs');
const { extractReferenceText } = require('./reference-text.cjs');

const IMAGES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const OFFICE = new Set(['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
const textType = type => type.startsWith('text/') || type === 'application/json';
const MAX_FILE = 32 * 1024 * 1024, MAX_FILES = 80 * 1024 * 1024, MAX_TEXT = 200000;
let officeTasks;
const dataUrl = file => `data:${file.mimeType};base64,${Buffer.from(file.buffer).toString('base64')}`;
const name = file => typeof file.name === 'string' ? file.name.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 160) : '未命名附件';

function checkedFiles(input, messages) {
  if (!Array.isArray(messages) || !messages.length || messages.length > 60) throw failure('INVALID_INPUT', '聊天上下文无效或过长，请新建对话后继续。');
  let bytes = 0, pdfBytes = 0, count = 0;
  const result = messages.map(message => {
    if (!message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || message.content.length > MAX_TEXT) throw failure('INVALID_INPUT', '聊天消息不是有效的文字与附件内容。');
    const files = message.attachments || [];
    if (!Array.isArray(files) || files.length > 8 || files.length && message.role !== 'user') throw failure('INVALID_ATTACHMENTS', '每条用户消息最多添加8份附件，回复不能冒充用户附件。');
    return { message, files: files.map(file => {
      if (!file || !(file.buffer instanceof Uint8Array) || !file.buffer.byteLength || file.buffer.byteLength > MAX_FILE || typeof file.mimeType !== 'string') throw failure('INVALID_ATTACHMENTS', '附件为空、超过32MB或未能可靠读取，请重新添加。');
      const type = file.mimeType.split(';')[0].trim().toLowerCase();
      if (!IMAGES.has(type) && type !== 'application/pdf' && !textType(type) && !OFFICE.has(type)) throw failure('UNSUPPORTED_ATTACHMENT', '聊天暂不直接读取这个附件格式；GIF或SVG请先转换为静态PNG，音视频请使用相应工作台。');
      if ((IMAGES.has(type) || type === 'application/pdf') && !input.model?.capabilities?.includes('vision')) throw failure('CAPABILITY_MISMATCH', '本轮包含图片或PDF，请先选择支持“看图”的文字模型，再发送。');
      if (type === 'application/pdf' && input.connection?.protocol === 'openai-chat' && input.connection.providerId !== 'openai') throw failure('UNSUPPORTED_ATTACHMENT', '当前兼容聊天接口尚未适配PDF输入，请选择OpenAI原生接口、Claude或Gemini，或先转换为文字版。');
      bytes += file.buffer.byteLength; count++; if (type === 'application/pdf') pdfBytes += file.buffer.byteLength;
      return { ...file, mimeType: type };
    }) };
  });
  if (bytes > MAX_FILES) throw failure('ATTACHMENT_TOO_LARGE', '本轮含历史附件的总量超过80MB，请减少附件或新建对话。');
  if (['openai-chat', 'openai-responses'].includes(input.connection?.protocol) && pdfBytes >= 50 * 1024 * 1024) throw failure('ATTACHMENT_TOO_LARGE', '当前OpenAI接口的PDF文件合计需要小于50MB，请拆分后发送。');
  if (input.connection?.protocol === 'gemini' && pdfBytes > 50 * 1024 * 1024) throw failure('ATTACHMENT_TOO_LARGE', '当前Gemini对话的PDF合计超过50MB，请拆分后发送。');
  if (input.connection?.protocol === 'anthropic' && count > 100) throw failure('ATTACHMENT_TOO_LARGE', '本轮含历史附件的数量过多，请新建对话后发送。');
  return result;
}
function preparedText(file) {
  if (!textType(file.mimeType) && !OFFICE.has(file.mimeType)) return undefined;
  if (typeof file.extractedText === 'string') {
    if (!file.extractedText.trim() || file.extractedText.length > 100000) throw failure('INVALID_ATTACHMENTS', '附件提取后的文字为空或超过10万字，请拆分后重新添加。');
    return file.extractedText;
  }
  if (OFFICE.has(file.mimeType)) throw failure('ATTACHMENTS_NOT_PREPARED', 'Office附件尚未完成本地正文读取，请稍候再发送。');
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(file.buffer).replace(/^\uFEFF/, '');
    if (!text.trim() || text.length > 100000) throw Error();
    return text;
  } catch { throw failure('INVALID_ATTACHMENTS', '文字附件为空、不是有效UTF-8或超过10万字，请转换后重新添加。'); }
}
function messageText(message, files) {
  const extracted = files.map(file => { const value = preparedText(file); return value === undefined ? '' : `【用户提供的附件：${name(file)}】\n${value}`; }).filter(Boolean);
  return [message.content, ...extracted].filter(Boolean).join('\n\n');
}
function messageParts(protocol, message, files) {
  const text = messageText(message, files);
  const binary = files.filter(file => IMAGES.has(file.mimeType) || file.mimeType === 'application/pdf');
  if (!binary.length) return { text, content: text, geminiParts: [{ text }] };
  const image = file => IMAGES.has(file.mimeType);
  if (protocol === 'openai-responses') return { text, content: [...binary.map(file => image(file) ? { type: 'input_image', image_url: dataUrl(file) } : { type: 'input_file', filename: name(file), file_data: dataUrl(file) }), ...(text ? [{ type: 'input_text', text }] : [])] };
  if (protocol === 'openai-chat') return { text, content: [...binary.map(file => image(file) ? { type: 'image_url', image_url: { url: dataUrl(file) } } : { type: 'file', file: { filename: name(file), file_data: dataUrl(file) } }), ...(text ? [{ type: 'text', text }] : [])] };
  if (protocol === 'anthropic') return { text, content: [...binary.map(file => ({ type: image(file) ? 'image' : 'document', source: { type: 'base64', media_type: file.mimeType, data: Buffer.from(file.buffer).toString('base64') } })), ...(text ? [{ type: 'text', text }] : [])] };
  return { text, geminiParts: [...binary.map(file => ({ inlineData: { mimeType: file.mimeType, data: Buffer.from(file.buffer).toString('base64') } })), ...(text ? [{ text }] : [])] };
}
function chatMessageContent(input, messages) {
  const protocol = input.connection?.protocol, checked = checkedFiles(input, messages);
  let length = 0;
  return checked.map(({ message, files }) => {
    const parts = messageParts(protocol, message, files); length += parts.text.length;
    if (length > MAX_TEXT) throw failure('INVALID_INPUT', '合并附件后的上下文超过20万字，请精简或新建对话。');
    return protocol === 'gemini' ? { role: message.role === 'assistant' ? 'model' : 'user', parts: parts.geminiParts } : { role: message.role, content: parts.content };
  });
}
async function prepareChatMessages(input, messages, { loadModule = require, extractText, signal } = {}) {
  const checked = checkedFiles(input, messages), result = [];
  for (const { message, files } of checked) {
    if (!files.length) { result.push(message); continue; }
    const attachments = [];
    for (const file of files) {
      if (signal?.aborted) throw failure('CANCELLED', '附件读取已取消，尚未向模型发送请求。');
      let extractedText;
      try {
        if (typeof file.extractedText === 'string') extractedText = preparedText(file);
        else if (OFFICE.has(file.mimeType)) {
          officeTasks ||= require('./cpu-tasks.cjs').createCpuTasks();
          extractedText = await (extractText ? extractText(file) : officeTasks.run('reference-text', { name: file.name, mimeType: file.mimeType, buffer: file.buffer }, { signal }));
        } else extractedText = await extractReferenceText(file, loadModule);
      } catch (cause) {
        throw failure(signal?.aborted ? 'CANCELLED' : 'INVALID_ATTACHMENTS', signal?.aborted ? '附件读取已取消，尚未向模型发送请求。' : `附件“${name(file)}”未能读取：${cause.message || '请另存为文字版后重新添加。'}`);
      }
      attachments.push({ ...file, ...(extractedText === null || extractedText === undefined ? {} : { extractedText }) });
    }
    result.push({ ...message, attachments });
  }
  if (result.reduce((length, message) => length + messageText(message, message.attachments || []).length, 0) > MAX_TEXT) throw failure('INVALID_INPUT', '合并附件后的上下文超过20万字，请精简或新建对话。');
  return result;
}

module.exports = { prepareChatMessages, chatMessageContent };
