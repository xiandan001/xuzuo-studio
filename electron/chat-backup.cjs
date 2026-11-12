const { randomUUID } = require('node:crypto');
const { hash, validId, withoutSecrets, remap } = require('./backup-format.cjs');
const { validateWorkspaceSnapshot } = require('./chat-service.cjs');
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
function safeChatBackup(snapshot) {
  const { attachmentFiles, ...record } = snapshot;
  return validateWorkspaceSnapshot({ ...withoutSecrets(record), ...(attachmentFiles?.length ? { attachmentFiles: attachmentFiles.map(file => ({ conversationId: file.conversationId, attachment: withoutSecrets(file.attachment), buffer: backupBytes(file) })) } : {}) });
}
function chatBackupFiles(snapshot) {
  const checked = safeChatBackup(snapshot), files = [];
  const attachmentFiles = (checked.attachmentFiles || []).map(file => { files.push({ name: attachmentPath(checked.workspaceId, file.conversationId, file.attachment.id), buffer: backupBytes(file) }); return { conversationId: file.conversationId, attachment: file.attachment }; });
  files.unshift({ name: chatPath(checked.workspaceId), buffer: Buffer.from(JSON.stringify({ ...checked, ...(attachmentFiles.length ? { attachmentFiles } : {}) }) + '\n') }); return files;
}
function remapChatBackups(snapshots, idMap, backupId) {
  return snapshots.map(snapshot => {
    if (!validId(idMap[snapshot.workspaceId])) throw Error('聊天备份缺少工作区编号映射。');
    for (const record of snapshot.conversations) { idMap[record.id] ||= randomUUID(); for (const turn of record.turns) { idMap[turn.id] ||= randomUUID(); for (const item of [...(turn.attachments || []), ...(turn.contextAttachments || [])]) idMap[item.id] ||= randomUUID(); } }
    for (const record of snapshot.conversations) for (const turn of record.turns) {
      const ledgerId = (workspaceId, conversationId, turnId) => 'chat-' + hash(JSON.stringify([workspaceId, conversationId, turnId])).slice(0, 40);
      idMap[ledgerId(snapshot.workspaceId, record.id, turn.id)] = ledgerId(idMap[snapshot.workspaceId], idMap[record.id], idMap[turn.id]);
    }
    return validateWorkspaceSnapshot({ version: 1, workspaceId: idMap[snapshot.workspaceId], ...(snapshot.attachmentFiles?.length ? { attachmentFiles: snapshot.attachmentFiles.map(file => ({ ...file, conversationId: idMap[file.conversationId], attachment: { ...file.attachment, id: idMap[file.attachment.id] } })) } : {}), conversations: snapshot.conversations.map(record => {
      const restored = structuredClone(record); restored.id = idMap[record.id]; restored.workspaceId = idMap[snapshot.workspaceId];
      if (record.productions) restored.productions = record.productions.map(link => {
        const mapped = idMap[link.runId] && idMap[link.target.projectId] && idMap[link.target.artifactId];
        return { ...link, runId: idMap[link.runId] || link.runId, target: { ...link.target, projectId: idMap[link.target.projectId] || link.target.projectId, artifactId: idMap[link.target.artifactId] || link.target.artifactId }, ...(!mapped || link.sourceOnly ? { sourceOnly: true, sourceRunId: link.sourceRunId || link.runId } : {}) };
      });
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
module.exports = { chatPath, readChatBackups, safeChatBackup, remapChatBackups, chatBackupFiles, cacheChatReceipt, loadChatReceipt };
