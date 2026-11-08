const { createHash } = require('node:crypto');
const { validId, checkedCommerceDocument } = require('./commerce-image-document.cjs');
const idFields = new Set(['id', 'projectId', 'sourceArtifactId', 'documentId', 'artifactId', 'snapshotId', 'workingDocumentId', 'protectedMaskArtifactId', 'protectionSourceArtifactId']);
const snapshot = /^revision-(\d+)-([a-f0-9]{64})(?:-[a-f0-9-]+)?\.json$/;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const mapped = (value, ids) => { const next = ids instanceof Map ? ids.get(value) : Object.hasOwn(ids || {}, value) ? ids[value] : undefined; return typeof next === 'string' ? next : value; };
function isCommerceImagePath(relative) { return typeof relative === 'string' && /(?:^|\/)\.xuzuo\/commerce-images\//.test(relative.replaceAll('\\', '/')); }
function isCommerceOpaquePath(relative) { return isCommerceImagePath(relative) && /\/(?:commerce-image-before-restore|index-invalid)-[a-f0-9-]+\.json$/.test(relative.replaceAll('\\', '/')); }
function checkedRecord(value) {
  if (!value || value.version !== 1 || !validId(value.projectId) || !validId(value.sourceArtifactId) || !validId(value.documentId) || !Number.isSafeInteger(value.revision) || value.revision < 1 || typeof value.savedAt !== 'string') throw Error('备份中的图层保存记录格式无效。');
  const document = checkedCommerceDocument(value.document);
  if (document.projectId !== value.projectId || document.sourceArtifactId !== value.sourceArtifactId || document.id !== value.documentId || document.revision !== value.revision) throw Error('备份中的图层工程来源不一致。');
  return value;
}
function validateCommerceImageBackup(value, relative = '') {
  if (value?.type === 'xuzuo-commerce-image') { checkedCommerceDocument(value); return true; }
  if (!isCommerceImagePath(relative)) return false;
  const name = relative.replaceAll('\\', '/').split('/').at(-1);
  if (name === 'default-v1.json') {
    if (value?.type !== 'commerce-default' || value.version !== 1 || !['projectId', 'sourceArtifactId', 'documentId'].every(key => validId(value[key]))) throw Error('备份默认图层指针无效。');
  } else if (/\/exports\//.test(relative.replaceAll('\\', '/'))) {
    if (value?.version !== 1 || !['projectId', 'artifactId', 'snapshotId', 'workingDocumentId'].every(key => validId(value[key])) || name !== `${value.artifactId}.json`) throw Error('备份成品回编辑关联无效。');
  } else if (name === 'index-v1.json') {
    if (value?.version !== 1 || !validId(value.projectId) || !Number.isSafeInteger(value.highWater) || value.highWater < 0 || !Array.isArray(value.entries) || value.entries.some(entry => !Number.isSafeInteger(entry.revision) || entry.revision < 1 || !snapshot.test(entry.fileName) || !/^[a-f0-9]{64}$/.test(entry.hash) || typeof entry.committed !== 'boolean')) throw Error('备份图层历史索引无效。');
  } else if (value?.record) {
    checkedRecord(value.record);
    if (value.version !== 1 || value.projectId !== value.record.projectId || value.hash !== digest(value.record)) throw Error('备份图层历史快照校验失败。');
  } else checkedRecord(value);
  return true;
}
function remapCommerceImage(value, ids, relative = '') {
  if (!validateCommerceImageBackup(value, relative)) return value;
  function visit(input) {
    if (Array.isArray(input)) return input.map(visit);
    if (!input || typeof input !== 'object') return input;
    const output = {};
    for (const [key, entry] of Object.entries(input)) output[key] = idFields.has(key) && typeof entry === 'string' ? mapped(entry, ids) : visit(entry);
    return output;
  }
  const result = visit(value);
  if (result.record) result.hash = digest(result.record);
  if (/\/exports\//.test(relative.replaceAll('\\', '/'))) result.requiresReexport = true;
  return result;
}
function renamedCommercePath(relative, ids, remappedValue) {
  if (!isCommerceImagePath(relative)) return relative;
  const parts = relative.replaceAll('\\', '/').split('/'), start = parts.indexOf('commerce-images');
  if (start < 0 || parts.some(part => part === '..' || part === '')) throw Error('图层备份路径无效。');
  if (parts[start + 1] === 'exports') { const name = parts[start + 2]; if (!name?.endsWith('.json')) throw Error('图层回编辑文件名无效。'); parts[start + 2] = mapped(name.slice(0, -5), ids) + '.json'; }
  else { parts[start + 1] = mapped(parts[start + 1], ids); if (parts[start + 2] !== 'default-v1.json') parts[start + 2] = mapped(parts[start + 2], ids); }
  const name = parts.at(-1), match = snapshot.exec(name);
  if (match && remappedValue?.record) parts[parts.length - 1] = `revision-${remappedValue.record.revision}-${digest(remappedValue.record)}.json`;
  return parts.join('/');
}
module.exports = { isCommerceImagePath, isCommerceOpaquePath, validateCommerceImageBackup, remapCommerceImage, renamedCommercePath };
