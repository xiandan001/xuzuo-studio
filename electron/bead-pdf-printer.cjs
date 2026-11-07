const { randomUUID } = require('node:crypto');
const { ensureBeadActive, raceBeadAbort } = require('./bead-source.cjs');
function createBeadPdfPrinter({ BrowserWindow, timeoutMs = 90000 }) {
  const active = new Set(); let tail = Promise.resolve(), closing = false;
  async function render(input, options = {}) {
    if (closing) throw Error('打印服务正在关闭，原图纸已保留。');
    if (!input || typeof input.html !== 'string' || Buffer.byteLength(input.html) > 16 * 1024 * 1024 || !Number.isSafeInteger(input.pages) || input.pages < 1 || input.pages > 100) throw Error('拼豆PDF内容超过16MB或100页，请减少网格或简化自定义说明。');
    ensureBeadActive(options.signal);
    const controller = new AbortController(), forward = () => controller.abort(); options.signal?.addEventListener('abort', forward, { once: true });
    const window = new BrowserWindow({ width: 900, height: 1200, show: false, skipTaskbar: true, autoHideMenuBar: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, backgroundThrottling: false, partition: `bead-print-${randomUUID()}` } });
    const contents = window.webContents, destroy = () => { if (!window.isDestroyed()) window.destroy(); };
    const token = { controller, destroy }; active.add(token);
    const timer = setTimeout(() => controller.abort(), timeoutMs); controller.signal.addEventListener('abort', destroy, { once: true });
    contents.setWindowOpenHandler(() => ({ action: 'deny' })); contents.on('will-navigate', event => event.preventDefault());
    contents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'file://*/*'] }, (_details, done) => done({ cancel: true }));
    const policy = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; script-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'";
    try {
      await raceBeadAbort(contents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${policy}">${input.html}`)}`), controller.signal);
      const buffer = Buffer.from(await raceBeadAbort(contents.printToPDF({ printBackground: true, pageSize: 'A4', preferCSSPageSize: true }), controller.signal));
      ensureBeadActive(controller.signal);
      const actualPages = (buffer.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
      if (!buffer.length || buffer.length > 100 * 1024 * 1024 || !buffer.subarray(0, 5).equals(Buffer.from('%PDF-')) || actualPages !== input.pages || actualPages > 100) throw Error(`PDF实际分页或文件内容未通过检查（实际${actualPages}页，计划${input.pages}页），原图纸保留，请重新导出。`);
      return buffer;
    } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', forward); controller.signal.removeEventListener('abort', destroy); destroy(); active.delete(token); }
  }
  return {
    print(input, options) { const pending = tail.then(() => render(input, options)); tail = pending.catch(() => undefined); return pending; },
    async shutdown() { closing = true; for (const item of active) { item.controller.abort(); item.destroy(); } await tail; },
    drain: () => tail,
  };
}
module.exports = { createBeadPdfPrinter };
