const { createOfficePreview } = require('./office-preview.cjs');

function registerOfficePreviewHandlers({ handle, dialog, getWindow, artifactStore, directory, withProjectWrite, shell, trackWrite, loadModule, platform = process.platform }) {
  const preview = createOfficePreview({ directory, artifactStore, loadModule, platform });
  handle('office-preview-status', () => preview.status());
  handle('office-preview-choose', async () => {
    const options = platform === 'darwin'
      ? { title: '选择 LibreOffice.app', properties: ['openDirectory', 'treatPackageAsDirectory'] }
      : platform === 'win32' ? { title: '选择 LibreOffice 渲染器（program/soffice.com）', properties: ['openFile'], filters: [{ name: 'LibreOffice 启动程序', extensions: ['com', 'exe'] }] }
        : { title: '选择 LibreOffice soffice 启动程序', properties: ['openFile'] };
    const result = await dialog.showOpenDialog(getWindow(), options);
    return result.canceled || !result.filePaths[0] ? preview.status() : preview.configure(result.filePaths[0]);
  });
  handle('office-preview-download', () => shell.openExternal('https://www.libreoffice.org/download/'));
  handle('office-preview-render', input => preview.render(input));
  handle('office-preview-cancel', requestId => preview.cancel(requestId));
  handle('office-preview-save-pdf', input => {
    const projectId = preview.projectId(input?.previewId); if (!projectId) throw new Error('请先生成当前文件的预览。');
    const task = withProjectWrite(projectId, () => preview.savePdf(input)); trackWrite?.(task); return task;
  });
  return preview;
}
module.exports = { registerOfficePreviewHandlers };
