const path = require('node:path');
const { idValid, hash } = require('./proofing-validation.cjs');
const { validateProofSnapshot } = require('./proofing-record.cjs');
const { checkedDirectory, checkedFile, atomicJson } = require('./workspace-paths.cjs');
const proofPath = workspaceId => `proof/${workspaceId}/proof.json`;
function proofBackupFiles(snapshot) {
  validateProofSnapshot(snapshot); return [{ name: proofPath(snapshot.workspaceId), buffer: Buffer.from(JSON.stringify(snapshot) + '\n') }];
}
function readProofBackups(manifest, files) {
  const ids = manifest.proofWorkspaces || [], expected = new Set();
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.some(id => !idValid(id) || !manifest.locations.workspaces.some(item => item.workspaceId === id)) || ids.length && manifest.scope !== 'workspaces') throw Error('校样备份的工作区范围无效。');
  const snapshots = ids.map(workspaceId => {
    const name = proofPath(workspaceId), bytes = files.get(name); expected.add(name);
    if (!bytes || bytes.length > 64 * 1024 * 1024) throw Error('校样备份记录缺失或超过64MB。');
    const snapshot = validateProofSnapshot(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    if (snapshot.workspaceId !== workspaceId) throw Error('校样备份不属于清单工作区。');
    for (const record of snapshot.packages) {
      if (!manifest.locations.projects.some(project => project.projectId === record.projectId && project.workspaceId === workspaceId)) throw Error('校样包根项目不属于当前备份工作区。');
      for (const file of record.files) {
        if (!manifest.locations.projects.some(project => project.projectId === file.projectId && project.workspaceId === workspaceId) || !manifest.artifacts.some(artifact => artifact.id === file.artifactId && artifact.projectId === file.projectId && artifact.sha256 === file.sha256)) throw Error('校样来源文件不在工作区备份中或版本已变化，请先处理失效校样。');
      }
    }
    return snapshot;
  });
  if ([...files.keys()].some(name => name.startsWith('proof/') && !expected.has(name))) throw Error('备份包含未登记的校样记录。');
  return snapshots;
}
function remapProofBackups(snapshots, idMap, backupId) {
  if (!idValid(backupId)) throw Error('校样恢复缺少备份来源编号。');
  return snapshots.map(snapshot => {
    const workspaceId = idMap[snapshot.workspaceId]; if (!idValid(workspaceId)) throw Error('校样恢复缺少工作区编号映射。');
    return validateProofSnapshot({ version: 1, workspaceId, packages: snapshot.packages.map(source => {
      const record = structuredClone(source), projectId = idMap[source.projectId]; if (!idValid(projectId)) throw Error('校样恢复缺少项目编号映射。');
      record.origin ||= { workspaceId: source.workspaceId, projectId: source.projectId, files: source.files.map(file => ({ key: file.key, artifactId: file.artifactId, projectId: file.projectId })), pages: source.pages.map(page => ({ id: page.id, sourcePageId: page.sourcePageId, sheetId: page.sheetId, sourceRevision: page.sourceRevision, locators: structuredClone(page.locators) })) };
      record.workspaceId = workspaceId; record.projectId = projectId;
      if (record.orderId) { if (idValid(idMap[record.orderId])) record.orderId = idMap[record.orderId]; else delete record.orderId; }
      if (record.artifactId) { if (idValid(idMap[record.artifactId])) record.artifactId = idMap[record.artifactId]; else delete record.artifactId; }
      record.files = source.files.map(file => { if (!idValid(idMap[file.artifactId]) || !idValid(idMap[file.projectId])) throw Error('校样恢复缺少成品编号映射。'); return { ...file, artifactId: idMap[file.artifactId], projectId: idMap[file.projectId] }; });
      record.pages = source.pages.map(page => ({ ...page, ...(page.sourcePageId ? { sourcePageId: idMap[page.sourcePageId] || page.sourcePageId } : {}), ...(page.sheetId ? { sheetId: idMap[page.sheetId] || page.sheetId } : {}), locators: Object.fromEntries(Object.entries(page.locators).map(([id, locator]) => [id, { ...locator, ...Object.fromEntries(['pageId', 'blockId', 'sheetId'].filter(field => locator[field]).map(field => [field, idMap[locator[field]] || locator[field]])) }])) }));
      return record;
    }) });
  });
}
async function cacheProofReceipt(fs, receipts, backupId, snapshots) {
  if (!idValid(backupId)) throw Error('校样恢复凭据编号无效。');
  const folder = path.join(receipts, backupId + '-proof'); await checkedDirectory(fs, folder, true); const descriptors = [];
  for (const snapshot of snapshots) { validateProofSnapshot(snapshot); const buffer = Buffer.from(JSON.stringify(snapshot) + '\n'); await atomicJson(fs, path.join(folder, snapshot.workspaceId + '.json'), snapshot); descriptors.push({ workspaceId: snapshot.workspaceId, sha256: hash(buffer) }); }
  return descriptors;
}
async function loadProofReceipt(fs, receipts, backupId, ids) {
  if (!idValid(backupId) || !Array.isArray(ids) || ids.length > 200 || ids.some(item => !idValid(item.workspaceId) || !/^[a-f0-9]{64}$/.test(item.sha256 || ''))) throw Error('校样恢复凭据无效。');
  const folder = path.join(receipts, backupId + '-proof'), result = [];
  for (const item of ids) { const target = path.join(folder, item.workspaceId + '.json'); const stat = await checkedFile(fs, target); if (stat.size > 64 * 1024 * 1024) throw Error('校样恢复缓存超过64MB。'); const value = validateProofSnapshot(JSON.parse(await fs.readFile(target, 'utf8'))); if (value.workspaceId !== item.workspaceId || hash(Buffer.from(JSON.stringify(value) + '\n')) !== item.sha256) throw Error('校样恢复缓存已变化。'); result.push(value); }
  return result;
}
module.exports = { validateProofSnapshot, proofBackupFiles, readProofBackups, remapProofBackups, cacheProofReceipt, loadProofReceipt };
