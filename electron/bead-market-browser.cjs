const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { CONFIG, sourceRequestUrl, beadMarketSearchUrl, classifyBeadMarketUrl } = require('./bead-market-sources-url.cjs');
const { beadMarketDomCapture } = require('./bead-market-sources-dom.cjs');
const { parseBeadMarketCapture } = require('./bead-market-sources-parser.cjs');

const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value);
function createBeadMarketBrowser({ BrowserWindow, WebContentsView, ipcMain, session, getWindow = () => undefined, onCapture = async () => undefined, onStatus = () => undefined, onLoginConfirmed = async () => undefined, appearance = () => ({ dark: false }), captureTimeoutMs = 5000 } = {}) {
  const toolbarUrl = pathToFileURL(path.join(__dirname, '..', 'assets', 'bead-market-browser.html')).href;
  let current, closed = false; const tasks = new Set();
  const track = task => { tasks.add(task); void task.finally(() => tasks.delete(task)).catch(() => undefined); return task; };
  const active = record => current === record && !record.finished && !record.window.isDestroyed() && !record.remote.webContents.isDestroyed();
  function address(record) { try { const url = new URL(record.remote.webContents.getURL()); return url.hostname + url.pathname; } catch { return '正在打开…'; } }
  function state(record) { const history = record.remote.webContents.navigationHistory; return { mode: record.mode, title: `${CONFIG[record.platform].label} · ${record.mode === 'login' ? '平台登录' : '材料比价'}`, platformLabel: CONFIG[record.platform].label, address: address(record), message: record.message, busy: record.busy, canBack: history?.canGoBack?.() || false, canForward: history?.canGoForward?.() || false, dark: Boolean(typeof appearance === 'function' ? appearance()?.dark : appearance?.dark) }; }
  function push(record) { if (!active(record)) return; try { record.window.webContents.send(`bead-market-window-state:${record.id}`, state(record)); } catch { /* Window teardown does not discard saved quotes. */ } }
  function finish(record) {
    if (record.finished) return; record.finished = true; if (current === record) current = undefined;
    clearTimeout(record.timer); ipcMain.removeHandler(record.channel);
    try { if (!record.remote.webContents.isDestroyed()) record.remote.webContents.close({ waitForBeforeUnload: false }); } catch { /* Already closed. */ }
    try { if (!record.window.isDestroyed()) record.window.destroy(); } catch { /* Already closed. */ }
  }
  async function capture(record) {
    if (!active(record)) throw Error('平台窗口已关闭，请重新打开后采集。');
    if (record.mode !== 'capture') throw Error('这是平台登录窗口，不采集商品或写入项目；请完成登录后返回应用。');
    if (record.task) return record.task;
    const task = track((async () => {
      record.busy = true; record.message = '正在读取商品区域；登录信息不会提供给模型。'; push(record); let timer;
      try {
        const url = record.remote.webContents.getURL(); sourceRequestUrl(url, record.platform);
        const dom = await Promise.race([record.remote.webContents.executeJavaScript(`(${beadMarketDomCapture.toString()})()`, false), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('商品页面读取超时，请等页面加载后重试。')), captureTimeoutMs); })]);
        if (!active(record) || record.remote.webContents.getURL() !== url) throw Error('商品页已切换，旧页面未写入采购表，请重新采集。');
        if (!dom || JSON.stringify(dom).length > 512000) throw Error('商品页面数据过大，请选定一个具体商品规格后再采集。');
        sourceRequestUrl(dom.url, record.platform); const result = parseBeadMarketCapture({ platform: record.platform, capture: dom });
        if (result.offers.length) await onCapture({ projectId: record.projectId, platform: record.platform, result });
        record.message = result.message; try { onStatus({ projectId: record.projectId, platform: record.platform, status: result.status, message: result.message }); } catch { /* Status feedback is not part of quote persistence. */ }
        return result;
      } finally { clearTimeout(timer); record.busy = false; record.task = undefined; push(record); }
    })()); record.task = task; return task;
  }
  async function action(record, name) {
    if (!active(record)) throw Error('当前平台窗口已失效。');
    if (name === 'close') { finish(record); return undefined; }
    if (name === 'return') { finish(record); const parent = getWindow(); if (parent && !parent.isDestroyed()) { parent.show(); parent.focus(); } return undefined; }
    if (name === 'state') return state(record);
    if (name === 'minimize') { record.window.minimize(); return state(record); }
    if (name === 'capture' && record.mode === 'login') {
      if (record.busy) throw Error('正在保存登录确认，请稍候。'); record.busy = true; push(record);
      try { await track(Promise.resolve().then(() => onLoginConfirmed({ platform: record.platform, confirmedAt: new Date().toISOString() }))); if (!active(record)) return undefined; record.message = '已记录你确认的网页登录状态；这不代表平台API权限，实际查询仍以页面为准。'; finish(record); const parent = getWindow(); if (parent && !parent.isDestroyed()) { parent.show(); parent.focus(); } return undefined; }
      finally { record.busy = false; push(record); }
    }
    if (name === 'capture') { try { await capture(record); } catch (error) { record.message = error.message; push(record); throw error; } return state(record); }
    if (record.busy) throw Error('正在保存采集结果，请稍候再切换页面。');
    const history = record.remote.webContents.navigationHistory;
    if (name === 'back' && history?.canGoBack()) history.goBack();
    else if (name === 'forward' && history?.canGoForward()) history.goForward();
    else if (name === 'reload') record.remote.webContents.reload();
    else if (!['back', 'forward'].includes(name)) throw Error('不支持的窗口操作。');
    return state(record);
  }
  const api = {
    async open({ projectId, platform, url, spec, codes, mode = 'capture' } = {}) {
      if (closed) throw Error('应用正在退出，未打开平台。'); if (!['capture', 'login'].includes(mode) || !Object.hasOwn(CONFIG, platform)) throw Error('请选择支持的平台和窗口用途。');
      if (mode === 'login') projectId = 'bead-market-platform-login'; if (!validId(projectId)) throw Error('请选择当前项目。');
      const target = sourceRequestUrl(mode === 'login' ? CONFIG[platform].home : url || beadMarketSearchUrl(platform, spec, codes), platform).url;
      if (current && active(current)) {
        if (current.projectId === projectId && current.platform === platform && current.mode === mode) { if (url && mode === 'capture' && current.remote.webContents.getURL() !== target) { if (current.busy) throw Error('平台正在采集，请稍后再打开其他商品。'); void current.remote.webContents.loadURL(target).catch(() => undefined); } current.window.show(); current.window.focus(); return { opened: true }; }
        if (current.busy) throw Error('另一平台正在采集，请完成后再切换。'); finish(current);
      }
      const parent = getWindow(), id = randomUUID(), channel = `bead-market-window:${id}`, scoped = session.fromPartition(`persist:bead-market-${platform}`);
      scoped.setPermissionRequestHandler((_contents, _permission, callback) => callback(false)); scoped.setPermissionCheckHandler(() => false);
      const window = new BrowserWindow({ title: `${CONFIG[platform].label} · ${mode === 'login' ? '平台登录' : '材料比价'}`, ...(parent && !parent.isDestroyed() ? { parent } : {}), frame: false, roundedCorners: true, width: 1100, height: 820, minWidth: 780, minHeight: 560, show: false, backgroundColor: '#ffffff', webPreferences: { preload: path.join(__dirname, 'bead-market-browser-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, partition: `bead-market-toolbar-${id}`, additionalArguments: [`--bead-market-window=${id}`] } });
      const remote = new WebContentsView({ webPreferences: { session: scoped, sandbox: true, nodeIntegration: false, contextIsolation: true, webSecurity: true, backgroundThrottling: true } });
      window.contentView.addChildView(remote); const record = { id, channel, projectId, platform, mode, window, remote, busy: false, finished: false, message: mode === 'login' ? '直接在官方页面自行登录，完成后点击我已完成登录。网页登录不等于官方API授权。' : '自行登录、打开具体商品并选择规格，再点击采集当前商品。' }; current = record;
      const resize = () => { if (!active(record)) return; const [width, height] = window.getContentSize(); remote.setBounds({ x: 0, y: 150, width: Math.max(1, width), height: Math.max(1, height - 150) }); };
      window.on('resize', resize); window.on('closed', () => finish(record)); window.on('close', () => finish(record));
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event, destination) => { if (destination !== toolbarUrl) event.preventDefault(); }); window.webContents.on('will-redirect', event => event.preventDefault());
      remote.webContents.setWindowOpenHandler(details => {
        if (!active(record)) return { action: 'deny' };
        try {
          const destination = sourceRequestUrl(details.url, platform).url;
          if (record.busy) { record.message = '正在保存采集结果，请稍候再打开登录或商品链接。'; push(record); return { action: 'deny' }; }
          void remote.webContents.loadURL(destination).catch(() => { if (active(record)) { record.message = '平台链接未能打开，请刷新或稍后重试。'; push(record); } });
        } catch { record.message = '已阻止打开当前官方平台之外的窗口。'; push(record); }
        return { action: 'deny' };
      }); remote.webContents.on('will-attach-webview', event => event.preventDefault());
      const navigation = (event, destination) => { try { sourceRequestUrl(destination || event.url, platform); } catch { event.preventDefault(); record.message = '已阻止离开当前官方平台。购买请在平台自行确认，本工具不会自动下单。'; push(record); } };
      remote.webContents.on('will-navigate', navigation); remote.webContents.on('will-redirect', navigation);
      remote.webContents.on('did-navigate', () => push(record)); remote.webContents.on('did-navigate-in-page', () => push(record));
      remote.webContents.on('did-finish-load', () => { record.message = mode === 'login' ? '请自行完成网页登录后点击我已完成登录；确认仅保存时间，不读取密码、Cookie或声称API已授权。' : classifyBeadMarketUrl(remote.webContents.getURL())?.kind === 'login' ? '请自行完成登录；登录信息不会提供给模型。完成后打开具体商品并选规格。' : '选好商品色号和包装后，点击采集当前商品，回采购表核对。'; push(record); });
      remote.webContents.on('did-fail-load', (_event, code, _description, _validatedURL, mainFrame) => { if (!mainFrame || code === -3) return; record.message = '平台页面未能加载，可刷新、改用商品链接或导入截图／报价表。'; push(record); });
      remote.webContents.on('render-process-gone', () => { record.message = '平台页面进程已停止，可关闭窗口后重新打开。'; push(record); });
      ipcMain.handle(channel, (event, name) => { if (!active(record) || event.sender !== window.webContents || !event.senderFrame || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== toolbarUrl) throw Error('此页面无权访问材料采集工具。'); if (typeof name !== 'string') throw Error('窗口操作无效。'); return action(record, name); });
      record.timer = setTimeout(() => { if (active(record) && !window.isVisible()) finish(record); }, 15000); record.timer.unref?.();
      window.once('show', () => clearTimeout(record.timer));
      try { await window.loadURL(toolbarUrl); if (!active(record)) return { opened: false }; resize(); window.show(); if (window.isVisible()) clearTimeout(record.timer); window.focus(); push(record); void remote.webContents.loadURL(target).catch(() => { record.message = '平台未能打开，请尝试商品链接或导入资料。'; push(record); }); return { opened: true }; }
      catch { finish(record); throw Error('平台采集窗口未能打开，图纸与已有报价仍保留。'); }
    },
    capture({ projectId, platform } = {}) { const record = current; if (!record || !active(record) || record.projectId !== projectId || record.platform !== platform) return Promise.reject(Error('请先打开当前项目对应的平台窗口。')); return capture(record); },
    async cancel({ projectId } = {}) { if (!validId(projectId)) throw Error('项目编号无效。'); if (current?.projectId === projectId) finish(current); await api.drain(); },
    isProjectBusy(projectId) { return Boolean(current?.projectId === projectId && active(current)); },
    async drain() { while (tasks.size) await Promise.allSettled([...tasks]); },
    async prepareClose() { if (current) finish(current); await api.drain(); },
    async shutdown() { closed = true; await api.prepareClose(); },
  };
  return api;
}
module.exports = { createBeadMarketBrowser };
