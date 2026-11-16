const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { checkedDirectory, checkedFile, atomicJson } = require('./workspace-paths.cjs');
const { imageType } = require('./image-output-formats.cjs');
const { validateAttachmentPayload, validateAttachmentPayloads, attachmentMetadata: legacyMetadata } = require('./chat-attachments-legacy.cjs');
const { assetProvenance } = require('./asset-provenance.cjs');

const MAX_COUNT = 8, MAX_FILE = 32 * 1024 * 1024, MAX_TOTAL = 80 * 1024 * 1024;
const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value);
const TYPES = { '.png': ['image/png', 'image'], '.jpg': ['image/jpeg', 'image'], '.jpeg': ['image/jpeg', 'image'], '.webp': ['image/webp', 'image'], '.pdf': ['application/pdf', 'office'], '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'office'], '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'office'], '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'office'], '.csv': ['text/csv', 'text'], '.txt': ['text/plain', 'text'], '.md': ['text/markdown', 'text'], '.json': ['application/json', 'text'] };
const hash = value => createHash('sha256').update(value).digest('hex');
function checkedScope(value) { if (!value || !validId(value.workspaceId) || !validId(value.conversationId)) throw Error('附件所属工作区或对话编号无效。'); return value; }
function validMetadata(value) {
  if (!(value && validId(value.id) && typeof value.name === 'string' && value.name.length > 0 && value.name.length <= 240 && !/[\\/\x00-\x1f]/.test(value.name) && TYPES[path.extname(value.name).toLowerCase()]?.[0] === value.mimeType && TYPES[path.extname(value.name).toLowerCase()]?.[1] === value.kind && Number.isSafeInteger(value.bytes) && value.bytes > 0 && value.bytes <= MAX_FILE && /^[a-f0-9]{64}$/.test(value.sha256 || '') && typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt)))) return false;
  try { assetProvenance(value.provenance); return true; } catch { return false; }
}
function validPublicMetadata(value) { return validMetadata(value) && Object.keys(value).every(key => ['id', 'name', 'mimeType', 'bytes', 'kind', 'sha256', 'createdAt', 'provenance'].includes(key)); }
function inspectBytes(name, buffer) {
  const type = TYPES[path.extname(name).toLowerCase()];
  if (!type) throw Error('聊天附件支持 PNG/JPEG/WebP、PDF、Word、PPT、Excel、CSV 和 UTF-8 文字；GIF/SVG 请先转换为静态PNG。');
  if (!buffer.length || buffer.length > MAX_FILE) throw Error('单份聊天附件需要非空且不超过32MB。');
  if (type[1] === 'image') { let actual; try { actual = imageType(buffer); } catch { throw Error('图片内容无法识别，请重新导出为PNG、JPEG或WebP。'); } if (actual.mimeType !== type[0]) throw Error('图片实际格式与文件名不一致，请按真实格式重新导出。'); }
  else if (type[0] === 'application/pdf' && buffer.subarray(0, 5).toString() !== '%PDF-') throw Error('这不是完整的PDF文件，请重新导出后添加。');
  else if (type[1] === 'office' && type[0] !== 'application/pdf' && (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50)) throw Error('Office附件需为有效的DOCX/PPTX/XLSX文件，不支持旧版或加密文件。');
  else if (type[1] === 'text') { try { const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); if (!text.trim() || text.includes('\u0000') || text.length > 100000) throw Error('text'); } catch { throw Error('文字附件需为非空UTF-8文字，单份最多10万字，请转换或拆分后添加。'); } }
  return { mimeType: type[0], kind: type[1] };
}
function backupBytes(value) {
  if (!validMetadata(value?.attachment)) throw Error('聊天附件备份元数据无效。');
  let buffer;
  if (value.buffer instanceof Uint8Array && value.data === undefined) buffer = Buffer.from(value.buffer.buffer, value.buffer.byteOffset, value.buffer.byteLength);
  else if (value.buffer === undefined && typeof value.data === 'string' && value.data.length <= Math.ceil(MAX_FILE / 3) * 4 + 4 && /^[A-Za-z0-9+/]*={0,2}$/.test(value.data)) { buffer = Buffer.from(value.data, 'base64'); if (buffer.toString('base64') !== value.data) throw Error('聊天附件备份编码无效。'); }
  else throw Error('聊天附件备份缺少有效原文件。');
  if (buffer.length !== value.attachment.bytes || hash(buffer) !== value.attachment.sha256) throw Error('聊天附件备份大小或哈希不一致。'); inspectBytes(value.attachment.name, buffer); return buffer;
}
const sameAttachment = (left, right) => ['id', 'name', 'mimeType', 'kind', 'bytes', 'sha256'].every(key => left[key] === right[key]) && JSON.stringify(left.provenance || null) === JSON.stringify(right.provenance || null);
function legacyFile(value, createdAt, existing) {
  validateAttachmentPayload(value);
  const buffer = Buffer.from(value.data, 'base64');
  const attachment = { id: value.id, name: value.name, ...inspectBytes(value.name, buffer), bytes: value.bytes, sha256: value.sha256, createdAt };
  if (existing && !sameAttachment(existing, attachment)) throw Error('当前对话已有不同内容或元数据的同编号附件，原文件没有被覆盖。');
  return { attachment: existing ? Object.fromEntries(Object.entries(existing).filter(([key]) => key !== 'projectCopies')) : attachment, buffer };
}
function legacyTurnValid(turn) {
  if (turn._attachments === undefined) return false;
  try {
    validateAttachmentPayloads(turn._attachments);
    return Array.isArray(turn.attachments) && turn.attachments.length === turn._attachments.length && turn.attachments.every((item, index) => item && Object.keys(item).length === 5 && Object.entries(legacyMetadata(turn._attachments[index])).every(([key, value]) => item[key] === value));
  } catch { return false; }
}
function upgradeLegacyRecord(record, existing = []) {
  const files = [], known = new Map(existing.map(item => [item.id, item]));
  for (const turn of record.turns) {
    if (turn._attachments === undefined) continue;
    if (!legacyTurnValid(turn)) throw Error('旧版聊天附件校验失败，原文件没有被覆盖。');
    const converted = turn._attachments.map(value => legacyFile(value, record.createdAt, known.get(value.id)));
    for (const file of converted) {
      const previous = files.find(item => item.attachment.id === file.attachment.id);
      if (previous && !sameAttachment(previous.attachment, file.attachment)) throw Error('旧版聊天包含内容不同的同编号附件，原文件没有被覆盖。');
      if (!previous) { files.push(file); known.set(file.attachment.id, file.attachment); }
    }
    turn.attachments = converted.map(file => file.attachment); delete turn._attachments;
  }
  return files;
}
function createChatAttachments({ directory, fileSystem = fs, extractText } = {}) {
  const root = path.join(directory, 'chat-v1');
  const copies = new Map(), legacyLoaded = new Set(), writes = new Map();
  function serial(scope, action) {
    checkedScope(scope); const key = `${scope.workspaceId}/${scope.conversationId}`, task = (writes.get(key) || Promise.resolve()).catch(() => undefined).then(action);
    writes.set(key, task); return task.finally(() => { if (writes.get(key) === task) writes.delete(key); });
  }
  const folder = scope => { checkedScope(scope); return path.join(root, scope.workspaceId, 'attachments', scope.conversationId); };
  const blob = (scope, item) => path.join(folder(scope), item.id + path.extname(item.name).toLowerCase());
  async function officeText(scope, item, buffer) {
    if (item.kind !== 'office' || item.mimeType === 'application/pdf' || !extractText) return undefined;
    const filename = path.join(folder(scope), `${item.id}.text.json`);
    try { const stat = await checkedFile(fileSystem, filename); if (stat.size > 512 * 1024) throw Error('cache'); const value = JSON.parse(await fileSystem.readFile(filename, 'utf8')); if (value.sourceSha256 === item.sha256 && typeof value.text === 'string' && value.text.length <= 100000 && value.sha256 === hash(Buffer.from(value.text))) return value.text; } catch { /* A derived text cache can be rebuilt from the verified original. */ }
    const text = await extractText({ ...item, buffer }); if (typeof text !== 'string' || !text.trim() || text.length > 100000) throw Error('Office附件正文为空或过长，请拆分后添加。');
    await atomicJson(fileSystem, filename, { version: 1, sourceSha256: item.sha256, text, sha256: hash(Buffer.from(text)) }); return text;
  }
  async function readIndex(scope) {
    const file = path.join(folder(scope), 'index.json'); let value;
    try { const stat = await checkedFile(fileSystem, file); if (stat.size > 8 * 1024 * 1024) throw Error('size'); value = JSON.parse(await fileSystem.readFile(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT' || /目录已不可用/.test(error.message)) return []; throw Error('附件索引无法可靠读取，原文件没有被覆盖。'); }
    if (value?.version !== 1 || value.workspaceId !== scope.workspaceId || value.conversationId !== scope.conversationId || !Array.isArray(value.items) || value.items.length > 2400 || value.items.some(item => !validMetadata(item)) || new Set(value.items.map(item => item.id)).size !== value.items.length) throw Error('附件索引格式无效，原文件没有被覆盖。');
    return value.items;
  }
  async function list(scope) {
    checkedScope(scope);
    const key = `${scope.workspaceId}/${scope.conversationId}`;
    if (!legacyLoaded.has(key)) await serial(scope, async () => {
      if (legacyLoaded.has(key)) return;
      const filename = path.join(directory, 'chat-attachments-v1', scope.workspaceId, `${scope.conversationId}.json`);
      let value, createdAt;
      try { const stat = await checkedFile(fileSystem, filename); if (stat.size > 30 * 1024 * 1024) throw Error('旧版聊天附件缓存超过读取上限。'); createdAt = new Date(stat.mtimeMs).toISOString(); value = JSON.parse(await fileSystem.readFile(filename, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT' && !/目录已不可用/.test(error.message)) throw Error('旧版聊天附件缓存无法读取，原文件没有被覆盖。'); }
      if (value) {
        if (value.version !== 1 || value.workspaceId !== scope.workspaceId || value.conversationId !== scope.conversationId || !Array.isArray(value.files) || value.files.length > 20 || new Set(value.files.map(file => file?.id)).size !== value.files.length || value.files.reduce((sum, file) => sum + (file?.bytes || 0), 0) > 20 * 1024 * 1024) throw Error('旧版聊天附件缓存格式无效，原文件没有被覆盖。');
        const known = new Map((await readIndex(scope)).map(item => [item.id, item]));
        await restoreFiles(scope, value.files.map(file => legacyFile(file, createdAt, known.get(file.id))));
      }
      legacyLoaded.add(key);
    });
    return readIndex(scope);
  }
  async function write(scope, items) {
    const value = { version: 1, workspaceId: scope.workspaceId, conversationId: scope.conversationId, items };
    if (Buffer.byteLength(JSON.stringify(value, null, 2) + '\n') > 8 * 1024 * 1024) throw Error('这段对话的材料索引已达到保存上限，请新建对话继续；原材料保留。');
    await atomicJson(fileSystem, path.join(folder(scope), 'index.json'), value);
  }
  async function read(scope, id) {
    if (!validId(id)) throw Error('附件编号无效。'); const item = (await list(scope)).find(item => item.id === id); if (!item) throw Error('附件不属于这段对话，请重新添加。');
    const filename = blob(scope, item), stat = await checkedFile(fileSystem, filename); if (stat.size !== item.bytes) throw Error('附件已变化或丢失，请重新添加，尚未调用模型。');
    const buffer = Buffer.from(await fileSystem.readFile(filename)); if (buffer.length !== item.bytes || hash(buffer) !== item.sha256) throw Error('附件内容校验失败，请重新添加，尚未调用模型。'); inspectBytes(item.name, buffer);
    const extractedText = await officeText(scope, item, buffer);
    return { ...item, buffer, filename, ...(extractedText !== undefined ? { extractedText } : {}) };
  }
  async function importPaths(scope, paths) {
    checkedScope(scope); if (!Array.isArray(paths) || !paths.length || paths.length > MAX_COUNT || paths.some(file => typeof file !== 'string' || !path.isAbsolute(file))) throw Error('一次最多添加8份本地附件。');
    const selected = []; let total = 0;
    for (const filename of paths) {
      const stat = await checkedFile(fileSystem, filename); if (!stat.size || stat.size > MAX_FILE || (total += stat.size) > MAX_TOTAL) throw Error('附件需要单份不超过32MB、合计不超过80MB。');
      const buffer = Buffer.from(await fileSystem.readFile(filename)); if (buffer.length !== stat.size) throw Error('选择期间文件已变化，请重新添加。');
      const name = path.basename(filename); if (!name || name.length > 240) throw Error('附件文件名过长。');
      selected.push({ buffer, item: { id: randomUUID(), name, ...inspectBytes(name, buffer), bytes: buffer.length, sha256: hash(buffer), createdAt: new Date().toISOString() } });
    }
    await list(scope); return serial(scope, () => saveSelected(scope, selected));
  }
  async function importBytes(scope, files) {
    checkedScope(scope);
    if (!Array.isArray(files) || !files.length || files.length > MAX_COUNT) throw Error('一次最多添加8份附件。');
    const selected = []; let total = 0;
    for (const file of files) {
      if (!file || typeof file.name !== 'string' || !file.name || file.name.length > 240 || /[\\/\x00-\x1f]/.test(file.name) || !(file.bytes instanceof Uint8Array) || !file.bytes.byteLength || file.bytes.byteLength > MAX_FILE || (total += file.bytes.byteLength) > MAX_TOTAL) throw Error('附件名称无效，或单份超过32MB、合计超过80MB。');
      const buffer = Buffer.from(file.bytes), type = inspectBytes(file.name, buffer);
      if (file.mimeType && file.mimeType !== type.mimeType && !(file.mimeType === 'image/jpg' && type.mimeType === 'image/jpeg')) throw Error('附件实际格式与声明不一致，请重新导出后添加。');
      const provenance = assetProvenance(file.provenance);
      selected.push({ buffer, item: { id: randomUUID(), name: file.name, ...type, bytes: buffer.length, sha256: hash(buffer), createdAt: new Date().toISOString(), ...(provenance ? { provenance } : {}) } });
    }
    await list(scope); return serial(scope, () => saveSelected(scope, selected));
  }
  async function saveSelected(scope, selected) {
    const existing = await readIndex(scope); if (existing.length + selected.length > 2400) throw Error('这段对话的附件较多，请新建对话继续。'); await checkedDirectory(fileSystem, folder(scope), true);
    const created = [];
    try {
      for (const value of selected) {
        if (value.item.kind === 'office' && value.item.mimeType !== 'application/pdf' && extractText) created.push(path.join(folder(scope), `${value.item.id}.text.json`));
        await officeText(scope, value.item, value.buffer); const filename = blob(scope, value.item); await fileSystem.writeFile(filename, value.buffer, { flag: 'wx' }); created.push(filename);
      }
      await write(scope, [...existing, ...selected.map(value => value.item)]); return selected.map(value => value.item);
    } catch (error) { for (const filename of created) { try { await fileSystem.unlink(filename); } catch { /* Only this import's unregistered files are considered for cleanup. */ } } throw error; }
  }
  async function restoreFiles(scope, files) {
    checkedScope(scope); const existing = await readIndex(scope), merged = new Map(existing.map(item => [item.id, item]));
    for (const value of files) {
      backupBytes(value);
      const old = merged.get(value.attachment.id); if (old && !sameAttachment(old, value.attachment)) throw Error('当前对话已有不同内容或元数据的同编号附件，未覆盖。'); merged.set(value.attachment.id, { ...value.attachment, ...(old?.projectCopies ? { projectCopies: old.projectCopies } : {}) });
    }
    if (merged.size > 2400) throw Error('恢复后这段对话的附件超过2400份保存上限，请新建对话继续；原材料和索引保留。');
    await checkedDirectory(fileSystem, folder(scope), true);
    for (const value of files) {
      const filename = blob(scope, value.attachment), buffer = backupBytes(value);
      try { await fileSystem.writeFile(filename, buffer, { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; const stat = await checkedFile(fileSystem, filename); if (stat.size !== buffer.length || hash(await fileSystem.readFile(filename)) !== value.attachment.sha256) throw Error('恢复目标已有不同内容附件，未覆盖。'); }
    }
    await write(scope, [...merged.values()]);
  }
  async function copyToProject(scope, ids, projectId, attachFiles, verify) {
    checkedScope(scope); if (!validId(projectId) || !Array.isArray(ids) || !ids.length || ids.length > MAX_COUNT || ids.some(id => !validId(id)) || new Set(ids).size !== ids.length || !attachFiles) throw Error('请选择有效的制作项目及本对话附件。');
    const available = await list(scope), selected = ids.map(id => available.find(item => item.id === id));
    if (selected.some(item => !item) || selected.reduce((sum, item) => sum + (item?.bytes || 0), 0) > MAX_TOTAL) throw Error('制作材料缺失或合计超过80MB，请重新选择。');
    const result = [];
    for (const id of ids) {
      const file = await read(scope, id), key = `${scope.workspaceId}/${scope.conversationId}/${id}/${projectId}`;
      let saved = copies.get(key) || file.projectCopies?.[projectId];
      if (saved && (!validId(saved.id) || saved.projectId !== projectId || saved.bytes !== file.bytes || saved.mimeType !== file.mimeType || verify && !await verify(projectId, saved, file))) saved = undefined;
      if (!saved) {
        const values = await attachFiles([file], projectId); saved = values?.[0];
        if (!saved || !validId(saved.id) || saved.projectId !== projectId || saved.bytes !== file.bytes || saved.mimeType !== file.mimeType) throw Error('附件复制尚未返回有效项目文件，原材料保留。');
        copies.set(key, saved);
      }
      const items = await list(scope), item = items.find(item => item.id === id); if (!item) throw Error('附件登记已变化，尚未继续制作。');
      item.projectCopies = { ...item.projectCopies, [projectId]: saved }; await write(scope, items); copies.delete(key); result.push(saved);
    }
    return result;
  }
  return { list, read, importPaths, importBytes, restore: (scope, files) => serial(scope, () => restoreFiles(scope, files)), copyToProject: async (...args) => { await list(args[0]); return serial(args[0], () => copyToProject(...args)); } };
}
module.exports = { createChatAttachments, legacyTurnValid, upgradeLegacyRecord, CHAT_ATTACHMENT_EXTENSIONS: Object.keys(TYPES).map(extension => extension.slice(1)), validMetadata, validPublicMetadata, inspectBytes, backupBytes, MAX_COUNT, MAX_FILE, MAX_TOTAL };
