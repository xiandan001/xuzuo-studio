const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createCloseCoordinator } = require('./close-coordinator.cjs');

function createApplicationExit({ app, dialog, ipcMain, getWindow, trustedSender, getTaskState, drain, onStatus, validationOwner, visibleValidation = false }) {
  const probes = new Map(); let allowed = false, logQueue = Promise.resolve();
  const logFile = path.join(app.getPath('userData'), 'diagnostics', 'exit-events.jsonl');
  const record = event => {
    const line = `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`;
    logQueue = logQueue.catch(() => undefined).then(async () => { await fs.mkdir(path.dirname(logFile), { recursive: true }); await fs.appendFile(logFile, line, 'utf8'); });
    return logQueue;
  };
  ipcMain.on('window:close-state', (event, input) => {
    if (!trustedSender(event) || !input || typeof input.token !== 'string') return;
    const probe = probes.get(input.token); if (!probe) return;
    probes.delete(input.token); probe({ blocked: input.blocked === true });
  });
  function rendererState() {
    const window = getWindow(); if (!window || window.isDestroyed()) return Promise.resolve({ blocked: false });
    return new Promise((resolve, reject) => {
      const token = randomUUID();
      const timer = setTimeout(() => { probes.delete(token); reject(new Error('Renderer did not respond')); }, 1400);
      probes.set(token, state => { clearTimeout(timer); resolve(state); });
      try { window.webContents.send('window:close-state-request', token); }
      catch (error) { clearTimeout(timer); probes.delete(token); reject(error); }
    });
  }
  async function confirm({ kind, running, signal }) {
    if (validationOwner && !visibleValidation && process.env.XUZUO_QA_USE_DIALOG_UI !== '1') {
      const choice = process.env.XUZUO_QA_EXIT_CONFIRMATION;
      if (choice === 'force') return 'force';
      if (kind === 'drain-timeout' || kind === 'drain-error') return 'wait';
      return choice === 'exit' ? 'exit' : 'cancel';
    }
    const messages = {
      unsaved: { message: '当前内容或文件尚未可靠保存。', detail: '返回应用可保存版本、等待复制完成或下载恢复稿。继续退出可能丢失尚未保存的编辑。', buttons: ['返回保存', '继续退出'], choices: ['cancel', 'exit'] },
      running: { message: `还有 ${running || 0} 个模型任务正在运行。`, detail: '停止并退出会尝试保存已有结果、用量与费用；不会自动重发模型请求。', buttons: ['继续运行', '停止任务并退出'], choices: ['cancel', 'exit'] },
      unresponsive: { message: '界面或后台暂未响应。', detail: '重新载入会读取已保存内容和恢复稿。安全退出先尝试保存后台；强制退出可能丢失未保存内容。', buttons: ['返回等待', '重新载入界面', '安全退出', '强制退出'], choices: ['cancel', 'reload', 'exit', 'force'] },
      'drain-timeout': { message: '保存退出已等待较长时间。', detail: '可以继续等待，或强制结束应用。已保存文件不会被删除，尚未落盘的编辑或用量可能丢失。', buttons: ['继续等待', '强制退出'], choices: ['wait', 'force'] },
      'drain-error': { message: '部分本地记录未能保存。', detail: '可重新尝试保存退出；强制退出会保留已有文件，但尚未完成的保存可能丢失。', buttons: ['重试保存退出', '强制退出'], choices: ['wait', 'force'] },
    };
    const config = messages[kind], window = getWindow();
    const options = { type: 'warning', title: '序作工作台 · 退出应用', message: config.message, detail: config.detail, buttons: config.buttons, defaultId: 0, cancelId: 0, ...(signal ? { signal } : {}) };
    if ((!validationOwner || visibleValidation) && window && !window.isDestroyed()) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
    const result = window && !window.isDestroyed() ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options);
    const choice = config.choices[result.response] || 'cancel';
    if (choice === 'reload') { if (window && !window.isDestroyed()) { window.webContents.forcefullyCrashRenderer(); window.webContents.reload(); } return 'cancel'; }
    return choice;
  }
  const qaTimeout = validationOwner ? Number(process.env.XUZUO_QA_EXIT_TIMEOUT_MS) : 0;
  const coordinator = createCloseCoordinator({
    getRendererState: rendererState, getTaskState, drain, confirm, record,
    ...(qaTimeout >= 50 && qaTimeout <= 8000 ? { drainTimeoutMs: qaTimeout } : {}),
    status(value) {
      onStatus(value);
      const window = getWindow();
      try { if (window && !window.isDestroyed()) window.webContents.send('window:closing-status', value); } catch { /* The native exit remains usable after renderer failure. */ }
    },
    finalize({ forced }) {
      allowed = true;
      const timeout = new Promise(resolve => { const timer = setTimeout(resolve, 150); timer.unref?.(); });
      void Promise.race([logQueue.catch(() => undefined), timeout]).finally(() => app.exit(0));
    },
  });
  app.on('before-quit', event => { if (!allowed) { event.preventDefault(); void coordinator.request(); } });
  app.on('window-all-closed', () => { if (!allowed) void coordinator.request(); });
  return {
    request: coordinator.request,
    isClosing: coordinator.isClosing,
    install(window) {
      window.on('close', event => { if (!allowed) { event.preventDefault(); void coordinator.request(); } });
      window.webContents.on('will-prevent-unload', event => { if (allowed) event.preventDefault(); });
      window.on('unresponsive', () => { if (!coordinator.isClosing()) void coordinator.request(); });
      window.webContents.on('render-process-gone', () => { if (!allowed && !coordinator.isClosing()) void coordinator.request(); });
    },
  };
}
module.exports = { createApplicationExit };
