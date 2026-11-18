const path = require('node:path');
const { validId } = require('./backup-format.cjs');
const { validateTemplateSnapshotSources } = require('./project-template-backup.cjs');
const { atomicJson, checkedDirectory } = require('./workspace-paths.cjs');
const { sourceBytes, sourceInfo, readJson, metadataBytes, MAX_METADATA } = require('./incremental-backup-paths.cjs');
const { streamDescriptor, cacheSource, cachedSource } = require('./backup-source-cache.cjs');

const metadataPath = workspaceId => `templates/${workspaceId}/templates.json`;
function materialPath(workspaceId, templateId, id) {
  if (![workspaceId, templateId, id].every(validId)) throw Error('模板备份资料编号无效。');
  return `templates/${workspaceId}/files/${templateId}-${id}.bin`;
}
function templateSnapshotMetadataBytes(snapshot, maximum = MAX_METADATA) { return metadataBytes({ version: 1, workspaceId: snapshot.workspaceId, items: snapshot.items }, Math.max(0, maximum - 1)) + 1; }
function templateSnapshotFiles(snapshot) {
  templateSnapshotMetadataBytes(snapshot);
  validateTemplateSnapshotSources(snapshot);
  return [{ name: metadataPath(snapshot.workspaceId), buffer: Buffer.from(JSON.stringify({ version: 1, workspaceId: snapshot.workspaceId, items: snapshot.items }) + '\n') }, ...snapshot.files.map(file => ({ name: materialPath(snapshot.workspaceId, file.templateId, file.id), source: file.source || { path: file.path, bytes: file.bytes, sha256: file.sha256 } }))];
}
async function readTemplateSnapshots(manifest, files) {
  const ids = manifest.templateWorkspaces || [], expected = new Set(), snapshots = [];
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.some(id => !validId(id) || !manifest.locations.workspaces.some(item => item.workspaceId === id)) || ids.length && manifest.scope !== 'workspaces') throw Error('模板增量备份范围无效。');
  for (const workspaceId of ids) {
    const filename = metadataPath(workspaceId), source = files.get(filename); if (!source) throw Error('项目模板备份清单缺失。'); expected.add(filename);
    if (sourceInfo(source).bytes > MAX_METADATA) throw Error('模板管理索引超过32MB，未载入不完整快照。');
    const bytes = await sourceBytes(source);
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (value.workspaceId !== workspaceId || !Array.isArray(value.items) || Object.keys(value).some(key => !['version', 'workspaceId', 'items'].includes(key))) throw Error('项目模板备份范围不一致。');
    const materials = [];
    for (const item of value.items) for (const material of item.materials || []) {
      const relative = materialPath(workspaceId, item.id, material.id), payload = files.get(relative); if (!payload) throw Error('模板备份素材缺失。'); expected.add(relative);
      const info = sourceInfo(payload); if (info.bytes !== material.bytes || info.sha256 !== material.sha256) throw Error('项目模板素材与实际文件不一致。');
      materials.push({ templateId: item.id, id: material.id, source: streamDescriptor(payload) });
    }
    snapshots.push(validateTemplateSnapshotSources({ ...value, files: materials }));
  }
  if ([...files.keys()].some(name => name.startsWith('templates/') && !expected.has(name))) throw Error('备份包含未登记的模板文件。');
  return snapshots;
}
function folder(receipts, backupId) { if (!validId(backupId)) throw Error('模板恢复缓存编号无效。'); return path.join(receipts, backupId + '-templates'); }
function filename(workspaceId, templateId, id) { if (![workspaceId, templateId, id].every(validId)) throw Error('模板恢复资料编号无效。'); return `${workspaceId}-${templateId}-${id}.bin`; }
async function cacheTemplateSnapshots(fs, receipts, backupId, snapshots, options) {
  const directory = folder(receipts, backupId), ids = []; await checkedDirectory(fs, directory, true);
  for (const snapshot of snapshots) {
    validateTemplateSnapshotSources(snapshot); const files = [];
    for (const file of snapshot.files) {
      const name = filename(snapshot.workspaceId, file.templateId, file.id), info = await cacheSource(fs, file.source, path.join(directory, name), options);
      files.push({ templateId: file.templateId, id: file.id, filename: name, bytes: info.bytes, sha256: info.sha256 });
    }
    await atomicJson(fs, path.join(directory, snapshot.workspaceId + '.json'), { version: 1, workspaceId: snapshot.workspaceId, items: snapshot.items, files }); ids.push(snapshot.workspaceId);
  }
  return ids;
}
async function loadTemplateSnapshots(fs, receipts, backupId, ids, options) {
  if (!Array.isArray(ids) || ids.some(id => !validId(id))) throw Error('模板恢复缓存范围无效。');
  const directory = folder(receipts, backupId), snapshots = [];
  for (const workspaceId of ids) {
    const value = await readJson(fs, path.join(directory, workspaceId + '.json')); if (value.workspaceId !== workspaceId || !Array.isArray(value.files)) throw Error('模板恢复缓存工作区不一致。');
    const files = [];
    for (const file of value.files) {
      if (file.filename !== filename(workspaceId, file.templateId, file.id)) throw Error('模板恢复素材缓存位置无效。');
      files.push({ templateId: file.templateId, id: file.id, source: streamDescriptor(await cachedSource(fs, path.join(directory, file.filename), file, options)) });
    }
    snapshots.push(validateTemplateSnapshotSources({ ...value, files }));
  }
  return snapshots;
}
module.exports = { templateSnapshotFiles, templateSnapshotMetadataBytes, readTemplateSnapshots, cacheTemplateSnapshots, loadTemplateSnapshots };
