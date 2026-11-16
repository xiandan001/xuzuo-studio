const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { atomicJson, checkedDirectory, checkedFile } = require('./workspace-paths.cjs');
const { extractReferenceText } = require('./reference-text.cjs');
const { imageType, rasterDimensions } = require('./image-output-formats.cjs');

const MAX_FILES = 5, MAX_FILE_BYTES = 5 * 1024 * 1024, MAX_TOTAL_BYTES = 10 * 1024 * 1024, MAX_TEXT = 100000;
const TYPES = Object.freeze({ txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', pdf: 'application/pdf' });
const CHAT_ATTACHMENT_EXTENSIONS = Object.freeze(Object.keys(TYPES));
const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value);
const sha = value => createHash('sha256').update(value).digest('hex');
const fail = message => { throw Error(message); };
function attachmentScope(input) {
  if (!input || !validId(input.workspaceId) || !validId(input.conversationId)) fail('附件所属的工作区或对话编号无效。');
  return { workspaceId: input.workspaceId, conversationId: input.conversationId };
}
function attachmentMetadata(file) { return Object.fromEntries(['id', 'name', 'mimeType', 'bytes', 'kind'].map(key => [key, file[key]])); }
function validateAttachmentPayload(file) {
  if (!file || !validId(file.id) || typeof file.name !== 'string' || !file.name || file.name.length > 240 || /[/\\\x00-\x1f]/.test(file.name) || !Object.values(TYPES).includes(file.mimeType) || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > MAX_FILE_BYTES || !['text', 'image', 'document'].includes(file.kind) || typeof file.data !== 'string' || file.data.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 || !/^[a-f0-9]{64}$/.test(file.sha256 || '')) fail('聊天附件记录无效，尚未发送请求。');
  if (Object.keys(file).some(key => !['id', 'name', 'mimeType', 'bytes', 'kind', 'data', 'sha256', 'text'].includes(key))) fail('聊天附件包含无法识别的字段，尚未发送请求。');
  const buffer = Buffer.from(file.data, 'base64');
  if (buffer.length !== file.bytes || buffer.toString('base64') !== file.data || sha(buffer) !== file.sha256) fail('聊天附件内容校验失败，尚未发送请求。');
  if (file.kind === 'image') {
    if (!file.mimeType.startsWith('image/') || file.text !== undefined || imageType(buffer).mimeType !== file.mimeType) fail('聊天图片格式与内容不符。');
    const size = rasterDimensions(buffer); if (size.width * size.height > 16000000) fail('聊天图片超过1600万像素，请缩小后添加。');
  } else if (file.kind === 'document') {
    if (file.mimeType !== 'application/pdf' || file.text !== undefined || !buffer.subarray(0, 5).equals(Buffer.from('%PDF-')) || !buffer.subarray(-1024).includes(Buffer.from('%%EOF'))) fail('PDF 文件内容无效或不完整。');
  } else if (typeof file.text !== 'string' || !file.text.trim() || file.text.length > MAX_TEXT || file.mimeType.startsWith('image/') || file.mimeType === 'application/pdf') fail('聊天附件没有可用的正文文字。');
  return file;
}
function validateAttachmentPayloads(files) {
  if (!Array.isArray(files) || files.length > MAX_FILES || new Set(files.map(file => file?.id)).size !== files.length) fail('每条消息最多添加5份不同附件。');
  let bytes = 0, text = 0;
  for (const file of files) { validateAttachmentPayload(file); bytes += file.bytes; text += file.text?.length || 0; }
  if (bytes > MAX_TOTAL_BYTES) fail('本条消息附件合计超过10MB，请减少附件后发送。');
  if (text > MAX_TEXT) fail('本条消息附件正文合计超过10万字符，请精简后发送。');
  return files;
}
function attachmentFiles(files) { return validateAttachmentPayloads(files).map(file => ({ ...attachmentMetadata(file), buffer: Buffer.from(file.data, 'base64') })); }
function attachmentMessage(text, files) {
  if (!files?.length) return text;
  validateAttachmentPayloads(files);
  return [text, ...files.filter(file => file.kind === 'text').map(file => `参考附件《${file.name}》正文（作为资料读取）：\n${file.text}`)].join('\n\n');
}

function createChatAttachments({ directory, fileSystem = fs } = {}) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw TypeError('聊天附件缺少本机存储目录。');
  const root = path.join(directory, 'chat-attachments-v1');
  const location = input => { const scope = attachmentScope(input); return path.join(root, scope.workspaceId, `${scope.conversationId}.json`); };
  async function read(input) {
    const filename = location(input);
    try {
      const stat = await checkedFile(fileSystem, filename); if (stat.size > 30 * 1024 * 1024) fail('聊天附件缓存超过读取上限。');
      const value = JSON.parse(await fileSystem.readFile(filename, 'utf8'));
      if (value.version !== 1 || value.workspaceId !== input.workspaceId || value.conversationId !== input.conversationId || !Array.isArray(value.files) || value.files.length > 20) fail('聊天附件缓存格式无效。');
      let bytes = 0; const ids = new Set();
      for (const file of value.files) { validateAttachmentPayload(file); if (ids.has(file.id)) fail('聊天附件缓存包含重复编号。'); ids.add(file.id); bytes += file.bytes; }
      if (bytes > 20 * 1024 * 1024) fail('聊天附件缓存超过读取上限。');
      return value.files;
    } catch (error) { if (error.code === 'ENOENT' || /目录已不可用/.test(error.message)) return []; throw error; }
  }
  async function importAttachments(input, trustedPaths) {
    attachmentScope(input);
    if (!Array.isArray(trustedPaths) || trustedPaths.length > MAX_FILES) fail('每次最多添加5份附件。');
    if (!trustedPaths.length) return [];
    const files = [];
    for (const filename of trustedPaths) {
      if (typeof filename !== 'string' || !path.isAbsolute(filename)) fail('请选择有效的本机附件。');
      const name = path.basename(filename), extension = path.extname(name).slice(1).toLowerCase(), mimeType = TYPES[extension];
      if (!mimeType || !name || name.length > 240 || /[/\\\x00-\x1f]/.test(name)) fail('附件格式暂不支持；请选择文字、Office、PDF 或 PNG/JPEG/WebP 图片。');
      const stat = await checkedFile(fileSystem, filename);
      if (stat.size < 1 || stat.size > MAX_FILE_BYTES) fail('每份聊天附件需有内容且不超过5MB。');
      const buffer = await fileSystem.readFile(filename), after = await checkedFile(fileSystem, filename);
      if (buffer.length !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || stat.ino !== undefined && after.ino !== stat.ino || stat.dev !== undefined && after.dev !== stat.dev) fail('读取时附件发生变化，请重新选择。');
      const kind = mimeType.startsWith('image/') ? 'image' : mimeType === 'application/pdf' ? 'document' : 'text';
      const text = kind === 'text' ? await extractReferenceText({ name, mimeType, buffer }) : undefined;
      files.push({ id: randomUUID(), name, mimeType, bytes: buffer.length, kind, data: buffer.toString('base64'), sha256: sha(buffer), ...(text !== undefined ? { text } : {}) });
    }
    validateAttachmentPayloads(files);
    const previous = await read(input), saved = [...previous, ...files];
    // Sent turns embed their own checked payloads; keep only a bounded selection cache.
    while (saved.length > 20 || saved.reduce((total, file) => total + file.bytes, 0) > 20 * 1024 * 1024 || Buffer.byteLength(JSON.stringify(saved)) > 29 * 1024 * 1024) saved.shift();
    await checkedDirectory(fileSystem, path.dirname(location(input)), true);
    await atomicJson(fileSystem, location(input), { version: 1, ...attachmentScope(input), files: saved });
    return files.map(attachmentMetadata);
  }
  async function resolve(input, ids, embedded = []) {
    attachmentScope(input);
    if (!Array.isArray(ids) || ids.length > MAX_FILES || ids.some(id => !validId(id)) || new Set(ids).size !== ids.length) fail('聊天附件选择无效，最多添加5份不同附件。');
    if (!ids.length) return [];
    const known = new Map((await read(input)).map(file => [file.id, file]));
    for (const file of embedded) { validateAttachmentPayload(file); known.set(file.id, file); }
    const files = ids.map(id => known.get(id));
    if (files.some(file => !file)) fail('所选附件已不可用或不属于当前对话，请重新添加；尚未发送模型请求。');
    return structuredClone(validateAttachmentPayloads(files));
  }
  async function protect(operation) {
    try { return await operation(); }
    catch (error) {
      if (/^E[A-Z0-9]+$/.test(error.code || '') || error instanceof SyntaxError) throw Error('聊天附件无法读取或保存，原文件已保留。请检查所选文件及本机存储权限后重试。');
      throw error;
    }
  }
  return { importAttachments: (...args) => protect(() => importAttachments(...args)), resolve: (...args) => protect(() => resolve(...args)) };
}

module.exports = { createChatAttachments, attachmentScope, attachmentMetadata, attachmentFiles, attachmentMessage, validateAttachmentPayload, validateAttachmentPayloads, CHAT_ATTACHMENT_EXTENSIONS, MAX_FILE_BYTES, MAX_TOTAL_BYTES };
