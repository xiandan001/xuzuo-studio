const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { createFileDialogSession } = require('./file-dialog-session.cjs');
const { createDialogLocations } = require('./dialog-locations.cjs');
const { authorizeSave, writeDialogFile } = require('./dialog-save.cjs');
const { timestampedDefaultPath } = require('./saved-filename.cjs');
const { createDialogPathResolver, samePath } = require('./file-dialog-paths.cjs');

const FALLBACK_HTML = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; connect-src \'none\'; base-uri \'none\'; form-action \'none\'"><title>序作工作台</title><style>html{height:100%;border-radius:8px;overflow:hidden;font:16px "Segoe UI","Microsoft YaHei",sans-serif;color-scheme:light dark}body{box-sizing:border-box;margin:0;padding:28px;width:100%;height:100%;border-radius:8px;overflow:auto;line-height:1.7}h1{font-size:22px;margin:0 0 12px}p{white-space:pre-wrap;margin:12px 0}footer{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:24px}button{font:inherit;padding:9px 16px;border:1px solid #9a9da6;border-radius:9px;cursor:pointer}button:focus-visible{outline:3px solid #8d7bff;outline-offset:2px}</style></head><body></body></html>';
const safeText = (value, fallback = '', limit = 5000) => typeof value === 'string' ? value.slice(0, limit) : fallback;
function cleanOptions(value, kind) {
  const input = value && typeof value === 'object' ? value : {};
  const result = { title: safeText(input.title, kind === 'message' ? '序作工作台' : '选择文件', 300) };
  if (kind === 'message') {
    result.message = safeText(input.message); result.detail = safeText(input.detail);
    result.buttons = Array.isArray(input.buttons) && input.buttons.length ? input.buttons.slice(0, 8).map(label => safeText(label, '确定', 80)) : ['确定'];
    result.defaultId = Number.isInteger(input.defaultId) && input.defaultId >= 0 && input.defaultId < result.buttons.length ? input.defaultId : 0;
    result.cancelId = Number.isInteger(input.cancelId) && input.cancelId >= 0 && input.cancelId < result.buttons.length ? input.cancelId : 0;
    result.type = ['none', 'info', 'error', 'question', 'warning'].includes(input.type) ? input.type : 'info';
  } else {
    result.properties = Array.isArray(input.properties) ? input.properties.filter(item => ['openFile', 'openDirectory', 'multiSelections', 'createDirectory', 'showHiddenFiles'].includes(item)) : ['openFile'];
    result.filters = Array.isArray(input.filters) ? input.filters.slice(0, 20).map(filter => ({ name: safeText(filter?.name, '文件', 100), extensions: Array.isArray(filter?.extensions) ? filter.extensions.filter(item => typeof item === 'string' && /^(?:\*|[A-Za-z0-9]{1,20})$/.test(item)).slice(0, 60) : [] })) : [];
    result.buttonLabel = safeText(input.buttonLabel, kind === 'save' ? '保存到此处' : result.properties.includes('openDirectory') ? '使用此文件夹' : '打开所选文件', 100);
  }
  return result;
}

