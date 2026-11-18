const { randomUUID } = require('node:crypto');
const { hash, validId, withoutSecrets, remap } = require('./backup-format.cjs');
const { validateWorkspaceSnapshot, validateWorkspaceSnapshotSources } = require('./chat-service.cjs');
const { backupBytes } = require('./chat-attachments.cjs');
const path = require('node:path');
const { checkedDirectory, checkedFile } = require('./workspace-paths.cjs');

const chatPath = workspaceId => `chat/${workspaceId}/chat.json`;
const attachmentPath = (workspaceId, conversationId, attachmentId) => {
  if (![workspaceId, conversationId, attachmentId].every(validId)) throw Error('聊天附件路径编号无效。');
  return `chat/${workspaceId}/attachments/${conversationId}/${attachmentId}`;
};
function readChatBackups(manifest, files) {
  const ids = manifest.chatWorkspaces || [];
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.some(id => !validId(id) || !manifest.locations.workspaces.some(item => item.workspaceId === id)) || ids.length && manifest.scope !== 'workspaces') throw Error('聊天备份的工作区范围无效，尚未恢复任何内容。');
  const expected = new Set(ids.map(chatPath));
  const result = ids.map(workspaceId => {
    const bytes = files.get(chatPath(workspaceId)); if (!bytes) throw Error('聊天备份文件缺失，尚未恢复任何内容。');
    let source; try { source = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw Error('聊天备份不是有效JSON，尚未恢复任何内容。'); }
    if (source.workspaceId !== workspaceId) throw Error('聊天备份内容不属于清单工作区，尚未恢复任何内容。');
    if (source.attachmentFiles !== undefined) {
      if (!Array.isArray(source.attachmentFiles) || source.attachmentFiles.length > 2400) throw Error('聊天附件备份清单无效。');
      source.attachmentFiles = source.attachmentFiles.map(file => { if (!file || Object.keys(file).some(key => !['conversationId', 'attachment'].includes(key))) throw Error('聊天附件备份不得嵌入额外材料或路径。'); const name = attachmentPath(workspaceId, file.conversationId, file.attachment?.id), bytes = files.get(name); if (!bytes) throw Error('聊天附件实际文件缺失，尚未恢复。'); expected.add(name); return { ...file, buffer: bytes }; });
    }
    return validateWorkspaceSnapshot(source);
  });
  if ([...files.keys()].some(name => name.startsWith('chat/') && !expected.has(name))) throw Error('备份包含未登记的聊天文件，尚未恢复任何内容。');
  return result;
}
function safeChatBackup(snapshot, { sources = false } = {}) {
  const { attachmentFiles, ...record } = snapshot, clean = withoutSecrets(record);
  for (const conversation of clean.conversations || []) for (const item of conversation.queue || []) { item._needsAccount = true; item.status = ['starting', 'unknown'].includes(item.status) ? 'unknown' : 'paused'; item.error = '备份不包含账户。请带回输入框选择当前账户，再明确发送；不会自动调用模型。'; }
  return (sources ? validateWorkspaceSnapshotSources : validateWorkspaceSnapshot)({ ...clean, ...(attachmentFiles?.length ? { attachmentFiles: attachmentFiles.map(file => ({ conversationId: file.conversationId, attachment: withoutSecrets(file.attachment), ...(sources ? { source: { ...file.source } } : { buffer: backupBytes(file) }) })) } : {}) });
}
function chatBackupFiles(snapshot) {
  const checked = safeChatBackup(snapshot), files = [];
  const attachmentFiles = (checked.attachmentFiles || []).map(file => { files.push({ name: attachmentPath(checked.workspaceId, file.conversationId, file.attachment.id), buffer: backupBytes(file) }); return { conversationId: file.conversationId, attachment: file.attachment }; });
  files.unshift({ name: chatPath(checked.workspaceId), buffer: Buffer.from(JSON.stringify({ ...checked, ...(attachmentFiles.length ? { attachmentFiles } : {}) }) + '\n') }); return files;
}
function remapChatBackups(snapshots, idMap, backupId, { sources = false } = {}) {
  return snapshots.map(snapshot => {
    if (!validId(idMap[snapshot.workspaceId])) throw Error('聊天备份缺少工作区编号映射。');
    for (const record of snapshot.conversations) { idMap[record.id] ||= randomUUID(); for (const turn of record.turns) { idMap[turn.id] ||= randomUUID(); for (const item of [...(turn.attachments || []), ...(turn.contextAttachments || [])]) idMap[item.id] ||= randomUUID(); } for (const item of record.queue || []) { idMap[item.id] ||= randomUUID(); for (const file of item.attachments) idMap[file.id] ||= randomUUID(); } }
    for (const record of snapshot.conversations) for (const turn of record.turns) {
      const ledgerId = (workspaceId, conversationId, turnId) => 'chat-' + hash(JSON.stringify([workspaceId, conversationId, turnId])).slice(0, 40);
      idMap[ledgerId(snapshot.workspaceId, record.id, turn.id)] = ledgerId(idMap[snapshot.workspaceId], idMap[record.id], idMap[turn.id]);
    }
    return (sources ? validateWorkspaceSnapshotSources : validateWorkspaceSnapshot)({ version: 1, workspaceId: idMap[snapshot.workspaceId], ...(snapshot.attachmentFiles?.length ? { attachmentFiles: snapshot.attachmentFiles.map(file => ({ ...file, conversationId: idMap[file.conversationId], attachment: { ...file.attachment, id: idMap[file.attachment.id] } })) } : {}), conversations: snapshot.conversations.map(record => {
      const restored = structuredClone(record); restored.id = idMap[record.id]; restored.workspaceId = idMap[snapshot.workspaceId];
      if (record.queue) restored.queue = record.queue.map(item => {
        const next = structuredClone(item); next.id = idMap[item.id]; next._needsAccount = true; next.status = ['starting', 'unknown'].includes(item.status) ? 'unknown' : 'paused';
        next._request = { ...item._request, id: next.id, workspaceId: restored.workspaceId, conversationId: restored.id }; delete next._request.credentialId;
        if (next._request.sourceTurnId) { if (idMap[next._request.sourceTurnId]) next._request.sourceTurnId = idMap[next._request.sourceTurnId]; else delete next._request.sourceTurnId; }
        next._request.connection = { ...next._request.connection, id: idMap[next._request.connection.id] || next._request.connection.id };
        next._request.model = { ...next._request.model, id: idMap[next._request.model.id] || next._request.model.id, connectionId: next._request.connection.id };
        if (next._request.attachmentIds) next._request.attachmentIds = next._request.attachmentIds.map(id => idMap[id]);
        if (next._request.target) { const target = next._request.target; if (idMap[target.projectId] && idMap[target.artifactId]) next._request.target = { ...target, projectId: idMap[target.projectId], artifactId: idMap[target.artifactId] }; else delete next._request.target; }
        next.attachments = item.attachments.map(file => ({ ...file, id: idMap[file.id] })); next.error = '备份待发要求已恢复。请带回输入框选择账户后明确发送。'; return next;
      });
      if (record.productions) restored.productions = record.productions.map(link => {
        const mapped = idMap[link.runId] && idMap[link.target.projectId] && idMap[link.target.artifactId];
        return { ...link, ...(link.sourceTurnId && idMap[link.sourceTurnId] ? { sourceTurnId: idMap[link.sourceTurnId] } : {}), runId: idMap[link.runId] || link.runId, target: { ...link.target, projectId: idMap[link.target.projectId] || link.target.projectId, artifactId: idMap[link.target.artifactId] || link.target.artifactId }, ...(!mapped || link.sourceOnly ? { sourceOnly: true, sourceRunId: link.sourceRunId || link.runId } : {}) };
      });
      if (record.exports) restored.exports = record.exports.map(link => ({ ...link, turnId: idMap[link.turnId] || link.turnId, projectId: idMap[link.projectId] || link.projectId, runId: idMap[link.runId] || link.runId, ...(!idMap[link.projectId] || !idMap[link.runId] || link.sourceOnly ? { sourceOnly: true } : {}) }));
      restored._importOrigin = { backupId, sourceWorkspaceId: snapshot.workspaceId, sourceConversationId: record.id, sourceHash: hash(JSON.stringify(record)) };
      restored.turns = record.turns.map(turn => {
        const next = structuredClone(turn); next.id = idMap[turn.id]; delete next.credentialId;
        if (turn.sourceTurnId) { if (!idMap[turn.sourceTurnId]) throw Error('聊天备份的重试来源编号缺失。'); next.sourceTurnId = idMap[turn.sourceTurnId]; }
        if (turn.modelConfigId && idMap[turn.modelConfigId]) next.modelConfigId = idMap[turn.modelConfigId];
        if (turn.target) {
          if (idMap[turn.target.projectId] && idMap[turn.target.artifactId]) next.target = { ...turn.target, projectId: idMap[turn.target.projectId], artifactId: idMap[turn.target.artifactId] };
          else delete next.target;
        }
        for (const field of ['attachments', 'contextAttachments']) if (turn[field]) next[field] = turn[field].map(item => ({ ...item, id: idMap[item.id] }));
        if (turn.plan) next.plan = remap(turn.plan, idMap);
        return next;
      });
      return restored;
    }) });
  });
}
function receiptAttachmentPath(receipts, backupId, snapshot, file) {
  if (![backupId, snapshot.workspaceId, file.conversationId, file.attachment?.id].every(validId)) throw Error('聊天恢复材料缓存编号无效。');
  return path.join(receipts, `${backupId}-chat-materials`, snapshot.workspaceId, file.conversationId, file.attachment.id);
}
async function cacheChatReceipt(fs, receipts, backupId, snapshots) {
  const result = [];
  for (const source of snapshots) {
    const snapshot = validateWorkspaceSnapshot(source), attachmentFiles = [];
    for (const file of snapshot.attachmentFiles || []) {
      const filename = receiptAttachmentPath(receipts, backupId, snapshot, file), bytes = backupBytes(file); await checkedDirectory(fs, path.dirname(filename), true);
      try { await fs.writeFile(filename, bytes, { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; const stat = await checkedFile(fs, filename); if (stat.size !== bytes.length || hash(await fs.readFile(filename)) !== file.attachment.sha256) throw Error('聊天恢复缓存已有不同内容，未覆盖。'); }
      attachmentFiles.push({ conversationId: file.conversationId, attachment: file.attachment, cached: true });
    }
    const { attachmentFiles: _files, ...metadata } = snapshot; result.push({ ...metadata, ...(attachmentFiles.length ? { attachmentFiles } : {}) });
  }
  return result;
}
async function loadChatReceipt(fs, receipts, backupId, snapshots) {
  const result = [];
  for (const source of snapshots) {
    const files = [];
    for (const file of source.attachmentFiles || []) {
      if (file.cached === true) { const filename = receiptAttachmentPath(receipts, backupId, source, file), stat = await checkedFile(fs, filename); if (stat.size !== file.attachment.bytes) throw Error('聊天恢复缓存大小不一致，原资料保留。'); files.push({ conversationId: file.conversationId, attachment: file.attachment, buffer: await fs.readFile(filename) }); }
      else files.push(file);
    }
    result.push(validateWorkspaceSnapshot({ ...source, ...(files.length ? { attachmentFiles: files } : {}) }));
  }
  return result;
}
module.exports = { chatPath, readChatBackups, safeChatBackup, safeChatBackupSources: snapshot => safeChatBackup(snapshot, { sources: true }), remapChatBackups, remapChatBackupSources: (snapshots, idMap, backupId) => remapChatBackups(snapshots, idMap, backupId, { sources: true }), chatBackupFiles, cacheChatReceipt, loadChatReceipt };
