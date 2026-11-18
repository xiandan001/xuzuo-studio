const path = require('node:path');
const { validId } = require('./backup-format.cjs');
const { safeChatBackupSources } = require('./chat-backup.cjs');
const { backupBytes } = require('./chat-attachments.cjs');
const { sourceBytes, sourceInfo, metadataBytes, MAX_METADATA } = require('./incremental-backup-paths.cjs');
const { streamDescriptor, cacheSource, cachedSource } = require('./backup-source-cache.cjs');

const metadataPath = workspaceId => `chat/${workspaceId}/chat.json`;
function attachmentPath(workspaceId, conversationId, attachmentId) {
  if (![workspaceId, conversationId, attachmentId].every(validId)) throw Error('聊天备份资料编号无效。');
  return `chat/${workspaceId}/attachments/${conversationId}/${attachmentId}`;
}
function metadataRecord(snapshot) {
  const { attachmentFiles, ...record } = snapshot;
  return { ...record, ...(attachmentFiles?.length ? { attachmentFiles: attachmentFiles.map(({ conversationId, attachment }) => ({ conversationId, attachment })) } : {}) };
}
function chatSnapshotMetadataBytes(snapshot, maximum = MAX_METADATA) { return metadataBytes(metadataRecord(snapshot), Math.max(0, maximum - 1)) + 1; }
function chatSnapshotFiles(snapshot) {
  const checked = safeChatBackupSources(snapshot), { attachmentFiles, ...record } = checked;
  chatSnapshotMetadataBytes(checked);
  return [{ name: metadataPath(checked.workspaceId), buffer: Buffer.from(JSON.stringify(metadataRecord({ ...record, attachmentFiles })) + '\n') }, ...(attachmentFiles || []).map(file => ({ name: attachmentPath(checked.workspaceId, file.conversationId, file.attachment.id), source: file.source }))];
}
async function readChatSnapshots(manifest, files) {
  const ids = manifest.chatWorkspaces || [], expected = new Set(), snapshots = [];
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.some(id => !validId(id) || !manifest.locations.workspaces.some(item => item.workspaceId === id)) || ids.length && manifest.scope !== 'workspaces') throw Error('聊天增量备份的工作区范围无效。');
  for (const workspaceId of ids) {
    const filename = metadataPath(workspaceId), source = files.get(filename); if (!source) throw Error('聊天增量备份清单缺失。'); expected.add(filename);
    if (sourceInfo(source).bytes > MAX_METADATA) throw Error('聊天管理索引超过32MB，未载入不完整快照。');
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await sourceBytes(source)));
    if (value.workspaceId !== workspaceId || value.attachmentFiles !== undefined && !Array.isArray(value.attachmentFiles)) throw Error('聊天增量备份的归属或附件清单无效。');
    const attachments = [];
    for (const file of value.attachmentFiles || []) {
      if (!file || Object.keys(file).some(key => !['conversationId', 'attachment'].includes(key))) throw Error('聊天备份资料包含未知字段。');
      const relative = attachmentPath(workspaceId, file.conversationId, file.attachment?.id), payload = files.get(relative); if (!payload) throw Error('聊天增量备份附件缺失。'); expected.add(relative);
      const info = sourceInfo(payload); if (info.bytes !== file.attachment.bytes || info.sha256 !== file.attachment.sha256) throw Error('聊天附件清单与实际文件不一致。');
      backupBytes({ attachment: file.attachment, buffer: await sourceBytes(payload) });
      attachments.push({ ...file, source: streamDescriptor(payload) });
    }
    snapshots.push(safeChatBackupSources({ ...value, ...(attachments.length ? { attachmentFiles: attachments } : {}) }));
  }
  if ([...files.keys()].some(name => name.startsWith('chat/') && !expected.has(name))) throw Error('增量备份包含未登记的聊天文件。');
  return snapshots;
}
function cachedPath(receipts, backupId, workspaceId, conversationId, attachmentId) {
  if (![backupId, workspaceId, conversationId, attachmentId].every(validId)) throw Error('聊天恢复缓存编号无效。');
  return path.join(receipts, backupId + '-chat-materials', workspaceId, conversationId, attachmentId);
}
async function cacheChatSnapshots(fs, receipts, backupId, snapshots, options) {
  const result = [];
  for (const snapshot of snapshots) {
    const files = [];
    for (const file of snapshot.attachmentFiles || []) {
      const filename = cachedPath(receipts, backupId, snapshot.workspaceId, file.conversationId, file.attachment.id);
      files.push({ conversationId: file.conversationId, attachment: file.attachment, source: await cacheSource(fs, file.source, filename, options) });
    }
    result.push(safeChatBackupSources({ ...snapshot, ...(files.length ? { attachmentFiles: files } : {}) }));
  }
  return result;
}
async function loadChatSnapshots(fs, receipts, backupId, snapshots, options) {
  const result = [];
  for (const snapshot of snapshots) {
    const files = [];
    for (const file of snapshot.attachmentFiles || []) {
      const filename = cachedPath(receipts, backupId, snapshot.workspaceId, file.conversationId, file.attachment.id);
      if (path.resolve(file.source?.path || '') !== filename) throw Error('聊天恢复缓存位置与登记编号不一致。');
      const source = await cachedSource(fs, filename, file.attachment, options); files.push({ ...file, source: streamDescriptor(source) });
    }
    result.push(safeChatBackupSources({ ...snapshot, ...(files.length ? { attachmentFiles: files } : {}) }));
  }
  return result;
}
module.exports = { chatSnapshotFiles, chatSnapshotMetadataBytes, readChatSnapshots, cacheChatSnapshots, loadChatSnapshots };
