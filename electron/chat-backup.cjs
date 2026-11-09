const { randomUUID } = require('node:crypto');
const { hash, validId, withoutSecrets, remap } = require('./backup-format.cjs');
const { validateWorkspaceSnapshot } = require('./chat-service.cjs');

const chatPath = workspaceId => `chat/${workspaceId}/chat.json`;
function readChatBackups(manifest, files) {
  const ids = manifest.chatWorkspaces || [];
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.some(id => !validId(id) || !manifest.locations.workspaces.some(item => item.workspaceId === id)) || ids.length && manifest.scope !== 'workspaces') throw Error('聊天备份的工作区范围无效，尚未恢复任何内容。');
  const expected = new Set(ids.map(chatPath));
  if ([...files.keys()].some(name => name.startsWith('chat/') && !expected.has(name))) throw Error('备份包含未登记的聊天文件，尚未恢复任何内容。');
  return ids.map(workspaceId => {
    const bytes = files.get(chatPath(workspaceId)); if (!bytes) throw Error('聊天备份文件缺失，尚未恢复任何内容。');
    let source; try { source = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw Error('聊天备份不是有效JSON，尚未恢复任何内容。'); }
    if (source.workspaceId !== workspaceId) throw Error('聊天备份内容不属于清单工作区，尚未恢复任何内容。');
    return validateWorkspaceSnapshot(source);
  });
}
function safeChatBackup(snapshot) { return validateWorkspaceSnapshot(withoutSecrets(snapshot)); }
function remapChatBackups(snapshots, idMap, backupId) {
  return snapshots.map(snapshot => {
    if (!validId(idMap[snapshot.workspaceId])) throw Error('聊天备份缺少工作区编号映射。');
    for (const record of snapshot.conversations) { idMap[record.id] ||= randomUUID(); for (const turn of record.turns) idMap[turn.id] ||= randomUUID(); }
    return validateWorkspaceSnapshot({ version: 1, workspaceId: idMap[snapshot.workspaceId], conversations: snapshot.conversations.map(record => {
      const restored = structuredClone(record); restored.id = idMap[record.id]; restored.workspaceId = idMap[snapshot.workspaceId];
      restored._importOrigin = { backupId, sourceWorkspaceId: snapshot.workspaceId, sourceConversationId: record.id, sourceHash: hash(JSON.stringify(record)) };
      restored.turns = record.turns.map(turn => {
        const next = structuredClone(turn); next.id = idMap[turn.id]; delete next.credentialId;
        if (turn.sourceTurnId) { if (!idMap[turn.sourceTurnId]) throw Error('聊天备份的重试来源编号缺失。'); next.sourceTurnId = idMap[turn.sourceTurnId]; }
        if (turn.modelConfigId && idMap[turn.modelConfigId]) next.modelConfigId = idMap[turn.modelConfigId];
        if (turn.plan) next.plan = remap(turn.plan, idMap);
        return next;
      });
      return restored;
    }) });
  });
}
module.exports = { chatPath, readChatBackups, safeChatBackup, remapChatBackups };
