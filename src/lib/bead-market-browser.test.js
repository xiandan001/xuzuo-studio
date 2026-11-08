import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url), { createBeadMarketBrowser } = require('../../electron/bead-market-browser.cjs');
function fixture(options = {}) {
  const windows = [], views = [], handlers = new Map(), captures = [], sessions = [];
  class Contents extends EventEmitter {
    constructor() { super(); this.destroyed = false; this.url = ''; this.mainFrame = { url: '' }; this.navigationHistory = { canGoBack: () => false, canGoForward: () => false }; }
    isDestroyed() { return this.destroyed; } getURL() { return this.url; } setWindowOpenHandler(handler) { this.openHandler = handler; }
    async loadURL(url) { this.url = url; this.mainFrame.url = url; this.emit('did-finish-load'); }
    async executeJavaScript(source) { this.script = source; return options.dom ? options.dom() : { url: this.url, title: 'MARD H1单色豆', text: '品牌：MARD\n珠径：2.6mm\n色号：H1\n每包：1000粒\n单价：1.50元\n运费：0元', links: [], products: [] }; }
    close() { this.destroyed = true; } send(channel, value) { captures.push({ channel, value }); } reload() {}
  }
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.webContents = new Contents(); this.contentView = { addChildView: view => { this.child = view; } }; this.destroyed = false; this.visible = false; windows.push(this); }
    async loadURL(url) { return this.webContents.loadURL(url); } isDestroyed() { return this.destroyed; } isVisible() { return this.visible; } show() { this.visible = true; } focus() {} minimize() {} getContentSize() { return [1100, 820]; }
    destroy() { if (this.destroyed) return; this.destroyed = true; this.webContents.close(); this.emit('closed'); }
  }
  class View { constructor(options) { this.options = options; this.webContents = new Contents(); views.push(this); } setBounds(value) { this.bounds = value; } }
  const onCapture = vi.fn(options.onCapture || (async () => undefined)), onStatus = vi.fn();
  const service = createBeadMarketBrowser({ BrowserWindow: Window, WebContentsView: View, ipcMain: { handle: (name, handler) => handlers.set(name, handler), removeHandler: name => handlers.delete(name) }, session: { fromPartition: name => { const result = { partition: name, setPermissionRequestHandler: handler => { result.requestHandler = handler; }, setPermissionCheckHandler: handler => { result.checkHandler = handler; } }; sessions.push(result); return result; } }, onCapture, onStatus, captureTimeoutMs: options.timeout || 5000 });
  return { service, windows, views, handlers, captures, sessions, onCapture, onStatus };
}
const input = { projectId: 'project-one', platform: 'taobao', url: 'https://item.taobao.com/item.htm?id=123456789' };
describe('隔离平台采集窗口与真实生命周期约束', () => {
  it('只按用户请求创建一个自定义窗口；远端没有Node或preload、拒权限，平台会话独立', async () => {
    const f = fixture(); expect(f.windows).toHaveLength(0); await f.service.open(input);
    expect(f.windows).toHaveLength(1); expect(f.views).toHaveLength(1); expect(f.windows[0].options).toMatchObject({ frame: false, show: false });
    expect(f.views[0].options.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true }); expect(f.views[0].options.webPreferences.preload).toBeUndefined();
    expect(f.sessions[0].partition).toBe('persist:bead-market-taobao'); expect(f.sessions[0].checkHandler()).toBe(false); const permission = vi.fn(); f.sessions[0].requestHandler(null, 'camera', permission); expect(permission).toHaveBeenCalledWith(false);
    expect(f.views[0].bounds).toEqual({ x: 0, y: 150, width: 1100, height: 670 }); expect(f.service.isProjectBusy(input.projectId)).toBe(true); await f.service.shutdown(); expect(f.service.isProjectBusy(input.projectId)).toBe(false); expect(f.windows[0].destroyed && f.views[0].webContents.destroyed).toBe(true); expect(f.handlers.size).toBe(0);
  });
  it('采集实际商品区域得到真实字段与候选状态，双击一次保存，前端远端均不取得Key', async () => {
    const f = fixture(); await f.service.open(input); const [a, b] = await Promise.all([f.service.capture(input), f.service.capture(input)]);
    expect(a.offers[0]).toMatchObject({ code: 'H1', diameterMm: '2.6', packCount: 1000, priceCents: 150, shippingCents: 0, verification: 'candidate' }); expect(a).toEqual(b); expect(f.onCapture).toHaveBeenCalledTimes(1);
    expect(f.onCapture.mock.calls[0][0]).toMatchObject({ projectId: input.projectId, platform: 'taobao' }); expect(f.views[0].webContents.script).not.toMatch(/document\.cookie|localStorage|sessionStorage/); await f.service.shutdown();
  });
  it('只有本地工具栏主frame可发IPC；拒绝远端伪造及跨平台/私网导航', async () => {
    const f = fixture(); await f.service.open(input); const handler = [...f.handlers.values()][0], wc = f.windows[0].webContents, remote = f.views[0].webContents;
    await expect(Promise.resolve().then(() => handler({ sender: remote, senderFrame: remote.mainFrame }, 'state'))).rejects.toThrow(/无权/);
    expect(await handler({ sender: wc, senderFrame: wc.mainFrame }, 'state')).toMatchObject({ platformLabel: '淘宝／天猫' });
    const event = { preventDefault: vi.fn() }; remote.emit('will-navigate', event, 'http://127.0.0.1/private'); expect(event.preventDefault).toHaveBeenCalled();
    const other = { preventDefault: vi.fn() }; remote.emit('will-redirect', other, 'https://mobile.yangkeduo.com/goods.html?goods_id=123456789'); expect(other.preventDefault).toHaveBeenCalled();
    expect(remote.openHandler({ url: 'https://evil.invalid' })).toEqual({ action: 'deny' }); await f.service.shutdown();
  });
  it('切项目/平台关闭旧渲染器，取消后清除handler和窗口，旧采集不得写新项目', async () => {
    let resolve; const f = fixture({ dom: () => new Promise(done => { resolve = done; }) }); await f.service.open(input); const capture = f.service.capture(input), rejected = expect(capture).rejects.toThrow(/窗口|切换/); const closing = f.service.cancel({ projectId: input.projectId }); resolve({ url: input.url, title: '迟到', text: '色号：H1', links: [], products: [] }); await closing; await rejected; expect(f.onCapture).not.toHaveBeenCalled(); expect(f.handlers.size).toBe(0);
    await f.service.open({ projectId: 'project-two', platform: 'pdd', url: 'https://mobile.yangkeduo.com/goods.html?goods_id=123456789' }); expect(f.windows).toHaveLength(2); expect(f.views[0].webContents.destroyed).toBe(true); expect(f.sessions[1].partition).toBe('persist:bead-market-pdd'); await f.service.shutdown();
  });
  it('页面读取有严格时限，已关闭窗口和不安全打开请求都不能越界', async () => {
    const f = fixture({ timeout: 15, dom: () => new Promise(() => {}) }); await expect(f.service.open({ ...input, url: 'https://evil.invalid' })).rejects.toThrow(/来源/); await f.service.open(input); await expect(f.service.capture(input)).rejects.toThrow(/超时/); expect(f.service.isProjectBusy(input.projectId)).toBe(true); await f.service.shutdown(); await expect(f.service.open(input)).rejects.toThrow(/退出/); expect(f.handlers.size).toBe(0);
  });
  it('成功显示后自行最小化不会被首次加载保护误关闭', async () => {
    vi.useFakeTimers(); const f = fixture();
    try { await f.service.open(input); f.windows[0].visible = false; await vi.advanceTimersByTimeAsync(16000); expect(f.windows[0].destroyed).toBe(false); expect(f.service.isProjectBusy(input.projectId)).toBe(true); }
    finally { await f.service.shutdown(); vi.useRealTimers(); }
  });
});
