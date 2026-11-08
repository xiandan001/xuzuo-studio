const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const { app, BrowserWindow, WebContentsView, ipcMain, session } = require('electron');

// This probe verifies real Electron/Chromium and IPC with clearly synthetic marketplace responses.
// It does not load the application, read user profiles, sign in, or claim live marketplace price verification.
assert.equal(process.platform, 'win32'); assert.equal(process.env.CI, 'true'); assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.match(process.env.GITHUB_SHA || '', /^[a-f0-9]{40}$/);
const root = path.resolve(__dirname, '..'), output = path.join(root, 'work', 'bead-market-browser-native-output');
assert(process.argv[2] && path.isAbsolute(process.argv[2]), 'Run this child through verify-bead-market-browser.mjs');
const temporary = fs.realpathSync(process.argv[2]); assert.equal(path.dirname(temporary).toLowerCase(), fs.realpathSync(process.env.RUNNER_TEMP).toLowerCase()); assert.match(path.basename(temporary), /^xuzuo-market-browser-owned-[A-Za-z0-9-]+$/);
const owner = JSON.parse(fs.readFileSync(path.join(temporary, 'owner.json'), 'utf8')); assert.equal(owner.kind, 'xuzuo-market-browser-owned'); assert.equal(owner.commit, process.env.GITHUB_SHA); assert.equal(owner.root, root); assert.equal(owner.output, output); assert.match(owner.nonce, /^[a-f0-9-]{36}$/);
const probeSourceSha256 = createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'); assert.equal(owner.sourceSha256, probeSourceSha256);
assert(!fs.existsSync(output), 'Retain previous evidence and use a clean CI output'); fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(temporary, 'profile')); app.setPath('sessionData', path.join(temporary, 'profile')); app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
const report = { passed: false, phase: 'bootstrap', checkpoints: [], commit: process.env.GITHUB_SHA, nonce: owner.nonce, probeSourceSha256, syntheticMarketplace: true, actualChromium: true, visibleOnlyInIsolatedCIDesktop: true, providerCalls: 0, externalRequests: 0, userProfileAccessed: false, normalApplicationStarted: false, windowsCreated: 0, shown: 0, quotes: [], loginConfirmations: [], processIds: [process.pid], errors: [], sourceSha256: createHash('sha256').update(fs.readFileSync(path.join(root, 'electron/bead-market-browser.cjs'))).digest('hex') };
let browser, finishing = false; const windows = [], views = [], remoteContents = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function checkpoint(phase) { report.phase = phase; report.checkpoints.push({ phase, at: new Date().toISOString() }); fs.writeFileSync(path.join(output, 'progress.json'), JSON.stringify({ nonce: owner.nonce, commit: report.commit, phase, checkpoints: report.checkpoints }, null, 2) + '\n'); process.stdout.write('Marketplace probe phase: ' + phase + '\n'); }
async function bounded(task, label, timeoutMs = 6000) { let timer; try { return await Promise.race([task, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Marketplace operation timed out: ' + label)), timeoutMs); })]); } finally { clearTimeout(timer); } }
const deadline = setTimeout(() => { void finish(Error('Native marketplace browser probe exceeded 40 seconds')); }, 40000);
async function finish(error) {
  if (finishing) return; finishing = true; clearTimeout(deadline); if (error) { report.errors.push(String(error.stack || error)); process.stderr.write('Marketplace probe failure: ' + String(error.stack || error) + '\n'); }
  checkpoint('shutdown');
  try { await bounded(browser?.shutdown(), 'browser shutdown', 6000); } catch (cause) { report.errors.push(String(cause)); }
  try { await until(() => BrowserWindow.getAllWindows().length === 0 && remoteContents.every(contents => contents.isDestroyed()), 'all platform contents destroyed'); } catch (cause) { report.errors.push(String(cause)); }
  if (app.isReady()) report.processIds = [...new Set([...report.processIds, ...app.getAppMetrics().map(item => item.pid)])];
  report.remainingWindows = BrowserWindow.getAllWindows().length; report.remainingRemoteViews = remoteContents.filter(contents => !contents.isDestroyed()).length;
  if (report.remainingWindows || report.remainingRemoteViews || report.shown !== report.windowsCreated || report.windowsCreated !== 4) report.errors.push('Expected four displayed isolated CI windows and no remaining windows/views');
  for (const window of BrowserWindow.getAllWindows()) window.destroy(); report.passed = report.errors.length === 0;
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); process.stdout.write(JSON.stringify({ passed: report.passed, report: path.join(output, 'report.json'), errors: report.errors }) + '\n'); app.exit(report.passed ? 0 : 1);
}
async function until(check, label) { const end = Date.now() + 5000; while (Date.now() < end) { if (await check()) return; await delay(25); } throw Error('Timed out waiting for ' + label); }
function QAWindow(options) { const window = new BrowserWindow({ ...options, show: false }); windows.push(window); report.windowsCreated++; window.on('show', () => { report.shown++; }); return window; }
function QAView(options) { const view = new WebContentsView(options); views.push(view); remoteContents.push(view.webContents); return view; }
async function run() {
  process.stdout.write('Marketplace owned native probe bootstrap reached\n');
  await app.whenReady();
  checkpoint('app-ready');
  const html = '<!doctype html><meta charset="utf-8"><title>合成MARD商品 · 非真实商家报价</title><style>body{font:18px Microsoft YaHei,sans-serif;margin:30px;line-height:1.8;color:#263143}.SkuContent--current{border:1px solid #bbb;border-radius:12px;padding:24px;white-space:pre-wrap}</style><div class="ItemHeader--root">合成商品，仅验收DOM/IPC</div><section class="SkuContent--current">品牌：MARD\n珠径：2.6mm\n色号：H1\n每包：1000粒\n单价：1.50元\n运费：0元</section>';
  for (const platform of ['1688', 'taobao', 'pdd']) { const scoped = session.fromPartition(`persist:bead-market-${platform}`); scoped.protocol.handle('https', () => new Response(html, { headers: { 'content-type': 'text/html;charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" } })); }
  browser = require('../electron/bead-market-browser.cjs').createBeadMarketBrowser({ BrowserWindow: QAWindow, WebContentsView: QAView, ipcMain, session, onLoginConfirmed: async value => { assert.deepEqual(Object.keys(value).sort(), ['confirmedAt', 'platform']); report.loginConfirmations.push(value); }, onCapture: async ({ projectId, platform, result }) => { assert.equal(projectId, 'market-probe-project'); const offer = result.offers[0]; assert(offer); assert.equal(offer.brand, 'MARD'); assert.equal(offer.code, 'H1'); assert.equal(offer.diameterMm, '2.6'); assert.equal(offer.packCount, 1000); assert.equal(offer.priceCents, 150); assert.equal(offer.verification, 'candidate'); report.quotes.push({ platform, url: offer.url, code: offer.code, priceCents: offer.priceCents, verification: offer.verification }); } });
  const urls = { '1688': 'https://detail.1688.com/offer/123456789.html', taobao: 'https://item.taobao.com/item.htm?id=123456789', pdd: 'https://mobile.yangkeduo.com/goods.html?goods_id=123456789' };
  for (const platform of ['1688', 'taobao', 'pdd']) {
    checkpoint(platform + '-open'); await bounded(browser.open({ projectId: 'market-probe-project', platform, url: urls[platform] }), platform + ' open', 12000);
    const window = windows.at(-1), view = views.at(-1); await until(() => !view.webContents.isLoading() && view.webContents.getURL() === urls[platform], 'synthetic product rendered');
    report.processIds.push(window.webContents.getOSProcessId(), view.webContents.getOSProcessId());
    assert(window.isVisible(), 'The production browser must be visible in the isolated CI desktop'); checkpoint(platform + '-rendered');
    await until(() => window.webContents.executeJavaScript('Boolean(window.marketBrowser&&document.getElementById("capture"))'), 'local toolbar bridge');
    const count = report.quotes.length; await bounded(window.webContents.executeJavaScript('document.getElementById("capture").click()'), 'toolbar click'); await until(() => report.quotes.length > count, 'trusted toolbar capture'); await bounded(browser.drain(), 'capture persistence'); checkpoint(platform + '-captured');
    await until(() => BrowserWindow.getAllWindows().length === 1 && remoteContents.filter(contents => !contents.isDestroyed()).length === 1, 'previous platform view destroyed');
    if (platform === 'taobao') {
      checkpoint('taobao-fonts-and-frames'); await bounded(view.webContents.executeJavaScript('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))'), 'visible product fonts and frames');
      checkpoint('taobao-toolbar-pixels'); const toolbar = await bounded(window.webContents.capturePage(), 'toolbar pixels'); checkpoint('taobao-product-pixels'); const product = await bounded(view.webContents.capturePage(), 'product pixels'); assert(!toolbar.isEmpty() && !product.isEmpty());
      const { PNG } = require('pngjs'), main = PNG.sync.read(toolbar.toPNG()), remote = PNG.sync.read(product.toPNG()), bounds = view.getBounds(), offset = Math.round(bounds.y * main.width / window.getContentSize()[0]); let ink = 0;
      for (let y = 0; y < remote.height && y + offset < main.height; y++) for (let x = 0; x < remote.width && x < main.width; x++) { const from = (y * remote.width + x) * 4, to = ((y + offset) * main.width + x) * 4; remote.data.copy(main.data, to, from, from + 4); if (remote.data[from + 3] && Math.min(remote.data[from], remote.data[from + 1], remote.data[from + 2]) < 200) ink++; }
      assert(ink > 500, 'Actual product renderer capture must contain visible text'); const buffer = PNG.sync.write(main); fs.writeFileSync(path.join(output, 'toolbar-and-product.png'), buffer, { flag: 'wx' }); report.capture = { bytes: buffer.length, width: main.width, height: main.height, sha256: createHash('sha256').update(buffer).digest('hex'), composedNativeSurfaces: true, visibleProductPixels: ink };
      checkpoint('taobao-png-written');
    }
  }
  checkpoint('login-mode-open'); await bounded(browser.open({ platform: 'taobao', mode: 'login' }), 'login window open', 12000); const loginWindow = windows.at(-1); await until(() => loginWindow.webContents.executeJavaScript('document.getElementById("capture")?.textContent === "我已完成登录"'), 'login mode toolbar');
  await assert.rejects(browser.capture({ projectId: 'bead-market-platform-login', platform: 'taobao' }), /登录窗口/);
  await bounded(loginWindow.webContents.executeJavaScript('document.getElementById("capture").click()'), 'login confirmation click'); await until(() => report.loginConfirmations.length === 1 && BrowserWindow.getAllWindows().length === 0, 'explicit user login confirmation'); checkpoint('login-mode-confirmed');
  await browser.shutdown(); assert.equal(BrowserWindow.getAllWindows().length, 0); assert.equal(Object.keys(require.cache).some(file => file === path.join(root, 'electron/main.cjs')), false); await finish();
}
process.on('uncaughtException', error => { void finish(error); }); process.on('unhandledRejection', error => { void finish(error); }); run().catch(error => { void finish(error); });
