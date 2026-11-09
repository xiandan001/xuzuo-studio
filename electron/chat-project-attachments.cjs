const { webcrypto } = require('node:crypto');
const { safeName } = require('./artifact-store.cjs');

const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(value);
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const hash = async bytes => Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes)).toString('hex');
const missing = error => error?.code ? ['ENOENT', 'ARTIFACT_TRASHED'].includes(error.code) : /找不到这份产物|这份产物已移至回收站|产物内容已在应用外改变/.test(error?.message || '');

function createChatProjectAttachments(artifactStore) {
  if (!artifactStore || !['listProject', 'read', 'write'].every(method => typeof artifactStore[method] === 'function')) throw TypeError('聊天转制作缺少受管项目文件接口。');
  const pending = new Map();
  function project(projectId) { if (!validId(projectId)) throw Error('请选择有效的保存项目。'); }
  async function matches(projectId, candidate, expected) {
    if (!candidate || !validId(candidate.id) || candidate.projectId !== projectId || candidate.trashedAt || candidate.name !== expected.name || candidate.mimeType !== expected.mimeType || candidate.bytes !== expected.bytes) return false;
    if (candidate.unavailable) {
      if (/原文件不在原位置|文件大小与登记不一致/.test(candidate.unavailableReason || '')) return false;
      throw Error('项目附件暂时无法安全读取，请恢复文件或目录权限后重试；没有重复复制。');
    }
    let file;
    try { file = await artifactStore.read(candidate.id); }
    catch (error) { if (missing(error)) return false; throw error; }
    if (!file || file.id !== candidate.id || file.projectId !== projectId || file.trashedAt || file.name !== expected.name || file.mimeType !== expected.mimeType || file.bytes !== expected.bytes || !(file.buffer instanceof Uint8Array) || file.buffer.byteLength !== expected.bytes) return false;
    return await hash(file.buffer) === expected.sha256;
  }
  async function attach(files, projectId) {
    if (!Array.isArray(files) || files.length > 8) throw Error('一次最多带入8份聊天附件。');
    const prepared = []; let bytes = 0;
    for (const file of files) {
      if (!file || !(file.buffer instanceof Uint8Array) || !file.buffer.byteLength || file.buffer.byteLength > 32 * 1024 * 1024 || typeof file.mimeType !== 'string' || typeof file.name !== 'string' || file.bytes !== undefined && file.bytes !== file.buffer.byteLength) throw Error('聊天附件内容无效或超过32MB，尚未写入项目。');
      bytes += file.buffer.byteLength; if (bytes > 80 * 1024 * 1024) throw Error('聊天附件合计超过80MB，尚未写入项目。');
      const sha256 = await hash(file.buffer);
      if (file.sha256 !== undefined && file.sha256 !== sha256) throw Error('聊天附件内容已改变，请重新读取原附件后再制作。');
      prepared.push({ file, name: safeName(file.name, file.mimeType), mimeType: file.mimeType, bytes: file.buffer.byteLength, sha256 });
    }
    const results = [];
    let registered = await artifactStore.listProject(projectId);
    for (const expected of prepared) {
      const candidates = registered.filter(item => !item.trashedAt && item.name === expected.name && item.mimeType === expected.mimeType && item.bytes === expected.bytes).slice(0, 8);
      let selected;
      for (const candidate of candidates) if (await matches(projectId, candidate, expected)) { selected = candidate; break; }
      if (!selected) {
        selected = await artifactStore.write({ projectId, name: expected.name, mimeType: expected.mimeType, buffer: expected.file.buffer, preserveOriginalName: true });
        registered = [selected, ...registered];
      }
      results.push({ ...selected, sha256: expected.sha256 });
    }
    return results;
  }
  return {
    async attachFiles(files, projectId) {
      project(projectId);
      const task = (pending.get(projectId) || Promise.resolve()).catch(() => undefined).then(() => attach(files, projectId));
      pending.set(projectId, task);
      try { return await task; } finally { if (pending.get(projectId) === task) pending.delete(projectId); }
    },
    async verifyProjectAttachment(projectId, metadata, source = metadata) {
      project(projectId);
      if (!metadata || metadata.projectId !== projectId || !validId(metadata.id) || !source || typeof source.name !== 'string' || typeof source.mimeType !== 'string' || !Number.isSafeInteger(source.bytes) || source.bytes <= 0 || !validHash(source.sha256)) return false;
      if (metadata.name !== safeName(source.name, source.mimeType) || metadata.mimeType !== source.mimeType || metadata.bytes !== source.bytes || metadata.sha256 !== undefined && metadata.sha256 !== source.sha256) return false;
      const candidates = await artifactStore.listProject(projectId), registered = candidates.find(item => item.id === metadata.id);
      return matches(projectId, registered, { name: safeName(source.name, source.mimeType), mimeType: source.mimeType, bytes: source.bytes, sha256: source.sha256 });
    },
  };
}

module.exports = { createChatProjectAttachments };
