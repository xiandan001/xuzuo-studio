const { createHash } = require('node:crypto');
const core = require('./animation-document.runtime.cjs');
const { checkedAnimationRecord } = require('./animation-store.cjs');
const revisionName = /^revision-([1-9]\d*)-([a-f0-9]{64})(?:-[a-f0-9-]+)?\.json$/;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const isAnimationOpaquePath = relative => /(?:^|\/)\.xuzuo\/animation-before-restore-[a-f0-9-]{36}\.json$/i.test(relative) || /(?:^|\/)\.xuzuo\/animation-revisions-v1\/index-invalid-[a-f0-9-]{36}\.json$/i.test(relative);
const isAnimationPath = relative => typeof relative === 'string' && /(?:^|\/)\.xuzuo\/animation-v1\.json$/.test(relative) || typeof relative === 'string' && /(?:^|\/)\.xuzuo\/animation-revisions-v1\/(?:index-v1|revision-[1-9]\d*-[a-f0-9]{64}(?:-[a-f0-9-]+)?)\.json$/.test(relative);

function checkedIndex(value, projectId) {
  if (!value || value.version !== 1 || !core.animationId(value.projectId) || projectId && value.projectId !== projectId || !Number.isSafeInteger(value.highWater) || value.highWater < 0 || !Array.isArray(value.entries) || value.entries.length > 10000 || new Set(value.entries.map(row => row.revision)).size !== value.entries.length) throw Error('动画备份历史索引无效或不属于当前项目。');
  const entries = value.entries.map(row => { const match = revisionName.exec(row.fileName || ''); if (!match || !Number.isSafeInteger(row.revision) || row.revision < 1 || row.revision > value.highWater || Number(match[1]) !== row.revision || match[2] !== row.hash || typeof row.committed !== 'boolean') throw Error('动画备份历史索引的文件或哈希无效。'); return { revision: row.revision, fileName: row.fileName, hash: row.hash, committed: row.committed }; });
  return { version: 1, projectId: value.projectId, highWater: value.highWater, entries };
}
function validateAnimationBackup(value, relative, projectId) {
  if (!isAnimationPath(relative)) return false;
  const name = relative.split('/').at(-1);
  if (name === 'index-v1.json') checkedIndex(value, projectId);
  else if (name === 'animation-v1.json') checkedAnimationRecord(value, projectId || value.projectId);
  else { const match = revisionName.exec(name), record = checkedAnimationRecord(value?.record, projectId || value?.projectId); if (!match || value.version !== 1 || value.projectId !== record.projectId || value.hash !== hash(record) || match[2] !== value.hash || Number(match[1]) !== record.revision) throw Error('动画备份独立修订的项目、版本或内部哈希无效。'); }
  return true;
}
function remapDocument(input, ids) {
  const document = core.checkedAnimationDocument(input), map = value => Object.hasOwn(ids, value) ? ids[value] : value;
  return core.checkedAnimationDocument({ ...document, projectId: map(document.projectId), referenceArtifactIds: document.referenceArtifactIds.map(map), entries: document.entries.map(entry => ({ ...entry, frames: entry.frames.map(frame => ({ ...frame, atlasArtifactId: map(frame.atlasArtifactId) })), ...(entry.outputArtifactId ? { outputArtifactId: map(entry.outputArtifactId) } : {}), ...(entry.coverArtifactId ? { coverArtifactId: map(entry.coverArtifactId) } : {}), sourceHash: undefined, renderedHash: undefined, inspection: undefined, status: entry.frames.length ? 'stale' : 'draft', error: undefined })) });
}
function remapAnimationBackup(input, ids, relative) {
  if (!isAnimationPath(relative)) return input;
  validateAnimationBackup(input, relative); const map = value => Object.hasOwn(ids, value) ? ids[value] : value, name = relative.split('/').at(-1);
  if (name === 'index-v1.json') return { ...checkedIndex(input), projectId: map(input.projectId) };
  if (name === 'animation-v1.json') { const record = checkedAnimationRecord(input, input.projectId); return { ...record, projectId: map(record.projectId), document: remapDocument(record.document, ids), history: [] }; }
  const record = checkedAnimationRecord(input.record, input.projectId), remapped = { ...record, projectId: map(record.projectId), document: remapDocument(record.document, ids) };
  return { version: 1, projectId: remapped.projectId, hash: hash(remapped), record: remapped };
}
module.exports = { isAnimationPath, isAnimationOpaquePath, validateAnimationBackup, remapAnimationBackup };
