const { createHash } = require('node:crypto');
const { inspectZip } = require('./backup-format.cjs');
const core = require('./animation-document.runtime.cjs');
const { imageType } = require('./image-output-formats.cjs');
const hash = value => createHash('sha256').update(value).digest('hex');
async function exportAnimationProject(document, entries, artifactStore) {
  const Zip = require('jszip'), zip = new Zip(), sources = [], ids = new Set([...document.referenceArtifactIds, ...entries.flatMap(entry => entry.frames.map(frame => frame.atlasArtifactId))]); let total = 0;
  if (ids.size > 200) throw Error('工程包含较多源图，请选部分条目分批导出。');
  for (const id of ids) { const file = await artifactStore.read(id); if (file.projectId !== document.projectId || file.trashedAt || file.unavailable || !['image/png', 'image/jpeg', 'image/webp'].includes(file.mimeType)) throw Error('有工程源图不可用，未导出不完整工程。'); if ((total += file.buffer.length) > 90 * 1024 * 1024) throw Error('工程源图超过90MB，请选部分条目分批导出。'); const name = `sources/${id}.${imageType(file.buffer).extension}`; zip.file(name, file.buffer); sources.push({ id, name, mimeType: file.mimeType, bytes: file.buffer.length, sha256: hash(file.buffer) }); }
  const selectedIds = new Set(entries.map(entry => entry.id));
  const saved = core.checkedAnimationDocument({ ...document, entries: entries.map(entry => ({ ...entry, status: entry.frames.length ? 'stale' : 'draft', outputArtifactId: undefined, coverArtifactId: undefined, renderedHash: undefined, inspection: undefined })), acceptedSampleId: selectedIds.has(document.acceptedSampleId) ? document.acceptedSampleId : undefined });
  zip.file('project.json', JSON.stringify({ kind: 'xuzuo-animation-project', version: 1, document: saved, sources }, null, 2) + '\n');
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE', streamFiles: true });
  return artifactStore.write({ name: `${document.title}-可编辑动画工程.zip`, mimeType: 'application/zip', buffer, projectId: document.projectId });
}
async function importAnimationProject({ projectId, artifactId, expectedRevision }, { artifactStore, store }) {
  const source = await artifactStore.read(artifactId);
  if (source.projectId !== projectId || source.mimeType !== 'application/zip' || source.trashedAt || source.unavailable || source.buffer.length > 100 * 1024 * 1024) throw Error('请选择当前项目导入的角色动画工程ZIP（100MB以内）。');
  inspectZip(source.buffer); const Zip = require('jszip'), zip = await Zip.loadAsync(source.buffer, { checkCRC32: false, createFolders: false });
  const manifest = zip.file('project.json'); if (!manifest || manifest._data.uncompressedSize > 4 * 1024 * 1024) throw Error('动画工程缺少有效清单。');
  const value = JSON.parse(await manifest.async('string'));
  if (value?.kind !== 'xuzuo-animation-project' || value.version !== 1 || !Array.isArray(value.sources) || value.sources.length > 200 || new Set(value.sources.map(row => row.id)).size !== value.sources.length) throw Error('角色动画工程清单无效。');
  const original = core.checkedAnimationDocument(value.document), allowed = new Set(['project.json', ...value.sources.map(row => row.name)]), buffers = new Map(); let total = 0;
  if (Object.values(zip.files).some(file => !file.dir && (!allowed.has(file.name) || file.unsafeOriginalName && file.unsafeOriginalName !== file.name))) throw Error('动画工程包含清单以外的文件或不安全路径。');
  for (const item of value.sources) { const file = zip.file(item.name); if (!core.animationId(item.id) || !/^sources\/[A-Za-z0-9-]+\.(png|jpg|webp)$/.test(item.name) || !file || file._data.uncompressedSize !== item.bytes || !Number.isSafeInteger(item.bytes) || item.bytes < 1 || item.bytes > 32 * 1024 * 1024 || (total += item.bytes) > 90 * 1024 * 1024) throw Error('动画工程源图清单无效或过大。'); const buffer = await file.async('nodebuffer'); if (hash(buffer) !== item.sha256 || imageType(buffer).mimeType !== item.mimeType) throw Error('动画工程源图实际内容与清单不一致。'); buffers.set(item.id, { ...item, buffer }); }
  const current = await store.read({ projectId }); if (current.revision !== expectedRevision) throw Error('当前动画工程已更新，未覆盖；请重新读取后导入。');
  for (const id of new Set([...original.referenceArtifactIds, ...original.entries.flatMap(entry => entry.frames.map(frame => frame.atlasArtifactId))])) if (!buffers.has(id)) throw Error('动画工程有缺失的源图引用。');
  const ids = new Map(); for (const item of buffers.values()) ids.set(item.id, (await artifactStore.write({ name: '导入角色源图.' + imageType(item.buffer).extension, mimeType: item.mimeType, buffer: item.buffer, projectId })).id);
  const document = core.checkedAnimationDocument({ ...original, projectId, revision: expectedRevision, acceptedSampleId: undefined, referenceArtifactIds: original.referenceArtifactIds.map(id => ids.get(id)), entries: original.entries.map(entry => ({ ...entry, frames: entry.frames.map(frame => ({ ...frame, atlasArtifactId: ids.get(frame.atlasArtifactId) })), sourceHash: undefined, renderedHash: undefined, outputArtifactId: undefined, coverArtifactId: undefined, inspection: undefined, status: entry.frames.length ? 'stale' : 'draft' })) });
  return store.save({ projectId, expectedRevision, document, label: '导入可编辑动画工程' });
}
module.exports = { exportAnimationProject, importAnimationProject };