function createCustomDialogs({ app, BrowserWindow, ipcMain, getWindow, trustedSender, canStart = () => true, trackTask = () => undefined, hidden = false, initialAppearance = { mode: 'light', palette: 'violet' }, getWorkArea = () => ({ width: 1366, height: 900 }), locationsProvider, fileSessionFactory = createFileDialogSession, loadTimeoutMs = 10000 }) {
  const dialogUrl = pathToFileURL(path.join(__dirname, '..', 'dist', 'dialog.html')).href;
  const records = new Map(), locations = locationsProvider || createDialogLocations(app), channels = [];
  let appearance = { mode: ['light', 'dark'].includes(initialAppearance?.mode) ? initialAppearance.mode : 'light', palette: ['violet', 'blue', 'warm'].includes(initialAppearance?.palette) ? initialAppearance.palette : 'violet' }, activePicker, disposed = false, fallbackCount = 0;
  const recent = {};
  const blockedPaths = ['credentials-v1.json', 'workspace-directories-v1.json', 'workspace-directories-transition-v1.json', 'live-workflows-v1.json', 'live-runs-v2', 'backup-imports-v1', 'batches-v1', 'diagnostics', 'fx-rates-v1.json', '.xuzuo-validation-profile.json'].map(name => path.join(app.getPath('userData'), name));
  function finish(record, value, error) {
    if (record.finished) return;
    record.finished = true; clearTimeout(record.timer); record.signal?.removeEventListener('abort', record.abort);
    records.delete(record.id); if (activePicker === record) { activePicker = undefined; locations.cancelPending?.(); }
    const window = record.window; record.window = undefined;
    if (window && !window.isDestroyed()) window.destroy();
    if (error) record.reject(error); else record.resolve(value);
  }
  const canceled = record => record.kind === 'message' ? { response: record.options.cancelId } : record.kind === 'save' ? { canceled: true, filePath: undefined } : { canceled: true, filePaths: [] };
  function activeRecord(event, input) {
    const record = records.get(input?.id), window = record?.window;
    if (!record || record.finished || !window || window.isDestroyed() || event.sender !== window.webContents || !event.senderFrame || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== record.url) throw new Error('此对话窗口已失效，请重新打开。');
    return record;
  }
  function handle(name, action) {
    const channel = `studio-dialog:${name}`; channels.push(channel);
    ipcMain.handle(channel, async (event, input) => action(activeRecord(event, input), input));
  }
  function failWindow(record, window) {
    if (record.finished || record.window !== window) return;
    clearTimeout(record.timer);
    if (record.kind === 'message' && !record.fallback) { openWindow(record, true); return; }
    finish(record, canceled(record), record.kind === 'message' ? undefined : new Error('文件选择窗口未能打开，请保留当前内容并重试。'));
  }
  function openWindow(record, fallback = false) {
    const previous = record.window; record.window = undefined;
    if (previous && !previous.isDestroyed()) previous.destroy();
    const owner = getWindow(), parent = owner && !owner.isDestroyed() ? owner : undefined;
    const area = getWorkArea(parent), message = record.kind === 'message';
    record.fallback = fallback; if (fallback) fallbackCount++;
    record.url = fallback ? `data:text/html;charset=utf-8,${encodeURIComponent(FALLBACK_HTML)}` : dialogUrl;
    const window = new BrowserWindow({
      title: record.options.title, parent, modal: Boolean(parent), frame: false, roundedCorners: true, thickFrame: true, show: false, skipTaskbar: hidden || Boolean(parent),
      width: Math.min(message ? 640 : 1060, Math.max(640, area.width - 40)), height: Math.min(message ? 470 : 740, Math.max(440, area.height - 48)),
      minWidth: message ? 450 : 700, minHeight: message ? 280 : 440, backgroundColor: appearance.mode === 'dark' ? '#1b1c1f' : '#ffffff',
      webPreferences: { preload: path.join(__dirname, 'dialog-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: hidden ? false : !message, partition: `studio-dialog-${randomUUID()}`, additionalArguments: [`--studio-dialog-id=${record.id}`, `--studio-dialog-mode=${appearance.mode}`, `--studio-dialog-palette=${appearance.palette}`, ...(fallback ? ['--studio-dialog-fallback'] : [])] },
    });
    record.window = window; let failed = false;
    const failure = () => { if (failed) return; failed = true; failWindow(record, window); };
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (url !== record.url) { event.preventDefault(); failure(); } });
    window.webContents.on('will-redirect', event => { event.preventDefault(); failure(); });
    window.webContents.on('did-fail-load', failure); window.webContents.on('render-process-gone', failure); window.on('unresponsive', failure);
    window.on('close', event => { if (!record.finished) { event.preventDefault(); finish(record, canceled(record)); } });
    window.on('closed', () => { if (!record.finished && record.window === window) finish(record, canceled(record)); });
    window.once('ready-to-show', () => { if (!record.finished && record.window === window && !hidden) { window.show(); window.focus(); } });
    record.timer = setTimeout(failure, loadTimeoutMs); record.timer.unref?.();
    void window.loadURL(record.url).catch(failure);
  }
  function request(kind, original = {}) {
    if (disposed || kind !== 'message' && !canStart()) return Promise.resolve(kind === 'message' ? { response: 0 } : kind === 'save' ? { canceled: true } : { canceled: true, filePaths: [] });
    if (kind !== 'message' && activePicker) return Promise.reject(new Error('另一个文件选择窗口尚未完成，请先完成或取消它。'));
    if (kind === 'message' && [...records.values()].some(record => record.kind === 'message')) return Promise.reject(new Error('另一个确认窗口尚未完成。'));
    const options = cleanOptions(original, kind), record = { id: randomUUID(), kind, options, finished: false, signal: original.signal, validateSelection: typeof original.validateSelection === 'function' ? original.validateSelection : undefined };
    const completion = new Promise((resolve, reject) => { record.resolve = resolve; record.reject = reject; });
    records.set(record.id, record); if (kind !== 'message') activePicker = record;
    record.abort = () => finish(record, canceled(record));
    if (record.signal?.aborted) { record.abort(); return completion; }
    record.signal?.addEventListener('abort', record.abort, { once: true });
    record.preparation = Promise.resolve();
    try {
      openWindow(record);
      if (kind !== 'message') record.preparation = (async () => {
        const category = options.properties.includes('openDirectory') ? 'directory' : kind;
        let defaultPath = safeText(original.defaultPath, '', 32768);
        if (kind === 'save') defaultPath = timestampedDefaultPath(defaultPath || original.defaultFilename || '未命名文件.txt');
        if (!path.isAbsolute(defaultPath)) defaultPath = kind === 'save' ? path.join(recent.save || app.getPath('documents'), path.basename(defaultPath || '未命名文件.txt')) : recent[category] || app.getPath('documents');
        const discovery = locations.peek ? locations.peek(defaultPath) : await locations(defaultPath);
        if (record.finished) return;
        if (!canStart()) { finish(record, canceled(record)); return; }
        record.session = fileSessionFactory({ options: { ...options, mode: kind, defaultPath, allowedRoot: original.allowedRoot, exactPath: original.exactPath, selectEmpty: original.selectEmpty, maxSelections: original.maxSelections || 20 }, locations: discovery.locations, blockedPaths, assertActive: () => { if (record.finished) throw new Error('此文件选择已取消。'); } });
        const seed = await record.session.seed();
        if (record.finished) return;
        if (!canStart()) { finish(record, canceled(record)); return; }
        record.seed = { ...seed, ...(discovery.warning ? { locationWarning: discovery.warning } : {}), ...(discovery.pending && !original.allowedRoot ? { locationsPending: true } : {}) };
      })().catch(error => { if (!record.finished) finish(record, undefined, error); });
    } catch (error) { finish(record, undefined, error); }
    return completion;
  }
  handle('request', async record => {
    await record.preparation;
    if (record.finished) throw new Error('此对话窗口已失效，请重新打开。');
    clearTimeout(record.timer);
    return { id: record.id, kind: record.kind, title: record.options.title, options: record.options, appearance: { ...appearance }, ...(record.seed ? { seed: record.seed } : {}) };
  });
  handle('list', (record, input) => { if (!record.session) throw new Error('此对话窗口不支持浏览文件。'); return record.session.list(input); });
  handle('locations', async (record, input) => {
    await record.preparation;
    if (record.finished || !record.session || !record.seed) throw new Error('此对话窗口不支持浏览文件。');
    const result = record.seed.allowedRoot && locations.peek ? locations.peek(record.seed.path) : await locations(record.seed.path, { force: input.force === true });
    if (record.finished) throw new Error('此文件选择已取消。');
    return { locations: record.session.filterLocations(result.locations), ...(result.warning ? { warning: result.warning } : {}) };
  });
  handle('create-folder', (record, input) => { if (!record.session) throw new Error('此对话窗口不支持创建文件夹。'); return record.session.createFolder(input); });
  handle('accept', async (record, input) => {
    if (!record.session) throw new Error('此对话窗口不支持文件选择。');
    if (record.accepting) throw new Error('正在检查选择，请稍候。'); record.accepting = true;
    try {
      const accepted = await record.session.accept(input);
      if (record.finished) throw new Error('此文件选择已取消。');
      if (accepted.overwriteRequired) return accepted;
      if (!Array.isArray(accepted.paths) || !accepted.paths.length) throw new Error('请选择文件或文件夹。');
      if (record.kind === 'open' && record.options.properties.includes('openDirectory')) {
        const userData = await createDialogPathResolver(fs)(app.getPath('userData'), { requireDirectory: true });
        if (record.finished) throw new Error('此文件选择已取消。');
        if (accepted.paths.some(value => samePath(path.resolve(value), userData.path))) throw new Error('应用数据目录不能用作工作区或项目，请选择独立文件夹。');
      }
      if (record.validateSelection) await record.validateSelection(accepted.paths);
      if (record.finished) throw new Error('此文件选择已取消。');
      const file = accepted.paths[0];
      if (record.kind === 'save') {
        recent.save = path.dirname(file); finish(record, authorizeSave({ canceled: false, filePath: file }, record.session));
      } else {
        recent[record.options.properties.includes('openDirectory') ? 'directory' : 'open'] = record.options.properties.includes('openDirectory') ? file : path.dirname(file);
        finish(record, { canceled: false, filePaths: accepted.paths });
      }
      return { accepted: true };
    } finally { record.accepting = false; }
  });
  handle('cancel', record => { finish(record, canceled(record)); return { canceled: true }; });
  handle('respond-message', (record, input) => {
    if (record.kind !== 'message' || !Number.isInteger(input.index) || input.index < 0 || input.index >= record.options.buttons.length) throw new Error('请选择有效的确认操作。');
    finish(record, { response: input.index }); return { accepted: true };
  });
  const appearanceChannel = 'file-dialog:appearance', saveChannel = 'file-dialog:save-text'; channels.push(appearanceChannel, saveChannel);
  ipcMain.handle(appearanceChannel, (event, value) => {
    if (!trustedSender(event)) throw new Error('此页面无权设置对话窗口。');
    if (!value || !['light', 'dark'].includes(value.mode) || !['violet', 'blue', 'warm'].includes(value.palette)) throw new Error('对话窗口外观参数无效。');
    appearance = { mode: value.mode, palette: value.palette };
    for (const record of records.values()) if (record.window && !record.window.isDestroyed()) { record.window.setBackgroundColor(appearance.mode === 'dark' ? '#1b1c1f' : '#ffffff'); record.window.webContents.send('studio-dialog:appearance', appearance); }
  });
  ipcMain.handle(saveChannel, (event, input) => {
    if (!trustedSender(event)) throw new Error('此页面无权保存本机文件。');
    if (!canStart()) return { saved: false };
    const task = (async () => {
      if (!input || typeof input.filename !== 'string' || input.filename.length > 255 || typeof input.text !== 'string' || Buffer.byteLength(input.text) > 100 * 1024 * 1024) throw new Error('待保存文字或文件名无效，单份文字最多100MB。');
      const filename = path.basename(input.filename).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || '未命名文件.txt';
      const selected = await request('save', { title: '保存文件', defaultPath: filename, filters: [{ name: '文件格式', extensions: [path.extname(filename).slice(1) || '*'] }] });
      return writeDialogFile(selected, Buffer.from(input.text, 'utf8'));
    })(); trackTask(task, true); return task;
  });
  const argumentsOptions = (first, second) => second || first || {};
  return {
    showOpenDialog(first, second) { return request('open', argumentsOptions(first, second)); },
    showSaveDialog(first, second) { return request('save', argumentsOptions(first, second)); },
    showMessageBox(first, second) { return request('message', argumentsOptions(first, second)); },
    cancelPickers() { for (const record of [...records.values()]) if (record.kind !== 'message') finish(record, canceled(record)); },
    installOwner(window) {
      window.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) this.cancelPickers(); });
      window.webContents.on('render-process-gone', () => this.cancelPickers());
      window.on('closed', () => this.cancelPickers());
    },
    getAppearance() { return { ...appearance }; },
    stats() { return { active: records.size, pickers: [...records.values()].filter(record => record.kind !== 'message').length, fallbackCount }; },
    dispose() { disposed = true; for (const record of [...records.values()]) finish(record, canceled(record)); locations.cancelPending?.(); for (const channel of channels) ipcMain.removeHandler(channel); },
  };
}
module.exports = { createCustomDialogs, cleanOptions };
