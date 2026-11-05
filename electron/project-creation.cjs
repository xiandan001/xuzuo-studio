const { randomUUID } = require('node:crypto');
const { key } = require('./workspace-paths.cjs');

function registerProjectCreation({ handle, dialog, getWindow, workspaceStorage, withProjectWrite, beforeReconnect = async () => undefined }) {
  let selection, claimedSelectionId, choosing = false, creating = false, reconnecting = false;
  handle('workspace-reconnect', async input => {
    if (choosing || creating || reconnecting) throw new Error('项目文件夹正在处理中，请等待当前操作完成。');
    if (!input || typeof input.workspaceId !== 'string') throw new Error('请选择需要重新连接的工作区。');
    reconnecting = true;
    try {
      await beforeReconnect(input.workspaceId);
      const workspace = (await workspaceStorage.list()).workspaces.find(item => item.workspaceId === input.workspaceId);
      if (!workspace) throw new Error('工作区尚未登记，请先设置工作区文件夹。');
      const result = await dialog.showOpenDialog(getWindow(), {
        title: '重新连接原工作区文件夹', buttonLabel: '恢复连接并继续', defaultPath: workspace.directory,
        properties: ['openDirectory', 'createDirectory'], exactPath: workspace.directory,
        validateSelection: paths => { if (!paths[0] || key(paths[0]) !== key(workspace.directory)) throw new Error(`请选择原登记的工作区文件夹：${workspace.directory}`); },
      });
      if (result.canceled || !result.filePaths[0]) return null;
      await beforeReconnect(input.workspaceId);
      return await workspaceStorage.reconnectRoot({ workspaceId: input.workspaceId, directory: result.filePaths[0] });
    } finally { reconnecting = false; }
  });
  handle('workspace-project-folder', async input => {
    if (choosing || creating || reconnecting) throw new Error('项目文件夹正在处理中，请等待当前操作完成。');
    if (!input || typeof input.workspaceId !== 'string') throw new Error('请选择要创建项目的工作区。');
    choosing = true;
    try {
      const directory = await workspaceStorage.validateWorkspace(input.workspaceId);
      const result = await dialog.showOpenDialog(getWindow(), {
        title: '选择或新建项目文件夹', buttonLabel: '使用此项目文件夹',
        defaultPath: selection?.workspaceId === input.workspaceId && selection.selectionId !== claimedSelectionId ? selection.directory : directory,
        properties: ['openDirectory', 'createDirectory'], allowedRoot: directory, selectEmpty: true,
        validateSelection: paths => workspaceStorage.inspectProjectFolder({ workspaceId: input.workspaceId, directory: paths[0] }),
      });
      if (result.canceled || !result.filePaths[0]) return null;
      const folder = await workspaceStorage.inspectProjectFolder({ workspaceId: input.workspaceId, directory: result.filePaths[0] });
      selection = { selectionId: randomUUID(), projectId: randomUUID(), workspaceId: input.workspaceId, directory: folder.directory, name: folder.folderName };
      return { ...selection };
    } finally { choosing = false; }
  });
  handle('workspace-create-project', async input => {
    if (creating || choosing || reconnecting) throw new Error('项目目录正在处理中，请等待当前操作完成。');
    if (!selection || !input || input.selectionId !== selection.selectionId) throw new Error('请先选择或新建项目文件夹，再创建项目。');
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 50) throw new Error('项目名称需要1至50个字符。');
    const chosen = selection; creating = true;
    try {
      const result = await withProjectWrite(chosen.projectId, () => workspaceStorage.claimProjectFolder({ projectId: chosen.projectId, workspaceId: chosen.workspaceId, name: input.name.trim(), directory: chosen.directory }));
      claimedSelectionId = chosen.selectionId;
      return result;
    }
    finally { creating = false; }
  });
}
module.exports = { registerProjectCreation };
