const { createHash } = require('node:crypto');
const { CHAT_ATTACHMENT_EXTENSIONS } = require('./chat-attachments.cjs');
const { safeName } = require('./artifact-store.cjs');

const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value);
function checkedScope(input, transfer = false) {
  const allowed = transfer ? ['workspaceId', 'conversationId', 'turnId', 'attachmentIds', 'projectId'] : ['workspaceId', 'conversationId'];
  if (!input || Object.keys(input).some(key => !allowed.includes(key)) || !validId(input.workspaceId) || !validId(input.conversationId)) throw Error('聊天附件所属工作区或对话无效。');
  if (transfer) {
    const turn = input.turnId !== undefined, draft = input.attachmentIds !== undefined;
    if (!validId(input.projectId) || turn === draft || turn && !validId(input.turnId) || draft && (!Array.isArray(input.attachmentIds) || !input.attachmentIds.length || input.attachmentIds.length > 5 || input.attachmentIds.some(id => !validId(id)) || new Set(input.attachmentIds).size !== input.attachmentIds.length)) throw Error('请选择当前对话的附件与有效保存项目。');
  }
  return { workspaceId: input.workspaceId, conversationId: input.conversationId };
}

function registerChatAttachmentHandlers({ handle, dialog, getWindow, chatService, workspaceStorage, artifactStore, withProjectWrite, assertProject }) {
  const transfers = new Map();
  handle('chat-importAttachments', async input => {
    const scope = checkedScope(input);
    const selected = await dialog.showOpenDialog(getWindow(), { title: '添加聊天附件', properties: ['openFile', 'multiSelections'], filters: [{ name: '图片、PDF、文字与 Office 文档', extensions: [...CHAT_ATTACHMENT_EXTENSIONS] }] });
    if (selected.canceled || !selected.filePaths?.length) return [];
    if (selected.filePaths.length > 5) throw Error('每条消息最多添加 5 个附件，请减少选择后重试。');
    return chatService.importAttachments(scope, selected.filePaths);
  });
  handle('chat-transferAttachments', input => {
    const scope = checkedScope(input, true), key = JSON.stringify([scope.workspaceId, scope.conversationId, input.projectId, input.turnId || null, input.attachmentIds ? [...input.attachmentIds].sort() : null]);
    if (transfers.has(key)) return transfers.get(key);
    const task = withProjectWrite(input.projectId, async () => {
      const location = (await workspaceStorage.list()).projects.find(project => project.projectId === input.projectId);
      if (!location || location.workspaceId !== scope.workspaceId) throw Error('附件只能加入当前工作区的保存项目，未复制文件。');
      await assertProject(input.projectId);
      const files = await chatService.attachmentFiles(scope, input.turnId, input.attachmentIds);
      const existing = (await artifactStore.listProject(input.projectId)).filter(file => !file.trashedAt && !file.unavailable);
      const result = [];
      for (const file of files) {
        const sha256 = createHash('sha256').update(file.buffer).digest('hex');
        let match;
        for (const candidate of existing.filter(item => item.name === safeName(file.name, file.mimeType) && item.sha256 === sha256)) {
          try { const stored = await artifactStore.read(candidate.id); if (createHash('sha256').update(stored.buffer).digest('hex') === sha256) { match = candidate; break; } }
          catch { /* A damaged old copy is preserved; import a new verified copy. */ }
        }
        const imported = match || await artifactStore.write({ name: file.name, mimeType: file.mimeType, buffer: file.buffer, projectId: input.projectId, preserveOriginalName: true });
        if (!match) existing.push(imported);
        result.push(imported);
      }
      return [...new Map(result.map(file => [file.id, file])).values()];
    });
    transfers.set(key, task);
    return task.finally(() => { transfers.delete(key); });
  });
}

module.exports = { registerChatAttachmentHandlers };
