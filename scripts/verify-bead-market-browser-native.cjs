const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const { app, BrowserWindow, WebContentsView, ipcMain, session } = require('electron');

// This probe verifies real Electron/Chromium and IPC with clearly synthetic marketplace responses.
// It does not load the application, read user profiles, sign in, or claim live marketplace price verification.
assert.equal(process.platform, 'win32'); assert.equal(process.env.CI, 'true'); assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.match(process.env.GITHUB_SHA || '', /^[a-f0-9]{40}$/);
const root = path.resolve(__dirname, '..'), output = path.join(root, 'work', 'bead-market-browser-native-output');
assert(!fs.existsSync(output), 'Retain previous evidence and use a clean CI output'); fs.mkdirSync(output, { recursive: true });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'xuzuo-market-browser-')); app.setPath('userData', temporary); app.setPath('sessionData', temporary); app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
const report = { passed: false, commit: process.env.GITHUB_SHA, syntheticMarketplace: true, actualChromium: true, providerCalls: 0, externalRequests: 0, userProfileAccessed: false, normalApplicationStarted: false, windowsCreated: 0, shown: 0, quotes: [], errors: [], sourceSha256: createHash('sha256').update(fs.readFileSync(path.join(root, 'electron/bead-market-browser.cjs'))).digest('hex') };
let browser, finishing = false; const windows = [], views = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = setTimeout(() => { void finish(Error('Native marketplace browser probe exceeded 40 seconds')); }, 40000);
async function finish(error) {
  if (finishing) return; finishing = true; clearTimeout(deadline); if (error) report.errors.push(String(error.stack || error));
  try { await browser?.shutdown(); } catch (cause) { report.errors.push(String(cause)); }
  report.remainingWindows = BrowserWindow.getAllWindows().length; report.remainingRemoteViews = views.filter(view => !view.webContents.isDestroyed()).length;
  if (report.remainingWindows || report.remainingRemoteViews || report.shown) report.errors.push('The probe left windows/views or showed a test window');
  for (const window of BrowserWindow.getAllWindows()) window.destroy(); report.passed = report.errors.length === 0;
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); process.stdout.write(JSON.stringify({ passed: report.passed, report: path.join(output, 'report.json'), errors: report.errors }) + '\n'); app.exit(report.passed ? 0 : 1);
}
async function until(check, label) { const end = Date.now() + 5000; while (Date.now() < end) { if (await check()) return; await delay(25); } throw Error('Timed out waiting for ' + label); }
function QAWindow(options) { const window = new BrowserWindow({ ...options, show: false }); windows.push(window); report.windowsCreated++; window.show = () => {}; window.focus = () => {}; window.on('show', () => { report.shown++; }); return window; }
function QAView(options) { const view = new WebContentsView(options); views.push(view); return view; }
async function run() {
  await app.whenReady();
  const html = '<!doctype html><meta charset="utf-8"><title>合成MARD商品 · 非真实商家报价</title><style>body{font:18px Microsoft YaHei,sans-serif;margin:30px;line-height:1.8;color:#263143}.SkuContent--current{border:1px solid #bbb;border-radius:12px;padding:24px;white-space:pre-wrap}</style><div class="ItemHeader--root">合成商品，仅验收DOM/IPC</div><section class="SkuContent--current">品牌：MARD\n珠径：2.6mm\n色号：H1\n每包：1000粒\n单价：1.50元\n运费：0元</section>';
  for (const platform of ['1688', 'taobao', 'pdd']) { const scoped = session.fromPartition(`persist:bead-market-${platform}`); scoped.protocol.handle('https', () => new Response(html, { headers: { 'content-type': 'text/html;charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" } })); }
  browser = require('../electron/bead-market-browser.cjs').createBeadMarketBrowser({ BrowserWindow: QAWindow, WebContentsView: QAView, ipcMain, session, onCapture: async ({ projectId, platform, result }) => { assert.equal(projectId, 'market-probe-project'); const offer = result.offers[0]; assert(offer); assert.equal(offer.brand, 'MARD'); assert.equal(offer.code, 'H1'); assert.equal(offer.diameterMm, '2.6'); assert.equal(offer.packCount, 1000); assert.equal(offer.priceCents, 150); assert.equal(offer.verification, 'candidate'); report.quotes.push({ platform, url: offer.url, code: offer.code, priceCents: offer.priceCents, verification: offer.verification }); } });
  const urls = { '1688': 'https://detail.1688.com/offer/123456789.html', taobao: 'https://item.taobao.com/item.htm?id=123456789', pdd: 'https://mobile.yangkeduo.com/goods.html?goods_id=123456789' };
  for (const platform of ['1688', 'taobao', 'pdd']) {
    await browser.open({ projectId: 'market-probe-project', platform, url: urls[platform] });
    const window = windows.at(-1), view = views.at(-1); await until(() => !view.webContents.isLoading() && view.webContents.getURL() === urls[platform], 'synthetic product rendered');
    await until(() => window.webContents.executeJavaScript('Boolean(window.marketBrowser&&document.getElementById("capture"))'), 'local toolbar bridge');
    const count = report.quotes.length; await window.webContents.executeJavaScript('document.getElementById("capture").click()'); await until(() => report.quotes.length > count, 'trusted toolbar capture');
    assert.equal(BrowserWindow.getAllWindows().length, 1); assert.equal(views.filter(item => !item.webContents.isDestroyed()).length, 1);
    if (platform === 'taobao') { const image = await window.webContents.capturePage(undefined, { stayHidden: true }); assert(!image.isEmpty()); const buffer = image.toPNG(); fs.writeFileSync(path.join(output, 'toolbar-and-product.png'), buffer, { flag: 'wx' }); report.capture = { bytes: buffer.length, ...image.getSize(), sha256: createHash('sha256').update(buffer).digest('hex') }; }
  }
  await browser.shutdown(); assert.equal(BrowserWindow.getAllWindows().length, 0); assert.equal(Object.keys(require.cache).some(file => file === path.join(root, 'electron/main.cjs')), false); await finish();
}
process.on('uncaughtException', error => { void finish(error); }); process.on('unhandledRejection', error => { void finish(error); }); run().catch(error => { void finish(error); });
