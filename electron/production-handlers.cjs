const fs = require('node:fs/promises');
const path = require('node:path');
const { assertSaveAuthority } = require('./dialog-save.cjs');
const { inside } = require('./workspace-paths.cjs');

function registerProductionHandlers({ handle, dialog, getWindow, workspaceStorage, liveEngine, backupManager, deliveries, batches, relocatingProjects, writingProjects, withProjectWrite, automationCenter }) {
  const inspectedBackups = new Set();
  async function lockWorkspace(workspaceIds, action) {
    const locations = await workspaceStorage.list();
    if (!Array.isArray(workspaceIds) || !workspaceIds.length || workspaceIds.some(id => !locations.workspaces.some(item => item.workspaceId === id))) throw new Error('请选择已连接的工作区。');
    const ids = locations.projects.filter(item => workspaceIds.includes(item.workspaceId)).map(item => item.projectId);
    const [snapshot, queues] = await Promise.all([liveEngine.snapshot(undefined, { summaryOnly: true }), batches.list()]);
    if (ids.some(id => relocatingProjects.has(id) || writingProjects.has(id)) || snapshot.runs.some(run => ids.includes(run.projectId) && run.status === 'running') || queues.some(queue => workspaceIds.includes(queue.workspaceId) && queue.status === 'running')) throw new Error('请等待当前写入和调用结束，并暂停本区批量队列后重试。');
    const leases = [], ownedLocks = [];
    try {
      if (automationCenter) for (const id of ids) leases.push(await automationCenter.reserveProject(id, { allowReview: true }));
      if (ids.some(id => relocatingProjects.has(id) || writingProjects.has(id))) throw Error('项目已开始写入或目录操作，请等待后重新备份。');
      ids.forEach(id => { relocatingProjects.add(id); ownedLocks.push(id); });
      return await action();
    } finally { ownedLocks.forEach(id => relocatingProjects.delete(id)); for (const release of leases.reverse()) await release(); }
  }
  handle('backup-export', async input => {
    const result = await dialog.showSaveDialog(getWindow(), { title: '保存完整内部备份（不含 API Key）', defaultPath: '序作-内部备份.zip', filters: [{ name: '序作完整备份', extensions: ['zip'] }], validateSelection: async paths => { const locations = await workspaceStorage.list(); if (locations.workspaces.some(item => input.workspaceIds?.includes(item.workspaceId) && inside(item.directory, paths[0]))) throw new Error('请把内部备份保存到工作区以外，避免重复备份自身。'); } });
    if (result.canceled || !result.filePath) return { saved: false };
    return lockWorkspace(input?.workspaceIds, async () => { const output = await backupManager.exportBackup({ ...input, filePath: result.filePath, beforeWrite: () => assertSaveAuthority(result, result.filePath) }); return { ...output, saved: true, path: result.filePath }; });
  });
  handle('backup-inspect', async () => {
    const result = await dialog.showOpenDialog(getWindow(), { title: '选择序作内部备份', properties: ['openFile'], filters: [{ name: '序作完整备份', extensions: ['zip'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0], inspection = await backupManager.inspectBackup(filePath);
    inspectedBackups.add(filePath); return { ...inspection, filePath };
  });
  handle('backup-import', async input => {
    if (!inspectedBackups.has(input?.filePath)) throw new Error('请先通过“选择内部备份”检查要导入的备份。');
    const result = await dialog.showOpenDialog(getWindow(), { title: '选择恢复位置（将创建独立工作区）', defaultPath: path.dirname(input.filePath), properties: ['openDirectory', 'createDirectory'], buttonLabel: '恢复到此文件夹' });
    if (result.canceled || !result.filePaths[0]) return null;
    return backupManager.importBackup({ filePath: input.filePath, directory: result.filePaths[0] });
  });
  handle('backup-pending', () => backupManager.pendingImports());
  handle('backup-acknowledge', backupId => backupManager.acknowledgeImport(backupId));
  handle('workspace-relocate', async input => {
    if (!input || !['copy', 'reconnect'].includes(input.mode)) throw new Error('目录操作类型不正确。');
    const result = await dialog.showOpenDialog(getWindow(), { title: input.mode === 'copy' ? '选择复制后的工作区位置' : '选择已移动的原工作区文件夹', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    return lockWorkspace([input.workspaceId], async () => { const locations = await workspaceStorage.relocate({ ...input, directory: result.filePaths[0] }); await liveEngine.refreshArtifactLocations(); return locations; });
  });
  handle('delivery-inspect', input => deliveries.inspect(input));
  handle('delivery-review', input => withProjectWrite(input?.projectId, () => deliveries.saveReview(input)));
  handle('delivery-confirm', input => withProjectWrite(input?.projectId, () => deliveries.confirm(input)));
  handle('delivery-history', input => deliveries.history(input));
  handle('delivery-zip', async input => {
    const history = await deliveries.history(input), receipt = history.find(item => item.id === input?.deliveryId);
    if (!receipt) throw new Error('交付记录不存在，请重新选择。');
    const result = await dialog.showSaveDialog(getWindow(), { title: '保存客户交付包', defaultPath: `${receipt.title.replace(/[<>:"/\\|?*]/g, '-')}-交付.zip`, filters: [{ name: '客户交付包', extensions: ['zip'] }] });
    if (result.canceled || !result.filePath) return { saved: false };
    return withProjectWrite(input.projectId, () => deliveries.exportZip({ ...input, destination: result.filePath, beforeWrite: () => assertSaveAuthority(result, result.filePath) }));
  });
  handle('batch-parse', async () => {
    const result = await dialog.showOpenDialog(getWindow(), { title: '导入批量任务变量', properties: ['openFile'], filters: [{ name: 'CSV 或 Excel 数据表', extensions: ['csv', 'xlsx'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const filename = result.filePaths[0], stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 20 * 1024 * 1024) throw new Error('请选择不超过 20 MB 的普通 CSV/XLSX 文件。');
    return batches.parse({ name: path.basename(filename), buffer: await fs.readFile(filename) });
  });
  handle('batch-create', input => batches.create(input));
  handle('batch-list', () => batches.list());
  handle('batch-get', input => batches.get(input));
  handle('batch-control', input => batches.control(input));
}
module.exports = { registerProductionHandlers };
