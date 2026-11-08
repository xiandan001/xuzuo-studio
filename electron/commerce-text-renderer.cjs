const { randomUUID } = require('node:crypto');
const h = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
function abortable(task, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(Object.assign(Error('文字导出已取消或超时，当前工程保留。'), { name: 'AbortError' })); }, cleanup = () => signal.removeEventListener('abort', abort);
    Promise.resolve(task).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  });
}
function commerceTextHtml(layer) {
  return `<div id="text" style="width:100%;height:100%;overflow:hidden;box-sizing:border-box;font-family:'${h(layer.fontFamily)}';font-size:${layer.fontSize}px;font-weight:${layer.fontWeight};line-height:1.25;color:${h(layer.color)};text-align:${layer.align};white-space:pre-wrap;overflow-wrap:anywhere">${h(layer.text)}</div>`;
}
function createCommerceTextRenderer({ BrowserWindow, timeoutMs = 30000 }) {
  let queue = Promise.resolve(), closing = false; const windows = new Set(), cancellations = new Map();
  async function render(layer, { signal } = {}) {
    if (closing || signal?.aborted) throw Object.assign(Error('文字导出已取消。'), { name: 'AbortError' });
    const width = Math.ceil(layer.width), height = Math.ceil(layer.height);
    if (width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 16000000) throw Error('文字图层像素过大，请缩小文本框。');
    const image = typeof layer.imageDataUrl === 'string';
    if (image && !/^data:image\/(?:png|jpeg|gif|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/.test(layer.imageDataUrl)) throw Error('样张预览只接受本地图片数据。');
    const window = new BrowserWindow({ width, height, useContentSize: true, frame: false, show: false, skipTaskbar: true, transparent: true, backgroundColor: '#00000000', autoHideMenuBar: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true, backgroundThrottling: false, partition: `commerce-text-${randomUUID()}` } }); windows.add(window);
    const destroy = () => { if (!window.isDestroyed()) window.destroy(); }, contents = window.webContents, controller = new AbortController();
    const cancel = () => { controller.abort(); destroy(); }, timer = setTimeout(cancel, timeoutMs); signal?.addEventListener('abort', cancel, { once: true });
    cancellations.set(window, cancel);
    contents.setWindowOpenHandler(() => ({ action: 'deny' })); contents.on('will-navigate', event => event.preventDefault());
    contents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'file://*/*'] }, (_request, done) => done({ cancel: true }));
    const policy = "default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; img-src data:; font-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'";
    try {
      const body = image ? `<img id="image" style="display:block;width:100%;height:100%;object-fit:contain" src="${h(layer.imageDataUrl)}">` : commerceTextHtml(layer);
      await abortable(contents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><style>html,body{margin:0;width:100%;height:100%;background:transparent}</style>${body}`)}`), controller.signal);
      const bounds = await abortable(contents.executeJavaScript(image ? '(async()=>{const image=document.getElementById("image");await image.decode();return {ratio:window.devicePixelRatio}})()' : '(async()=>{await document.fonts.ready;const e=document.getElementById("text");return {width:e.scrollWidth,height:e.scrollHeight,clientWidth:e.clientWidth,clientHeight:e.clientHeight,ratio:window.devicePixelRatio}})()'), controller.signal);
      if (!image && (bounds.height > bounds.clientHeight + 1 || bounds.width > bounds.clientWidth + 1)) throw Error(`“${layer.name || '文字'}”超出文本框，请增大文本框或缩小字号。`);
      if (Number.isFinite(bounds.ratio) && width * height * bounds.ratio ** 2 > 16000000) throw Error('文字图层实际像素过大，请拆成较小的文本框。');
      if (signal?.aborted) throw Object.assign(Error('文字导出已取消。'), { name: 'AbortError' });
      const capture = await abortable(contents.capturePage(undefined, { stayHidden: true, stayAwake: true }), controller.signal);
      return capture.resize({ width, height, quality: 'best' }).toPNG();
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); destroy(); windows.delete(window); cancellations.delete(window); }
  }
  const enqueue = (layer, options) => { const pending = queue.then(() => render(layer, options)); queue = pending.catch(() => undefined); return pending; };
  return { render: enqueue, renderImage: enqueue, async drain() { await queue; }, async shutdown() { closing = true; for (const cancel of cancellations.values()) cancel(); for (const window of windows) if (!window.isDestroyed()) window.destroy(); await queue; } };
}
module.exports = { createCommerceTextRenderer, commerceTextHtml };
