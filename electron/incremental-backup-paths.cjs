const fsDefault = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { checkedDirectory, inside } = require('./workspace-paths.cjs');

const PART_BYTES = 16 * 1024 * 1024, READ_BYTES = 256 * 1024;
const MAX_FILE = 100 * 1024 * 1024, MAX_TOTAL = 16 * 1024 * 1024 * 1024, MAX_FILES = 50000, MAX_METADATA = 32 * 1024 * 1024;
function metadataLimitError() { const error = Error('备份管理索引超过可用预算，本次快照未完成；原资料、费用和上次成功快照保留，请按工作区分别备份。'); error.code = 'BACKUP_METADATA_LIMIT'; return error; }
function metadataBytes(value, maximum = MAX_METADATA) {
  if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > MAX_METADATA) throw Error('备份索引预算无效。');
  let bytes = 0;
  const add = count => { bytes += count; if (bytes > maximum) throw metadataLimitError(); };
  const text = string => {
    add(2);
    for (let index = 0; index < string.length; index++) {
      const code = string.charCodeAt(index);
      if (code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13) add(2);
      else if (code < 32) add(6);
      else if (code < 128) add(1);
      else if (code < 2048) add(2);
      else if (code >= 0xd800 && code <= 0xdbff && string.charCodeAt(index + 1) >= 0xdc00 && string.charCodeAt(index + 1) <= 0xdfff) { add(4); index++; }
      else add(code >= 0xd800 && code <= 0xdfff ? 6 : 3);
    }
  };
  const skipped = item => item === undefined || typeof item === 'function' || typeof item === 'symbol';
  function visit(item, depth = 0) {
    if (depth > 100) throw Error('备份管理索引层级超过限制。');
    if (item === null || skipped(item)) { add(4); return; }
    if (typeof item === 'string') { text(item); return; }
    if (typeof item === 'boolean') { add(item ? 4 : 5); return; }
    if (typeof item === 'number') { add(Number.isFinite(item) ? String(item).length : 4); return; }
    if (typeof item !== 'object') throw Error('备份管理索引含不支持的数据。');
    add(2); let count = 0;
    if (Array.isArray(item)) for (const child of item) { if (count++) add(1); visit(child, depth + 1); }
    else for (const name of Object.keys(item)) { const child = item[name]; if (skipped(child)) continue; if (count++) add(1); text(name); add(1); visit(child, depth + 1); }
  }
  visit(value); return bytes;
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const aborted = () => Object.assign(new Error('本次备份已取消，已有备份和原文件保留。'), { name: 'AbortError' });
function active(signal) { if (signal?.aborted) throw aborted(); }
async function yieldToInteraction(signal, yieldBackground) { active(signal); if (yieldBackground) await yieldBackground({ signal }); active(signal); }
function sameFile(before, after) { return ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every(name => before[name] === after[name]); }
async function ordinaryFile(fs, filename, maximum = MAX_FILE) {
  await checkedDirectory(fs, path.dirname(filename)); const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum || path.resolve(await fs.realpath(filename)).toLowerCase() !== path.resolve(filename).toLowerCase()) throw Error('备份文件不是普通文件、路径已变化或超过大小限制。');
  return stat;
}
async function readChunks(fs, filename, onChunk, { signal, yieldBackground, maximum = MAX_FILE } = {}) {
  const before = await ordinaryFile(fs, filename, maximum), handle = await fs.open(filename, 'r'), bytes = Buffer.allocUnsafe(READ_BYTES);
  let position = 0;
  try {
    if (!sameFile(before, await handle.stat())) throw Error('备份文件在打开时发生变化，原文件保留。');
    for (;;) {
      await yieldToInteraction(signal, yieldBackground);
      const result = await handle.read(bytes, 0, Math.min(bytes.length, maximum - position + 1), position);
      if (!result.bytesRead) break;
      position += result.bytesRead; if (position > maximum) throw Error('备份文件超过大小限制。');
      await onChunk(bytes.subarray(0, result.bytesRead));
    }
    if (position !== before.size || !sameFile(before, await handle.stat()) || !sameFile(before, await ordinaryFile(fs, filename, maximum))) throw Error('备份期间文件发生变化，请保存编辑后再备份。');
  } finally { await handle.close(); }
  return before;
}
async function fileIdentity(fs, filename, options) {
  const hash = createHash('sha256'); let bytes = 0;
  await readChunks(fs, filename, chunk => { bytes += chunk.length; hash.update(chunk); }, options);
  return { bytes, sha256: hash.digest('hex') };
}
async function freeSpace(fs, directory, bytes) {
  if (typeof fs.statfs !== 'function') return;
  const value = await fs.statfs(directory), available = Number(value.bavail) * Number(value.bsize);
  if (!Number.isFinite(available) || available < bytes + 32 * 1024 * 1024) throw Error('备份或恢复位置空间不足，请更换位置；原文件和已有快照保留。');
}
async function readJson(fs, filename, maximum = MAX_METADATA) {
  const chunks = []; let length = 0;
  await readChunks(fs, filename, chunk => { length += chunk.length; chunks.push(Buffer.from(chunk)); }, { maximum });
  const bytes = Buffer.concat(chunks, length);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw Error('备份索引不是有效的 UTF-8 JSON。'); }
}
function childPath(root, ...parts) {
  const filename = path.resolve(root, ...parts);
  if (!inside(root, filename) || path.resolve(root) === filename) throw Error('备份文件位置超出受管目录。');
  return filename;
}
function sourceInfo(value) {
  if (Buffer.isBuffer(value)) return { bytes: value.length, sha256: digest(value) };
  if (value?.kind === 'xuzuo-stream-file' && Number.isSafeInteger(value.bytes) && /^[a-f0-9]{64}$/.test(value.sha256) && typeof value.readBytes === 'function' && typeof value.copyTo === 'function') return { bytes: value.bytes, sha256: value.sha256 };
  throw Error('备份文件读取来源无效。');
}
async function sourceBytes(value) {
  if (Buffer.isBuffer(value)) return value;
  sourceInfo(value); const bytes = await value.readBytes();
  if (!Buffer.isBuffer(bytes) || bytes.length !== value.bytes || digest(bytes) !== value.sha256) throw Error('备份文件的实际字节与哈希不一致。');
  return bytes;
}
async function copySource(fs, source, destination, options) {
  if (!Buffer.isBuffer(source)) { sourceInfo(source); return source.copyTo(destination, options); }
  await checkedDirectory(fs, path.dirname(destination), true); await fs.writeFile(destination, source, { flag: 'wx' });
  const saved = await fileIdentity(fs, destination, options);
  if (saved.bytes !== source.length || saved.sha256 !== digest(source)) throw Error('恢复文件写入核验失败，保留独立副本供检查。');
}
function sourceFromPath(fs, filename, expected, options = {}) {
  if (!Number.isSafeInteger(expected.bytes) || expected.bytes < 0 || expected.bytes > MAX_FILE || !/^[a-f0-9]{64}$/.test(expected.sha256)) throw Error('备份资料的大小或哈希无效。');
  async function consume(onChunk, overrides = {}) {
    const hash = createHash('sha256'); let bytes = 0;
    await readChunks(fs, filename, async chunk => { bytes += chunk.length; hash.update(chunk); await onChunk(chunk); }, { ...options, ...overrides });
    if (bytes !== expected.bytes || hash.digest('hex') !== expected.sha256) throw Error('备份资料实际字节已改变，未使用过期内容。');
  }
  return {
    kind: 'xuzuo-stream-file', path: filename, bytes: expected.bytes, sha256: expected.sha256,
    async readBytes() { const chunks = []; await consume(chunk => { chunks.push(Buffer.from(chunk)); }); return Buffer.concat(chunks, expected.bytes); },
    async copyTo(destination, overrides) {
      await checkedDirectory(fs, path.dirname(destination), true); await freeSpace(fs, path.dirname(destination), expected.bytes); const output = await fs.open(destination, 'wx');
      try { await consume(async chunk => { let offset = 0; while (offset < chunk.length) { const result = await output.write(chunk, offset); if (!result.bytesWritten) throw Error('备份资料未能完整写入。'); offset += result.bytesWritten; } }, overrides); await output.sync(); } finally { await output.close(); }
      const actual = await fileIdentity(fs, destination, { ...options, ...overrides });
      if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) throw Error('恢复资料写入后的哈希不一致。');
    },
  };
}
module.exports = { fsDefault, PART_BYTES, READ_BYTES, MAX_FILE, MAX_TOTAL, MAX_FILES, MAX_METADATA, metadataBytes, metadataLimitError, digest, active, aborted, yieldToInteraction, sameFile, ordinaryFile, readChunks, fileIdentity, freeSpace, readJson, childPath, sourceInfo, sourceBytes, copySource, sourceFromPath };
