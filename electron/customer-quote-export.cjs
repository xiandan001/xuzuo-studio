const { randomUUID } = require('node:crypto');
function createCustomerQuoteExporter({ BrowserWindow, artifactStore, workspaceStorage }) {
  let queue = Promise.resolve();
  async function render(input) {
    if (!input || !['pdf', 'png'].includes(input.format) || typeof input.html !== 'string' || Buffer.byteLength(input.html) > 300000 || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 120) throw Error('报价导出参数无效或内容过长。');
    await workspaceStorage.assertProject(input.projectId, input.workspaceId);
    const window = new BrowserWindow({ width: 900, height: 1200, show: false, skipTaskbar: true, autoHideMenuBar: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true, backgroundThrottling: false, partition: `customer-quote-${randomUUID()}` } });
    const contents = window.webContents;
    contents.setWindowOpenHandler(() => ({ action: 'deny' })); contents.on('will-navigate', event => event.preventDefault());
    contents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'file://*/*'] }, (_details, done) => done({ cancel: true }));
    const policy = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; script-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'";
    try {
      await contents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${policy}">${input.html}`)}`);
      let buffer;
      if (input.format === 'pdf') buffer = await contents.printToPDF({ printBackground: true, pageSize: 'A4', preferCSSPageSize: true });
      else {
        const { height, ratio } = await contents.executeJavaScript('({height:Math.ceil(Math.max(document.body.scrollHeight,document.documentElement.scrollHeight)),ratio:window.devicePixelRatio})');
        if (!Number.isSafeInteger(height) || !Number.isFinite(ratio) || height > 12000 || 900 * Math.max(1200, height) * ratio * ratio > 16000000) throw Error('报价图片尺寸过大，请使用可分页的 PDF 导出。');
        window.setContentSize(900, Math.max(1200, height)); buffer = (await contents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG();
      }
      if (!buffer.length) throw Error('报价文件为空，尚未保存。');
      const artifact = await artifactStore.write({ projectId: input.projectId, name: `${input.title}-对客报价.${input.format}`, mimeType: input.format === 'pdf' ? 'application/pdf' : 'image/png', buffer });
      return { saved: true, path: artifact.path, artifact };
    } finally { if (!window.isDestroyed()) window.destroy(); }
  }
  return { export(input) { const task = queue.then(() => render(input)); queue = task.catch(() => undefined); return task; }, drain: () => queue };
}
module.exports = { createCustomerQuoteExporter };
