const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { hash, validId, remap } = require('./backup-format.cjs');
const { checkedDirectory, checkedFile, atomicJson } = require('./workspace-paths.cjs');
const { validateTemplate } = require('./project-templates.cjs');

const root = workspaceId => `templates/${workspaceId}`;
const materialPath = (workspaceId, templateId, id) => `${root(workspaceId)}/files/${templateId}-${id}.bin`;
function validateTemplateSnapshot(snapshot) {
  if (!snapshot || snapshot.version !== 1 || !validId(snapshot.workspaceId) || !Array.isArray(snapshot.items) || snapshot.items.length > 200 || new Set(snapshot.items.map(item => item.id)).size !== snapshot.items.length || !Array.isArray(snapshot.files) || snapshot.files.length > 4000) throw Error('项目模板备份格式无效。');
  const expected = new Map();
  for (const item of snapshot.items) { validateTemplate(item, snapshot.workspaceId, item.id); for (const material of item.materials) expected.set(item.id + '/' + material.id, material); }
  if (snapshot.files.length !== expected.size || new Set(snapshot.files.map(file => `${file.templateId}/${file.id}`)).size !== snapshot.files.length) throw Error('项目模板素材清单不匹配。');
  for (const file of snapshot.files) { const material = expected.get(`${file.templateId}/${file.id}`); if (!material || !(file.buffer instanceof Uint8Array) || file.buffer.length !== material.bytes || hash(file.buffer) !== material.sha256) throw Error('项目模板素材文件缺失或已改变。'); }
  return snapshot;
}
function templateBackupFiles(snapshot) {
  validateTemplateSnapshot(snapshot);
  return [{ name: `${root(snapshot.workspaceId)}/templates.json`, buffer: Buffer.from(JSON.stringify({ version: 1, workspaceId: snapshot.workspaceId, items: snapshot.items }) + '\n') }, ...snapshot.files.map(file => ({ name: materialPath(snapshot.workspaceId, file.templateId, file.id), buffer: file.buffer }))];
}
function readTemplateBackups(manifest, files) {
  const ids = manifest.templateWorkspaces || [], expected = new Set();
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.some(id => !validId(id) || !manifest.locations.workspaces.some(item => item.workspaceId === id)) || ids.length && manifest.scope !== 'workspaces') throw Error('项目模板备份工作区无效。');
  const snapshots = ids.map(workspaceId => {
    const name = `${root(workspaceId)}/templates.json`, bytes = files.get(name); expected.add(name);
    if (!bytes || bytes.length > 32 * 1024 * 1024) throw Error('项目模板备份清单缺失或过大。');
    let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw Error('项目模板备份不是有效JSON。'); }
    if (value.workspaceId !== workspaceId || Object.keys(value).some(key => !['version', 'workspaceId', 'items'].includes(key)) || !Array.isArray(value.items)) throw Error('项目模板备份范围不一致。');
    const materials = [];
    for (const item of value.items) { validateTemplate(item, workspaceId, item.id); for (const material of item.materials) { const file = materialPath(workspaceId, item.id, material.id); expected.add(file); materials.push({ templateId: item.id, id: material.id, buffer: files.get(file) }); } }
    return validateTemplateSnapshot({ ...value, files: materials });
  });
  if ([...files.keys()].some(name => name.startsWith('templates/') && !expected.has(name))) throw Error('备份包含未登记的项目模板文件。');
  return snapshots;
}
function remapTemplateBackups(snapshots, idMap) {
  return snapshots.map(snapshot => {
    if (!validId(idMap[snapshot.workspaceId])) throw Error('模板恢复缺少工作区编号映射。');
    for (const item of snapshot.items) { idMap[item.id] ||= randomUUID(); for (const file of item.materials) idMap[file.id] ||= randomUUID(); }
    const value = remap({ version: 1, workspaceId: snapshot.workspaceId, items: snapshot.items }, idMap);
    for (const item of value.items) for (const file of item.materials) file.fileName = `${item.id}-${file.id}.bin`;
    return validateTemplateSnapshot({ ...value, files: snapshot.files.map(file => ({ templateId: idMap[file.templateId], id: idMap[file.id], buffer: file.buffer })) });
  });
}
async function cacheTemplateReceipt(fs, receipts, backupId, snapshots) {
  if (!validId(backupId)) throw Error('模板恢复凭据编号无效。');
  const folder = path.join(receipts, backupId + '-templates'); await checkedDirectory(fs, folder, true); const descriptors = [];
  for (const snapshot of snapshots) {
    validateTemplateSnapshot(snapshot); const files = [];
    for (const file of snapshot.files) { const filename = `${snapshot.workspaceId}-${file.templateId}-${file.id}.bin`, target = path.join(folder, filename); try { await fs.writeFile(target, file.buffer, { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; await checkedFile(fs, target); if (hash(await fs.readFile(target)) !== hash(file.buffer)) throw Error('模板恢复素材缓存冲突。'); } files.push({ templateId: file.templateId, id: file.id, filename, sha256: hash(file.buffer) }); }
    await atomicJson(fs, path.join(folder, snapshot.workspaceId + '.json'), { ...snapshot, files }); descriptors.push(snapshot.workspaceId);
  }
  return descriptors;
}
async function loadTemplateReceipt(fs, receipts, backupId, ids) {
  if (!validId(backupId) || !Array.isArray(ids) || ids.some(id => !validId(id))) throw Error('模板恢复凭据无效。');
  const folder = path.join(receipts, backupId + '-templates'), result = [];
  for (const workspaceId of ids) { const target = path.join(folder, workspaceId + '.json'); await checkedFile(fs, target); const snapshot = JSON.parse(await fs.readFile(target, 'utf8')); if (snapshot.workspaceId !== workspaceId || !Array.isArray(snapshot.files)) throw Error('模板恢复凭据工作区不符。'); snapshot.files = await Promise.all(snapshot.files.map(async file => { if (!validId(file.templateId) || !validId(file.id) || file.filename !== `${workspaceId}-${file.templateId}-${file.id}.bin`) throw Error('模板恢复素材凭据路径无效。'); const filename = path.join(folder, file.filename); await checkedFile(fs, filename); const buffer = await fs.readFile(filename); if (hash(buffer) !== file.sha256) throw Error('模板恢复素材缓存已改变。'); return { templateId: file.templateId, id: file.id, buffer }; })); result.push(validateTemplateSnapshot(snapshot)); }
  return result;
}
module.exports = { validateTemplateSnapshot, templateBackupFiles, readTemplateBackups, remapTemplateBackups, cacheTemplateReceipt, loadTemplateReceipt };
